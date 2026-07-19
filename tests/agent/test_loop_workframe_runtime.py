from __future__ import annotations

import asyncio
from pathlib import Path
from types import SimpleNamespace

import pytest

from nanobot.agent.context import ContextBuilder
from nanobot.agent.frame_request import FrameRequestAdapter
from nanobot.agent.loop import AgentLoop, TurnRuntime
from nanobot.agent.runner import AgentRunResult
from nanobot.agent.subagent import SubagentManager
from nanobot.agent.tools.file_state import FileStateStore
from nanobot.bus.events import InboundMessage
from nanobot.bus.queue import MessageBus
from nanobot.config.schema import WorkframeConfig, WorkframeProfileConfig
from nanobot.providers.factory import ProviderSnapshot
from nanobot.session.manager import Session, SessionManager


class _Provider:
    def __init__(self, model: str = "test-model", max_tokens: int = 4096):
        self._model = model
        self.generation = SimpleNamespace(max_tokens=max_tokens)

    def get_default_model(self) -> str:
        return self._model


class _Tools:
    tool_names = ["read_file", "web_fetch", "exec"]

    def get(self, _name: str):
        return None

    def get_definitions(self):
        return [
            {"type": "function", "function": {"name": name, "parameters": {}}}
            for name in self.tool_names
        ]


class _Commands:
    def is_priority(self, raw: str) -> bool:
        return raw.strip().lower() in {"/stop", "/restart"}

    def is_dispatchable_command(self, raw: str) -> bool:
        return raw.strip().lower() in {"/new", "/help"}

    async def dispatch(self, _ctx):
        return None

    async def dispatch_priority(self, _ctx):
        return None


class _CronTurns:
    def defer_if_active(self, *_args, **_kwargs) -> bool:
        return False

    def complete(self, *_args, **_kwargs) -> None:
        return None

    async def publish_next_deferred(self, _session_key: str) -> None:
        return None


class _RuntimeEvents:
    async def session_turn_started(self, *_args, **_kwargs) -> None:
        return None

    async def run_status_changed(self, *_args, **_kwargs) -> None:
        return None

    async def turn_completed(self, *_args, **_kwargs) -> None:
        return None

    def clear_turn(self, *_args, **_kwargs) -> None:
        return None

    def record_turn_runtime(self, *_args, **_kwargs) -> None:
        return None

    def record_turn_latency(self, *_args, **_kwargs) -> None:
        return None


def _loop(tmp_path: Path) -> AgentLoop:
    loop = AgentLoop.__new__(AgentLoop)
    loop.bus = MessageBus()
    loop.workspace = tmp_path
    loop.context_window_tokens = 16000
    loop.context_block_limit = None
    loop.max_tool_result_chars = 12000
    loop.max_iterations = 8
    loop.provider_retry_mode = "standard"
    loop.tool_hint_max_length = None
    loop._extra_hooks = []
    loop.provider = _Provider()
    loop.model = "test-model"
    loop.tools = _Tools()
    loop._unified_session = False
    loop._provider_snapshot_loader = None
    loop._max_messages = 120
    loop._mcp_servers = {}
    loop._mcp_stacks = {}
    loop.channels_config = None
    loop.context = ContextBuilder(tmp_path, timezone="UTC")
    loop.frame_request_adapter = FrameRequestAdapter(loop.context)
    loop.sessions = SessionManager(tmp_path)
    loop._consolidation_ratio = 0.5
    loop._session_ttl_minutes = 0
    loop.workspace_scopes = SimpleNamespace(
        for_message=lambda _msg, _metadata: SimpleNamespace(project_path=tmp_path),
        for_turn=lambda **_kwargs: SimpleNamespace(project_path=tmp_path),
        persist_message_scope=lambda _session, _msg: None,
    )
    loop.consolidator = SimpleNamespace(
        maybe_consolidate_by_tokens=lambda _session, **_kwargs: _noop_async(),
    )
    loop.auto_compact = SimpleNamespace(
        prepare_session=lambda session, _key: (session, None),
    )
    loop.runner = SimpleNamespace()
    loop._file_state_store = FileStateStore()
    loop._last_usage = {}
    loop._current_iteration = 0
    loop.subagents = SimpleNamespace(
        get_running_count_by_session=lambda _session_key: 0,
        cancel_by_session=lambda _session_key: _noop_async_value(0),
    )
    loop._active_tasks = {}
    loop._pending_queues = {}
    loop._session_locks = {}
    loop._concurrency_gate = None
    loop._cron_turns = _CronTurns()
    loop._running = False
    loop._connect_mcp = _noop_async
    loop._runtime_events = lambda: _RuntimeEvents()
    loop.commands = _Commands()
    loop._schedule_background = lambda coro: coro.close()
    loop.default_runtime = TurnRuntime(
        sessions=loop.sessions,
        context=loop.context,
        frame_request_adapter=loop.frame_request_adapter,
        consolidator=loop.consolidator,
        auto_compact=loop.auto_compact,
        use_workspace_frame=False,
    )
    loop.workframe = loop._build_workframe_runtime(timezone="UTC", disabled_skills=[])
    return loop


