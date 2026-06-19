from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

from nanobot.agent.context import ContextBuilder
from nanobot.agent.frame_request import FrameRequestAdapter
from nanobot.agent.loop import AgentLoop
from nanobot.bus.events import InboundMessage
from nanobot.session.manager import Session


class _Provider:
    generation = SimpleNamespace(max_tokens=4096)

    def get_default_model(self) -> str:
        return "test-model"


class _Tools:
    tool_names = ["read_file", "exec"]

    def get(self, _name: str):
        return None


def _loop(tmp_path: Path) -> AgentLoop:
    loop = AgentLoop.__new__(AgentLoop)
    loop.workspace = tmp_path
    loop.context_window_tokens = 16000
    loop.provider = _Provider()
    loop.model = "test-model"
    loop.tools = _Tools()
    loop._unified_session = False
    loop._mcp_servers = {}
    loop._mcp_stacks = {}
    loop.context = ContextBuilder(tmp_path, timezone="UTC")
    loop.workspace_scopes = SimpleNamespace(
        for_message=lambda _msg, _metadata: SimpleNamespace(project_path=tmp_path),
    )
    loop.frame_request_adapter = FrameRequestAdapter(loop.context)
    return loop


def test_build_initial_messages_uses_frame_only_request(tmp_path: Path) -> None:
    session = Session(key="cli:direct")
    session.add_message("user", "old user text")
    session.add_message("assistant", "old assistant text")
    history = session.get_history(include_timestamps=True)
    msg = InboundMessage(
        channel="cli",
        sender_id="user",
        chat_id="direct",
        content="new text",
    )

    initial = _loop(tmp_path)._build_initial_messages(
        msg,
        session,
        history,
        pending_summary="old summary",
    )

    assert [message["role"] for message in initial] == ["system", "user"]
    assert initial[1]["content"] == "new text"
    assert "<workspace_frame" in initial[0]["content"]
    assert "conversation.recent_raw" in initial[0]["content"]
    assert "old user text" in initial[0]["content"]
    assert "old summary" in initial[0]["content"]
    assert not any(message.get("content") == "old user text" for message in initial[1:])


def test_build_initial_messages_uses_runtime_context_chat_id(tmp_path: Path) -> None:
    session = Session(key="cli:thread-id")
    msg = InboundMessage(
        channel="cli",
        sender_id="user",
        chat_id="thread-id",
        content="new text",
        metadata={"context_chat_id": "parent-id"},
    )

    initial = _loop(tmp_path)._build_initial_messages(
        msg,
        session,
        history=[],
        pending_summary=None,
    )

    assert "chat_id: parent-id" in initial[0]["content"]
    assert "chat_id: thread-id" not in initial[0]["content"]


def test_build_initial_messages_includes_memory_recent_history(tmp_path: Path) -> None:
    loop = _loop(tmp_path)
    session = Session(key="cli:direct")
    loop.context.memory.append_history("memory archive fact", session_key=session.key)
    msg = InboundMessage(
        channel="cli",
        sender_id="user",
        chat_id="direct",
        content="new text",
    )

    initial = loop._build_initial_messages(
        msg,
        session,
        history=[],
        pending_summary=None,
        include_memory_recent_history=True,
    )

    assert "memory.recent_history" in initial[0]["content"]
    assert "memory archive fact" in initial[0]["content"]


def test_build_initial_messages_omits_memory_recent_history_when_disabled(
    tmp_path: Path,
) -> None:
    loop = _loop(tmp_path)
    session = Session(key="cli:direct")
    session.add_message("user", "session replay fact")
    history = session.get_history(include_timestamps=True)
    loop.context.memory.append_history("memory archive fact", session_key=session.key)
    msg = InboundMessage(
        channel="cli",
        sender_id="user",
        chat_id="direct",
        content="new text",
    )

    initial = loop._build_initial_messages(
        msg,
        session,
        history,
        pending_summary=None,
        include_memory_recent_history=False,
    )

    assert "memory archive fact" not in initial[0]["content"]
    assert "session replay fact" in initial[0]["content"]


def test_build_initial_messages_scrubs_prior_media_paths_from_frame(
    tmp_path: Path,
) -> None:
    session = Session(key="cli:direct")
    png = tmp_path / "image.png"
    png.write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 100)
    session.add_message("user", "prior image text", media=[str(png)])
    history = session.get_history(include_timestamps=True)
    msg = InboundMessage(
        channel="cli",
        sender_id="user",
        chat_id="direct",
        content="new text",
    )

    initial = _loop(tmp_path)._build_initial_messages(
        msg,
        session,
        history,
        pending_summary=None,
    )

    assert str(png) not in initial[0]["content"]
    assert "[media]" in initial[0]["content"]
    assert "prior image text" in initial[0]["content"]


def test_build_frame_initial_messages_embeds_system_history_in_frame(
    tmp_path: Path,
) -> None:
    loop = _loop(tmp_path)
    session = Session(key="cli:direct")
    session.add_message("user", "old system-session text")
    history = session.get_history(include_timestamps=True)
    msg = InboundMessage(
        channel="system",
        sender_id="system",
        chat_id="cli:direct",
        content="system event",
    )

    initial = loop._build_frame_initial_messages(
        msg=msg,
        session=session,
        history=history,
        pending_summary=None,
        workspace=tmp_path,
        runtime_chat_id="direct",
        skip_runtime_lines=False,
        current_text="system event",
        include_memory_recent_history=True,
    )

    assert [message["role"] for message in initial] == ["system", "user"]
    assert initial[1]["content"] == "system event"
    assert "<workspace_frame" in initial[0]["content"]
    assert "old system-session text" in initial[0]["content"]
    assert not any(
        message.get("content") == "old system-session text" for message in initial[1:]
    )


@pytest.mark.asyncio
async def test_process_system_message_saves_response_after_frame_initial_messages(
    tmp_path: Path,
) -> None:
    loop = _loop(tmp_path)
    loop.max_tool_result_chars = 10_000
    loop._max_messages = 120
    loop._background_tasks = []

    session = Session(key="cli:direct")
    session.add_message("user", "old user text")
    session.add_message("assistant", "old assistant text")

    loop.sessions = SimpleNamespace(
        get_or_create=lambda _key: session,
        save=lambda _session: None,
    )
    loop.auto_compact = SimpleNamespace(
        prepare_session=lambda current_session, _key: (current_session, None),
    )

    async def _no_consolidate(*_args, **_kwargs):
        return None

    loop.consolidator = SimpleNamespace(maybe_consolidate_by_tokens=_no_consolidate)
    loop._set_tool_context = lambda *_args, **_kwargs: None
    loop._runtime_events = lambda: SimpleNamespace(record_turn_latency=lambda *_args: None)

    def _close_background(coro):
        coro.close()

    loop._schedule_background = _close_background

    async def _run_agent_loop(initial_messages, **_kwargs):
        return (
            "system result",
            None,
            [*initial_messages, {"role": "assistant", "content": "system result"}],
            "completed",
            None,
        )

    loop._run_agent_loop = _run_agent_loop

    msg = InboundMessage(
        channel="system",
        sender_id="system",
        chat_id="cli:direct",
        content="system event",
    )

    await loop._process_system_message(msg)

    assert any(
        message.get("role") == "assistant" and message.get("content") == "system result"
        for message in session.messages
    )
