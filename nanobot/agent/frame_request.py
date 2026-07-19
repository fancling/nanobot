from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping

from nanobot.agent.workspace_frame import (
    WorkspaceFrameAssemblyRegistry,
    WorkspaceFrameBuilder,
    WorkspaceFrameRenderer,
)
from nanobot.utils.image_generation_intent import image_generation_prompt


class FrameRequestAdapter:
    def __init__(
        self,
        context: Any,
        builder: WorkspaceFrameBuilder | None = None,
        renderer: WorkspaceFrameRenderer | None = None,
        profiles: WorkspaceFrameAssemblyRegistry | None = None,
    ) -> None:
        self.context = context
        self.builder = builder or WorkspaceFrameBuilder(context, profiles=profiles)
        self.renderer = renderer or WorkspaceFrameRenderer()

    def build_frame_only_messages(
        self,
        *,
        session: Any,
        history: list[dict[str, Any]],
        msg: Any,
        pending_summary: str | None,
        runtime_lines: list[str],
        workspace: Path,
        tool_names: list[str],
        token_budget: Mapping[str, Any] | None = None,
        runtime_chat_id: str | None = None,
        runtime_channel: str | None = None,
        include_memory_recent_history: bool = True,
        unified_session: bool = False,
        current_text: str | None = None,
    ) -> list[dict[str, Any]]:
        if current_text is None:
            current_text = image_generation_prompt(
                getattr(msg, "content", ""),
                getattr(msg, "metadata", {}),
            )
        user_content = self.context._build_user_content(
            current_text,
            getattr(msg, "media", None) or None,
        )
        frame_text = self._sanitize_frame_text(current_text, msg)
        frame = self.builder.build(
            session=session,
            history=history,
            msg=msg,
            current_input=frame_text,
            current_event_content=self._sanitized_current_event(frame_text, msg),
            pending_summary=pending_summary,
            runtime_lines=runtime_lines,
            workspace=workspace,
            tool_names=tool_names,
            token_budget=token_budget,
            runtime_chat_id=runtime_chat_id,
            runtime_channel=runtime_channel,
            include_memory_recent_history=include_memory_recent_history,
            unified_session=unified_session,
        )
        return [
            {"role": "system", "content": self.renderer.render(frame)},
            {"role": "user", "content": user_content},
        ]

    def _sanitized_current_event(self, current_text: str, msg: Any) -> dict[str, Any]:
        media = getattr(msg, "media", None) or []
        return {
            "text": current_text,
            "media_count": len(media),
        }

    def _sanitize_frame_text(self, current_text: str, msg: Any) -> str:
        media_paths = [path for path in (getattr(msg, "media", None) or []) if isinstance(path, str)]
        if not media_paths:
            return current_text

        sanitized = current_text
        for path in media_paths:
            sanitized = sanitized.replace(f"[image: {path}]", "[media]")
            sanitized = sanitized.replace(path, "[media]")
        return sanitized