async def _noop_async() -> None:
    return None


async def _noop_async_value(value):
    return value


def test_workframe_runtime_uses_isolated_session_and_memory_roots(tmp_path: Path) -> None:
    loop = _loop(tmp_path)

    assert loop.workframe.sessions.sessions_dir == tmp_path / "workframes" / "sessions"
    assert loop.workframe.context.memory.memory_dir == tmp_path / "workframes" / "memory"


def test_workframe_run_overrides_use_surface_profile_config(tmp_path: Path) -> None:
    loop = _loop(tmp_path)
    loop.workframe_config = WorkframeConfig(
        profiles={
            "reader": WorkframeProfileConfig(
                model="reader-model",
                max_tokens=2048,
                temperature=0.2,
                reasoning_effort="high",
                context_window_tokens=262144,
            )
        }
    )

    overrides = loop._workframe_run_overrides({"surface": "reader"})

    assert overrides == {
        "model": "reader-model",
        "temperature": 0.2,
        "max_tokens": 2048,
        "reasoning_effort": "high",
        "context_window_tokens": 262144,
    }


@pytest.mark.asyncio
async def test_run_agent_loop_applies_workframe_run_overrides(tmp_path: Path) -> None:
    loop = _loop(tmp_path)
    captured = {}

    async def _run(spec):
        captured["spec"] = spec
        return AgentRunResult(final_content="ok", messages=[])

    loop.runner = SimpleNamespace(run=_run)
    session = Session(key="workframe:frame-a")

    await loop._run_agent_loop(
        [{"role": "user", "content": "hello"}],
        session=session,
        metadata={"surface": "reader"},
        session_key=session.key,
        session_manager=loop.workframe.sessions,
        run_overrides={
            "model": "reader-model",
            "temperature": 0.2,
            "max_tokens": 2048,
            "reasoning_effort": "high",
            "context_window_tokens": 262144,
        },
    )

    spec = captured["spec"]
    assert spec.model == "reader-model"
    assert spec.temperature == 0.2
    assert spec.max_tokens == 2048
    assert spec.reasoning_effort == "high"
    assert spec.context_window_tokens == 262144
    assert loop.context.memory.memory_dir == tmp_path / "memory"


@pytest.mark.asyncio
async def test_run_agent_loop_applies_workframe_tool_filters(tmp_path: Path) -> None:
    loop = _loop(tmp_path)
    loop.workframe_config = WorkframeConfig(
        profiles={
            "reader": WorkframeProfileConfig(
                tool_allowlist=["read_file", "web_fetch"],
                tool_denylist=["web_fetch"],
            )
        }
    )
    captured = {}

    async def _run(spec):
        captured["spec"] = spec
        return AgentRunResult(final_content="ok", messages=[])

    loop.runner = SimpleNamespace(run=_run)
    session = Session(key="workframe:frame-a")

    await loop._run_agent_loop(
        [{"role": "user", "content": "hello"}],
        session=session,
        metadata={"surface": "reader"},
        session_key=session.key,
        session_manager=loop.workframe.sessions,
    )

    spec = captured["spec"]
    assert spec.tools.tool_names == ["read_file"]
    assert [
        schema["function"]["name"]
        for schema in spec.tools.get_definitions()
    ] == ["read_file"]


@pytest.mark.asyncio
async def test_run_agent_loop_can_disable_workframe_tools(tmp_path: Path) -> None:
    loop = _loop(tmp_path)
    loop.workframe_config = WorkframeConfig(
        profiles={"reader": WorkframeProfileConfig(tools_enabled=False)}
    )
    captured = {}

    async def _run(spec):
        captured["spec"] = spec
        return AgentRunResult(final_content="ok", messages=[])

    loop.runner = SimpleNamespace(run=_run)
    session = Session(key="workframe:frame-a")

    await loop._run_agent_loop(
        [{"role": "user", "content": "hello"}],
        session=session,
        metadata={"surface": "reader"},
        session_key=session.key,
        session_manager=loop.workframe.sessions,
    )

    spec = captured["spec"]
    assert spec.tools.tool_names == []
    assert spec.tools.get_definitions() == []


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


