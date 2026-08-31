"""Optional output tool for Reader companion-chat observation turns."""

from __future__ import annotations

from contextvars import ContextVar
from typing import Any, Awaitable, Callable

from nanobot.agent.tools.base import Tool, tool_parameters
from nanobot.agent.tools.context import current_request_context
from nanobot.agent.tools.schema import StringSchema, tool_parameters_schema
from nanobot.bus.events import OutboundMessage
from nanobot.session.manager import SessionManager
from nanobot.utils.helpers import strip_think
from nanobot.webui.reader_bridge import (
    READER_BRIDGE_COMPANION_TURN_ID_KEY,
    READER_BRIDGE_DISPATCH_METADATA_KEY,
)


@tool_parameters(
    tool_parameters_schema(
        content=StringSchema("The distinct companion response to show in Reader."),
        required=["content"],
    )
)
class ReaderReplyTool(Tool):
    """Send a companion response back to the originating Reader."""

    _plugin_discoverable = False

    def __init__(
        self,
        *,
        send_callback: Callable[[OutboundMessage], Awaitable[None]],
        workframe_sessions: SessionManager,
    ):
        self._send_callback = send_callback
        self._workframe_sessions = workframe_sessions
        self._decision: ContextVar[tuple[str, str | None] | None] = ContextVar(
            "reader_companion_decision",
            default=None,
        )

    @property
    def name(self) -> str:
        return "reader_reply"

    @property
    def description(self) -> str:
        return (
            "Explicitly add one distinct companion response to the Reader conversation. "
            "You may call this instead of returning a normal assistant response. If no "
            "additional response is useful, call reader_skip instead."
        )

    def start_turn(self) -> None:
        self._decision.set(None)

    def decision(self) -> str | None:
        current = self._decision.get()
        return current[0] if current is not None else None

    def sent_content(self) -> str | None:
        current = self._decision.get()
        if current is None or current[0] != "reply":
            return None
        return current[1]

    def skip_content(self) -> str | None:
        current = self._decision.get()
        if current is None or current[0] != "skip":
            return None
        return current[1]

    def skip(self, content: str | None = None) -> str:
        if self._decision.get() is not None:
            return "Error: a Reader companion decision was already made for this turn"
        context = current_request_context()
        dispatch = (
            context.metadata.get(READER_BRIDGE_DISPATCH_METADATA_KEY)
            if context is not None
            else None
        )
        if not isinstance(dispatch, dict):
            return "Error: reader_skip is only available during a Reader observation turn"
        reflection = content.strip() if isinstance(content, str) else ""
        self._decision.set(("skip", reflection or None))
        return (
            "Reader companion response skipped; reflection recorded."
            if reflection
            else "Reader companion response skipped."
        )

    async def deliver(
        self,
        content: str,
        *,
        workframe_id: str,
        companion_session_key: str | None,
        companion_turn_id: str | None = None,
    ) -> str:
        if self._decision.get() is not None:
            return "Error: a Reader companion decision was already made for this turn"
        if not workframe_id:
            return "Error: Reader observation target is missing"

        reply = strip_think(content).strip()
        if not reply:
            return "Error: reader_reply content must not be empty"

        session = self._workframe_sessions.get_or_create(f"workframe:{workframe_id}")
        session.add_message(
            "assistant",
            reply,
            reader_companion_reply=True,
            companion_session_key=companion_session_key,
        )
        self._workframe_sessions.save(session)

        metadata: dict[str, Any] = {
            "_reader_companion_reply": True,
            "companion_session_key": companion_session_key,
        }
        if companion_turn_id:
            metadata[READER_BRIDGE_COMPANION_TURN_ID_KEY] = companion_turn_id
        await self._send_callback(
            OutboundMessage(
                channel="websocket",
                chat_id=workframe_id,
                content=reply,
                metadata=metadata,
            )
        )
        self._decision.set(("reply", reply))
        return "Reader companion response sent."

    async def execute(self, content: str, **_: Any) -> str:
        context = current_request_context()
        dispatch = (
            context.metadata.get(READER_BRIDGE_DISPATCH_METADATA_KEY)
            if context is not None
            else None
        )
        if not isinstance(dispatch, dict):
            return "Error: reader_reply is only available during a Reader observation turn"
        workframe_id = dispatch.get("workframe_id")
        companion_session_key = dispatch.get("chat_session_key")
        companion_turn_id = dispatch.get(READER_BRIDGE_COMPANION_TURN_ID_KEY)
        if not isinstance(workframe_id, str):
            return "Error: Reader observation target is missing"
        if not isinstance(companion_session_key, str):
            companion_session_key = None
        return await self.deliver(
            content,
            workframe_id=workframe_id,
            companion_session_key=companion_session_key,
            companion_turn_id=companion_turn_id
            if isinstance(companion_turn_id, str)
            else None,
        )


@tool_parameters(
    tool_parameters_schema(
        content=StringSchema(
            "Optional concise reflection to preserve and display in the companion chat "
            "while remaining silent in Reader.",
            max_length=4_000,
            nullable=True,
        ),
    )
)
class ReaderSkipTool(Tool):
    """Explicitly decline to add a companion response to Reader."""

    _plugin_discoverable = False

    def __init__(self, decision_tool: ReaderReplyTool):
        self._decision_tool = decision_tool

    @property
    def name(self) -> str:
        return "reader_skip"

    @property
    def description(self) -> str:
        return (
            "Explicitly choose not to add a companion response because the Reader sub-persona "
            "already handled the exchange adequately. You may include a concise reflection in "
            "content; it will be recorded in the companion chat but will not be sent to Reader. "
            "Call this instead of returning a normal assistant response."
        )

    async def execute(self, content: str | None = None, **_: Any) -> str:
        return self._decision_tool.skip(content)
