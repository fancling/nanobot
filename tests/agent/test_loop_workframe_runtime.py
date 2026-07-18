from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

from nanobot.agent.context import ContextBuilder
from nanobot.agent.frame_request import FrameRequestAdapter
from nanobot.agent.loop import AgentLoop
from nanobot.bus.events import InboundMessage
from nanobot.session.manager import Session, SessionManager


class _Provider:
    generation = SimpleNamespace(max_tokens=4096)

    def get_default_model(self) -> str:
        return "test-model"


class _Tools:
    tool_names = ["read_file"]

    def get(self, _name: str):
        return None

    def get_definitions(self):
        return []


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
    loop.frame_request_adapter = FrameRequestAdapter(loop.context)
    loop.sessions = SessionManager(tmp_path)
    loop._consolidation_ratio = 0.5
    loop._session_ttl_minutes = 0
    loop.workspace_scopes = SimpleNamespace(
        for_message=lambda _msg, _metadata: SimpleNamespace(project_path=tmp_path),
    )
    loop.consolidator = SimpleNamespace()
    loop.auto_compact = SimpleNamespace()
    loop.workframe = loop._build_workframe_runtime(timezone="UTC", disabled_skills=[])
    return loop


def test_workframe_runtime_uses_isolated_session_and_memory_roots(tmp_path: Path) -> None:
    loop = _loop(tmp_path)

    assert loop.workframe.sessions.sessions_dir == tmp_path / "workframes" / "sessions"
    assert loop.workframe.context.memory.memory_dir == tmp_path / "workframes" / "memory"
    assert loop.context.memory.memory_dir == tmp_path / "memory"


def test_turn_runtime_selects_workframe_from_metadata(tmp_path: Path) -> None:
    loop = _loop(tmp_path)
    ordinary = InboundMessage(
        channel="websocket",
        sender_id="client",
        chat_id="chat-a",
        content="hello",
    )
    workframe = InboundMessage(
        channel="websocket",
        sender_id="client",
        chat_id="frame-a",
        content="hello",
        metadata={"workframe": True},
        session_key_override="workframe:frame-a",
    )

    assert loop._turn_runtime_for_message(ordinary).sessions is loop.sessions
    assert loop._turn_runtime_for_message(workframe).sessions is loop.workframe.sessions


def test_workframe_initial_messages_use_isolated_memory(tmp_path: Path) -> None:
    loop = _loop(tmp_path)
    loop.context.memory.append_history("ordinary archive", session_key="websocket:chat-a")
    loop.workframe.context.memory.append_history("workframe archive", session_key="workframe:frame-a")
    session = Session(key="workframe:frame-a")
    msg = InboundMessage(
        channel="websocket",
        sender_id="client",
        chat_id="frame-a",
        content="question",
        metadata={"workframe": True},
        session_key_override="workframe:frame-a",
    )

    initial = loop._build_workframe_initial_messages(
        msg=msg,
        session=session,
        history=[],
        pending_summary=None,
        workspace=tmp_path,
        runtime_chat_id="frame-a",
        runtime_channel="websocket",
        include_memory_recent_history=True,
    )

    assert "<workspace_frame" in initial[0]["content"]
    assert "workframe archive" in initial[0]["content"]
    assert "ordinary archive" not in initial[0]["content"]