def test_turn_runtime_requires_default_runtime_invariant(tmp_path: Path) -> None:
    loop = _loop(tmp_path)
    del loop.default_runtime
    ordinary = InboundMessage(
        channel="websocket",
        sender_id="client",
        chat_id="chat-a",
        content="hello",
    )

    try:
        loop._turn_runtime_for_message(ordinary)
    except AttributeError:
        pass
    else:
        raise AssertionError("_turn_runtime_for_message should not synthesize default_runtime")


def test_provider_snapshot_updates_workframe_consolidator(tmp_path: Path) -> None:
    loop = _loop(tmp_path)
    old_provider = loop.provider
    new_provider = _Provider(model="new-model", max_tokens=2048)
    calls: list[tuple[object, str, int]] = []
    loop.runner = SimpleNamespace(provider=old_provider)
    loop.subagents = SimpleNamespace(set_provider=lambda _provider, _model: None)
    loop.consolidator = SimpleNamespace(set_provider=lambda _provider, _model, _tokens: None)
    loop.workframe.consolidator.set_provider = (
        lambda provider, model, context_window_tokens: calls.append(
            (provider, model, context_window_tokens)
        )
    )
    loop._runtime_model_publisher = None

    loop._apply_provider_snapshot(
        ProviderSnapshot(
            provider=new_provider,
            model="new-model",
            context_window_tokens=32000,
            signature=("new-model",),
        ),
        publish_update=False,
    )

    assert calls == [(new_provider, "new-model", 32000)]


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


def test_workframe_turn_context_uses_workframe_session_store(tmp_path: Path) -> None:
    loop = _loop(tmp_path)
    msg = InboundMessage(
        channel="websocket",
        sender_id="client",
        chat_id="frame-a",
        content="question",
        metadata={"workframe": True},
        session_key_override="workframe:frame-a",
    )

    runtime = loop._turn_runtime_for_message(msg)
    session = runtime.sessions.get_or_create(msg.session_key)
    session.add_message("user", "workframe-only history")
    runtime.sessions.save(session)

    assert (tmp_path / "workframes" / "sessions" / "workframe_frame-a.jsonl").exists()
    assert not (tmp_path / "sessions" / "workframe_frame-a.jsonl").exists()


@pytest.mark.asyncio
async def test_process_message_routes_workframe_turn_through_workframe_runtime(
    tmp_path: Path,
) -> None:
    loop = _loop(tmp_path)
    captured_initial: list[dict] = []

    async def _run_agent_loop(initial_messages, **_kwargs):
        captured_initial.extend(initial_messages)
        return (
            "answer",
            [],
            [*initial_messages, {"role": "assistant", "content": "answer"}],
            "stop",
            False,
        )

    loop._run_agent_loop = _run_agent_loop
    msg = InboundMessage(
        channel="websocket",
        sender_id="client",
        chat_id="frame-a",
        content="question",
        metadata={"workframe": True},
        session_key_override="workframe:frame-a",
    )

    result = await loop._process_message(msg)

    assert result is not None
    assert result.content == "answer"
    assert (tmp_path / "workframes" / "sessions" / "workframe_frame-a.jsonl").exists()
    assert not (tmp_path / "sessions" / "workframe_frame-a.jsonl").exists()
    assert "<workspace_frame" in captured_initial[0]["content"]


@pytest.mark.asyncio
async def test_workframe_checkpoint_uses_workframe_session_store(tmp_path: Path) -> None:
    loop = _loop(tmp_path)
    session = loop.workframe.sessions.get_or_create("workframe:frame-a")

    async def _run(spec):
        await spec.checkpoint_callback(
            {
                "phase": "awaiting_tools",
                "assistant_message": {"role": "assistant", "content": "working"},
            }
        )
        return SimpleNamespace(
            final_content="answer",
            tools_used=[],
            messages=[{"role": "assistant", "content": "answer"}],
            stop_reason="stop",
            had_injections=False,
            usage={},
        )

    loop.runner.run = _run

    await loop._run_agent_loop(
        [{"role": "user", "content": "question"}],
        session=session,
        session_key="workframe:frame-a",
        session_manager=loop.workframe.sessions,
        metadata={"workframe": True},
    )

    assert (tmp_path / "workframes" / "sessions" / "workframe_frame-a.jsonl").exists()
    assert not (tmp_path / "sessions" / "workframe_frame-a.jsonl").exists()
    reloaded = loop.workframe.sessions.get_or_create("workframe:frame-a")
    assert reloaded.metadata["runtime_checkpoint"]["phase"] == "awaiting_tools"


@pytest.mark.asyncio
async def test_dispatch_cancel_restore_uses_workframe_session_store(tmp_path: Path) -> None:
    loop = _loop(tmp_path)
    session = loop.workframe.sessions.get_or_create("workframe:frame-a")
    session.metadata["runtime_checkpoint"] = {
        "assistant_message": {"role": "assistant", "content": "partial"},
        "completed_tool_results": [],
        "pending_tool_calls": [],
    }
    loop.workframe.sessions.save(session)

    async def _process_message(*_args, **_kwargs):
        raise asyncio.CancelledError()

    loop._process_message = _process_message
    msg = InboundMessage(
        channel="websocket",
        sender_id="client",
        chat_id="frame-a",
        content="stop me",
        metadata={"workframe": True},
        session_key_override="workframe:frame-a",
    )

    with pytest.raises(asyncio.CancelledError):
        await loop._dispatch(msg)

    ordinary = tmp_path / "sessions" / "workframe_frame-a.jsonl"
    assert not ordinary.exists()
    reloaded = loop.workframe.sessions.get_or_create("workframe:frame-a")
    assert reloaded.metadata.get("runtime_checkpoint") is None
    assert any(message.get("content") == "partial" for message in reloaded.messages)


@pytest.mark.asyncio
async def test_run_does_not_shortcut_priority_workframe_message(tmp_path: Path) -> None:
    loop = _loop(tmp_path)
    dispatched = asyncio.Event()
    inline_calls: list[str] = []

    async def _dispatch(msg):
        assert msg.metadata["workframe"] is True
        dispatched.set()
        loop.stop()

    async def _dispatch_command_inline(_msg, _key, raw, _dispatch_fn):
        inline_calls.append(raw)
        loop.stop()

    loop._dispatch = _dispatch
    loop._dispatch_command_inline = _dispatch_command_inline
    await loop.bus.publish_inbound(
        InboundMessage(
            channel="websocket",
            sender_id="client",
            chat_id="frame-a",
            content="/stop",
            metadata={"workframe": True},
            session_key_override="workframe:frame-a",
        )
    )

    task = asyncio.create_task(loop.run())
    await asyncio.wait_for(dispatched.wait(), timeout=1)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert inline_calls == []


@pytest.mark.asyncio
async def test_run_queues_dispatchable_workframe_message_instead_of_shortcut(
    tmp_path: Path,
) -> None:
    loop = _loop(tmp_path)
    queued = asyncio.Queue(maxsize=20)
    loop._pending_queues["workframe:frame-a"] = queued
    inline_calls: list[str] = []

    async def _dispatch_command_inline(_msg, _key, raw, _dispatch_fn):
        inline_calls.append(raw)
        loop.stop()

    loop._dispatch_command_inline = _dispatch_command_inline
    await loop.bus.publish_inbound(
        InboundMessage(
            channel="websocket",
            sender_id="client",
            chat_id="frame-a",
            content="/new",
            metadata={"workframe": True},
            session_key_override="workframe:frame-a",
        )
    )

    task = asyncio.create_task(loop.run())
    queued_msg = await asyncio.wait_for(queued.get(), timeout=1)
    loop.stop()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert queued_msg.content == "/new"
    assert queued_msg.metadata["workframe"] is True
    assert inline_calls == []


@pytest.mark.asyncio
async def test_system_workframe_turn_uses_workframe_session_store(tmp_path: Path) -> None:
    loop = _loop(tmp_path)

    async def _run_agent_loop(initial_messages, **_kwargs):
        return (
            "done",
            [],
            [*initial_messages, {"role": "assistant", "content": "done"}],
            "stop",
            False,
        )

    loop._run_agent_loop = _run_agent_loop
    msg = InboundMessage(
        channel="system",
        sender_id="subagent",
        chat_id="websocket:frame-a",
        content="subagent result",
        metadata={"workframe": True, "subagent_task_id": "task-1"},
        session_key_override="workframe:frame-a",
    )

    result = await loop._process_system_message(msg)

    assert result is not None
    assert result.content == "done"
    assert (tmp_path / "workframes" / "sessions" / "workframe_frame-a.jsonl").exists()
    assert not (tmp_path / "sessions" / "workframe_frame-a.jsonl").exists()


@pytest.mark.asyncio
async def test_subagent_result_preserves_origin_workframe_metadata(tmp_path: Path) -> None:
    manager = SubagentManager(
        provider=_Provider(),
        workspace=tmp_path,
        bus=MessageBus(),
        max_tool_result_chars=12000,
    )
    published: list[InboundMessage] = []

    async def _publish(msg: InboundMessage) -> None:
        published.append(msg)

    manager.bus.publish_inbound = _publish

    await manager._announce_result(
        "task-1",
        "label",
        "task",
        "result",
        {
            "channel": "websocket",
            "chat_id": "frame-a",
            "session_key": "workframe:frame-a",
            "metadata": {"workframe": True, "message_id": "origin"},
        },
        "ok",
    )

    assert published[0].metadata["workframe"] is True
    assert published[0].metadata["subagent_task_id"] == "task-1"
