# Workframe Entry Session Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a general workframe WebSocket entry that uses WorkspaceFrame requests and fully isolated session/memory storage while ordinary chat returns to the cache-friendly prompt path.

**Architecture:** Keep the WebSocket transport channel as `websocket` so outbound routing keeps working, but mark workframe turns with metadata and `session_key_override="workframe:<id>"`. AgentLoop selects a per-turn runtime bundle: ordinary turns use `workspace/sessions` plus `workspace/memory` and `ContextBuilder.build_messages()`, while workframe turns use `workspace/workframes/sessions` plus `workspace/workframes/memory` and `FrameRequestAdapter`.

**Tech Stack:** Python 3.11, asyncio, pytest, React, TypeScript, Vitest, WebSocket JSON envelopes.

---

## File Structure

- Modify `nanobot/agent/context.py`
  - Add an explicit `memory_workspace` constructor argument so prompt/bootstrap roots and memory roots can be separated.
- Modify `nanobot/agent/loop.py`
  - Add `WorkframeRuntime` and `TurnRuntime` helpers.
  - Restore ordinary chat request construction to `ContextBuilder.build_messages()`.
  - Add workframe-only request construction through `FrameRequestAdapter`.
  - Route state-machine persistence, compaction, and archival through the selected runtime.
- Modify `nanobot/channels/websocket.py`
  - Add `new_workframe`, `attach_workframe`, and `workframe_message` envelopes.
  - Reject `reading_snapshot` on ordinary `message`.
  - Publish workframe messages with `session_key_override="workframe:<id>"`.
- Modify `nanobot/webui/ws_http.py`
  - Add workframe-aware session lookup for `/api/sessions/<key>/webui-thread` only, so Reader can hydrate workframe transcripts without listing workframes in `/api/sessions`.
- Modify `nanobot/webui/gateway_services.py`
  - Store and expose the workframe session manager for HTTP/WebSocket services.
- Modify `webui/src/lib/types.ts`
  - Add outbound workframe envelope types and Reader state field.
- Modify `webui/src/lib/nanobot-client.ts`
  - Add `newWorkframe()`, `attachWorkframe()`, and `sendWorkframeMessage()`.
- Modify `webui/src/lib/reading.ts`
  - Persist `workframeId` in Reader state.
- Modify `webui/src/components/reader/ReaderPage.tsx`
  - Hydrate chat history from `websocket:<workframeId>` instead of the ordinary chat session key.
- Modify `webui/src/App.tsx`
  - Create/reuse workframes for Reader sessions and send Reader questions through `workframe_message`.
- Modify docs
  - Update `docs/superpowers/specs/2026-07-18-workframe-entry-session-isolation-design.md` to note that the transport channel remains `websocket`.
  - Update `docs/frame-reader-stable-branch.md` and `docs/webui.md` after implementation.

---

### Task 1: Split ContextBuilder Prompt Root From Memory Root

**Files:**
- Modify: `nanobot/agent/context.py`
- Test: `tests/agent/test_context_workframe_memory.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/agent/test_context_workframe_memory.py`:

```python
from __future__ import annotations

from pathlib import Path

from nanobot.agent.context import ContextBuilder


def test_context_builder_uses_separate_memory_workspace(tmp_path: Path) -> None:
    project = tmp_path / "project"
    memory_root = tmp_path / "workframes"
    project.mkdir()
    memory_root.mkdir()
    (project / "AGENTS.md").write_text("Project bootstrap instruction.", encoding="utf-8")
    (project / "memory").mkdir()
    (project / "memory" / "MEMORY.md").write_text("ordinary memory", encoding="utf-8")
    (memory_root / "memory").mkdir()
    (memory_root / "memory" / "MEMORY.md").write_text("workframe memory", encoding="utf-8")

    builder = ContextBuilder(project, timezone="UTC", memory_workspace=memory_root)

    prompt = builder.build_system_prompt(channel="websocket", workspace=project)

    assert "Project bootstrap instruction." in prompt
    assert "workframe memory" in prompt
    assert "ordinary memory" not in prompt


def test_context_builder_recent_history_comes_from_memory_workspace(tmp_path: Path) -> None:
    project = tmp_path / "project"
    memory_root = tmp_path / "workframes"
    project.mkdir()
    memory_root.mkdir()
    ordinary = ContextBuilder(project, timezone="UTC")
    workframe = ContextBuilder(project, timezone="UTC", memory_workspace=memory_root)
    ordinary.memory.append_history("ordinary recent", session_key="websocket:chat-a")
    workframe.memory.append_history("workframe recent", session_key="workframe:frame-a")

    prompt = workframe.build_system_prompt(
        channel="websocket",
        workspace=project,
        session_key="workframe:frame-a",
    )

    assert "workframe recent" in prompt
    assert "ordinary recent" not in prompt
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run:

```bash
.venv/bin/python -m pytest tests/agent/test_context_workframe_memory.py -v
```

Expected: FAIL with `TypeError: ContextBuilder.__init__() got an unexpected keyword argument 'memory_workspace'`.

- [ ] **Step 3: Implement memory root injection**

In `nanobot/agent/context.py`, change the constructor to:

```python
    def __init__(
        self,
        workspace: Path,
        timezone: str | None = None,
        disabled_skills: list[str] | None = None,
        memory_workspace: Path | None = None,
    ):
        self.workspace = workspace
        self.timezone = timezone
        self.memory = MemoryStore(memory_workspace or workspace)
        self.skills = SkillsLoader(
            workspace,
            disabled_skills=set(disabled_skills) if disabled_skills else None,
        )
```

Do not change `_load_bootstrap_files()` or `_get_identity()`; they must keep using the project workspace root.

- [ ] **Step 4: Run the focused tests**

Run:

```bash
.venv/bin/python -m pytest tests/agent/test_context_workframe_memory.py -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add nanobot/agent/context.py tests/agent/test_context_workframe_memory.py
git commit -m "feat: allow isolated context memory roots"
```

---

### Task 2: Restore Ordinary Chat To The Non-Frame Request Path

**Files:**
- Modify: `nanobot/agent/loop.py`
- Modify: `tests/agent/test_loop_frame_request.py`

- [ ] **Step 1: Replace the ordinary-chat frame expectation with a non-frame test**

In `tests/agent/test_loop_frame_request.py`, replace `test_build_initial_messages_uses_frame_only_request` with:

```python
def test_build_initial_messages_uses_cache_friendly_request(tmp_path: Path) -> None:
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

    assert [message["role"] for message in initial] == ["system", "user", "assistant", "user"]
    assert "<workspace_frame" not in initial[0]["content"]
    assert "old user text" in initial[1]["content"]
    assert "old assistant text" in initial[2]["content"]
    assert "new text" in initial[3]["content"]
    assert "Current Time:" in initial[3]["content"]
    assert "old summary" in initial[0]["content"]
```

Update `test_build_initial_messages_uses_runtime_context_chat_id` so it asserts the runtime chat id is in the current user message rather than the system frame:

```python
    assert "Chat ID: parent-id" in initial[-1]["content"]
    assert "Chat ID: thread-id" not in initial[-1]["content"]
```

Update the two media scrub tests so ordinary history still contains media breadcrumbs, but the current user image content is preserved:

```python
    assert str(png) in initial[1]["content"]
    assert "prior image text" in initial[1]["content"]
```

Leave `test_build_frame_initial_messages_embeds_system_history_in_frame` as the explicit frame-path coverage.

- [ ] **Step 2: Run the focused tests and confirm they fail**

Run:

```bash
.venv/bin/python -m pytest tests/agent/test_loop_frame_request.py -v
```

Expected: FAIL because `_build_initial_messages()` still returns a two-message WorkspaceFrame request.

- [ ] **Step 3: Implement the ordinary request builder**

In `nanobot/agent/loop.py`, add this import:

```python
from nanobot.utils.image_generation_intent import image_generation_prompt
```

Replace `_build_initial_messages()` with:

```python
    def _build_initial_messages(
        self,
        msg: InboundMessage,
        session: Session,
        history: list[dict[str, Any]],
        pending_summary: str | None,
        include_memory_recent_history: bool = True,
    ) -> list[dict[str, Any]]:
        """Build the cache-friendly initial message list for an ordinary LLM turn."""
        scope = self.workspace_scopes.for_message(msg, session.metadata)
        runtime_lines = [
            *goal_state_runtime_lines(session.metadata),
            *agent_context.runtime_lines(self, msg, scope.project_path),
        ]
        current_text = image_generation_prompt(msg.content, msg.metadata)
        return self.context.build_messages(
            history,
            current_text,
            media=msg.media or None,
            channel=msg.channel,
            chat_id=self._runtime_chat_id(msg),
            sender_id=msg.sender_id,
            session_summary=pending_summary,
            session_metadata=session.metadata,
            current_runtime_lines=runtime_lines,
            workspace=scope.project_path,
            runtime_state=None,
            inbound_message=None,
            include_memory_recent_history=include_memory_recent_history,
            session_key=session.key,
            unified_session=self._unified_session,
        )
```

Keep `_build_frame_initial_messages()` unchanged for now.

- [ ] **Step 4: Run the focused tests**

Run:

```bash
.venv/bin/python -m pytest tests/agent/test_loop_frame_request.py tests/agent/test_frame_request.py -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add nanobot/agent/loop.py tests/agent/test_loop_frame_request.py
git commit -m "fix: restore ordinary chat prompt path"
```

---

### Task 3: Add Workframe Runtime Selection In AgentLoop

**Files:**
- Modify: `nanobot/agent/loop.py`
- Test: `tests/agent/test_loop_workframe_runtime.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/agent/test_loop_workframe_runtime.py`:

```python
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
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run:

```bash
.venv/bin/python -m pytest tests/agent/test_loop_workframe_runtime.py -v
```

Expected: FAIL because `_build_workframe_runtime`, `_turn_runtime_for_message`, and `_build_workframe_initial_messages` do not exist.

- [ ] **Step 3: Add runtime helper dataclasses**

In `nanobot/agent/loop.py`, after `TurnContext`, add:

```python
@dataclass
class TurnRuntime:
    sessions: SessionManager
    context: ContextBuilder
    frame_request_adapter: FrameRequestAdapter
    consolidator: Consolidator
    auto_compact: AutoCompact
    use_workspace_frame: bool = False


@dataclass
class WorkframeRuntime(TurnRuntime):
    use_workspace_frame: bool = True
```

Add `runtime: TurnRuntime | None = None` to `TurnContext`.

- [ ] **Step 4: Build both runtimes in AgentLoop**

In `AgentLoop.__init__`, after `self.auto_compact = AutoCompact(...)`, add:

```python
        self._consolidation_ratio = consolidation_ratio
        self._session_ttl_minutes = session_ttl_minutes
        self.default_runtime = TurnRuntime(
            sessions=self.sessions,
            context=self.context,
            frame_request_adapter=self.frame_request_adapter,
            consolidator=self.consolidator,
            auto_compact=self.auto_compact,
            use_workspace_frame=False,
        )
        self.workframe = self._build_workframe_runtime(
            timezone=timezone,
            disabled_skills=disabled_skills,
        )
```

Add this method to `AgentLoop`:

```python
    def _build_workframe_runtime(
        self,
        *,
        timezone: str | None,
        disabled_skills: list[str] | None,
    ) -> WorkframeRuntime:
        workframe_root = self.workspace / "workframes"
        context = ContextBuilder(
            self.workspace,
            timezone=timezone,
            disabled_skills=disabled_skills,
            memory_workspace=workframe_root,
        )
        sessions = SessionManager(workframe_root)
        frame_request_adapter = FrameRequestAdapter(context)
        consolidator = Consolidator(
            store=context.memory,
            provider=self.provider,
            model=self.model,
            sessions=sessions,
            context_window_tokens=self.context_window_tokens,
            build_messages=context.build_messages,
            get_tool_definitions=self.tools.get_definitions,
            max_completion_tokens=self.provider.generation.max_tokens,
            consolidation_ratio=self._consolidation_ratio,
            unified_session=False,
        )
        auto_compact = AutoCompact(
            sessions=sessions,
            consolidator=consolidator,
            session_ttl_minutes=self._session_ttl_minutes,
        )
        return WorkframeRuntime(
            sessions=sessions,
            context=context,
            frame_request_adapter=frame_request_adapter,
            consolidator=consolidator,
            auto_compact=auto_compact,
            use_workspace_frame=True,
        )
```

- [ ] **Step 5: Add runtime selection and workframe builder**

In `nanobot/agent/loop.py`, add:

```python
    @staticmethod
    def _is_workframe_message(msg: InboundMessage) -> bool:
        return bool((msg.metadata or {}).get("workframe") is True)

    def _turn_runtime_for_message(self, msg: InboundMessage) -> TurnRuntime:
        if self._is_workframe_message(msg):
            return self.workframe
        return self.default_runtime
```

Add `_build_workframe_initial_messages()` based on `_build_frame_initial_messages()`, but using `self.workframe.frame_request_adapter`:

```python
    def _build_workframe_initial_messages(
        self,
        *,
        msg: InboundMessage,
        session: Session,
        history: list[dict[str, Any]],
        pending_summary: str | None,
        workspace: Path,
        runtime_chat_id: str,
        runtime_channel: str | None = None,
        skip_runtime_lines: bool = False,
        current_text: str | None = None,
        include_memory_recent_history: bool = True,
    ) -> list[dict[str, Any]]:
        runtime_lines = [*goal_state_runtime_lines(session.metadata)]
        if not skip_runtime_lines:
            runtime_lines.extend(agent_context.runtime_lines(self, msg, workspace))
        return self.workframe.frame_request_adapter.build_frame_only_messages(
            session=session,
            history=history,
            msg=msg,
            pending_summary=pending_summary,
            runtime_lines=runtime_lines,
            workspace=workspace,
            tool_names=self.tools.tool_names,
            token_budget={"conversation.recent_raw": self._replay_token_budget()},
            runtime_chat_id=runtime_chat_id,
            runtime_channel=runtime_channel,
            include_memory_recent_history=include_memory_recent_history,
            unified_session=False,
            current_text=current_text,
        )
```

- [ ] **Step 6: Run the focused tests**

Run:

```bash
.venv/bin/python -m pytest tests/agent/test_loop_workframe_runtime.py -v
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add nanobot/agent/loop.py tests/agent/test_loop_workframe_runtime.py
git commit -m "feat: add isolated workframe runtime"
```

---

### Task 4: Route The AgentLoop State Machine Through The Selected Runtime

**Files:**
- Modify: `nanobot/agent/loop.py`
- Test: `tests/agent/test_loop_workframe_runtime.py`

- [ ] **Step 1: Add a failing integration-style state-machine test**

Append to `tests/agent/test_loop_workframe_runtime.py`:

```python
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
```

- [ ] **Step 2: Run the focused tests**

Run:

```bash
.venv/bin/python -m pytest tests/agent/test_loop_workframe_runtime.py -v
```

Expected: PASS if Task 3 only introduced helpers. This test protects the expected storage path before changing the state machine.

- [ ] **Step 3: Select runtime when creating TurnContext**

In `_process_message()`, before constructing `TurnContext`, add:

```python
        runtime = self._turn_runtime_for_message(msg)
```

Pass it into `TurnContext`:

```python
            runtime=runtime,
```

- [ ] **Step 4: Replace state-machine session manager references**

In `_state_restore()`, replace:

```python
ctx.session = self.sessions.get_or_create(ctx.session_key)
```

with:

```python
ctx.session = ctx.runtime.sessions.get_or_create(ctx.session_key)
```

Replace the two `self.sessions.save(ctx.session)` calls in `_state_restore()` with `ctx.runtime.sessions.save(ctx.session)`.

In `_state_compact()`, replace `self.auto_compact.prepare_session(...)` with `ctx.runtime.auto_compact.prepare_session(...)`.

In `_state_command()`, add this at the top after `raw = ctx.msg.content.strip()`:

```python
        if ctx.runtime.use_workspace_frame:
            return "dispatch"
```

In the command shortcut save path, replace `self.sessions.save(ctx.session)` with `ctx.runtime.sessions.save(ctx.session)`.

In `_state_build()`, replace `self.consolidator.maybe_consolidate_by_tokens(...)` with `ctx.runtime.consolidator.maybe_consolidate_by_tokens(...)`.

In `_state_save()`, replace:

```python
on_archive=partial(self.context.memory.raw_archive, session_key=ctx.session_key)
```

with:

```python
on_archive=partial(ctx.runtime.context.memory.raw_archive, session_key=ctx.session_key)
```

Replace `self.consolidator.maybe_consolidate_by_tokens(...)` with `ctx.runtime.consolidator.maybe_consolidate_by_tokens(...)`.

Replace `self.sessions.save(ctx.session)` with `ctx.runtime.sessions.save(ctx.session)`.

- [ ] **Step 5: Route request construction by runtime**

In `_state_build()`, replace:

```python
        ctx.initial_messages = self._build_initial_messages(
            ctx.msg,
            ctx.session,
            ctx.history,
            ctx.pending_summary,
            include_memory_recent_history=not ctx.ephemeral,
        )
```

with:

```python
        if ctx.runtime.use_workspace_frame:
            workspace_scope = self.workspace_scopes.for_message(ctx.msg, ctx.session.metadata)
            ctx.initial_messages = self._build_workframe_initial_messages(
                msg=ctx.msg,
                session=ctx.session,
                history=ctx.history,
                pending_summary=ctx.pending_summary,
                workspace=workspace_scope.project_path,
                runtime_chat_id=ctx.msg.chat_id,
                runtime_channel=ctx.msg.channel,
                include_memory_recent_history=not ctx.ephemeral,
            )
        else:
            ctx.initial_messages = self._build_initial_messages(
                ctx.msg,
                ctx.session,
                ctx.history,
                ctx.pending_summary,
                include_memory_recent_history=not ctx.ephemeral,
            )
```

- [ ] **Step 6: Make early persistence save through the selected runtime**

Change `_persist_user_message_early()` signature to:

```python
    def _persist_user_message_early(
        self,
        msg: InboundMessage,
        session: Session,
        *,
        session_manager: SessionManager | None = None,
        **kwargs: Any,
    ) -> bool:
```

Inside the method, replace:

```python
            self.sessions.save(session)
```

with:

```python
            (session_manager or self.sessions).save(session)
```

In `_state_build()` and `_state_command()`, call:

```python
ctx.user_persisted_early = self._persist_user_message_early(
    ctx.msg,
    ctx.session,
    session_manager=ctx.runtime.sessions,
)
```

For the command `_command=True` call, include both keyword arguments:

```python
ctx.user_persisted_early = self._persist_user_message_early(
    ctx.msg,
    ctx.session,
    session_manager=ctx.runtime.sessions,
    _command=True,
)
```

- [ ] **Step 7: Run the focused backend suite**

Run:

```bash
.venv/bin/python -m pytest \
  tests/agent/test_loop_workframe_runtime.py \
  tests/agent/test_loop_frame_request.py \
  tests/agent/test_frame_request.py \
  tests/agent/test_runner_frame_tool_loop.py -v
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add nanobot/agent/loop.py tests/agent/test_loop_workframe_runtime.py
git commit -m "feat: route turns through workframe runtime"
```

---

### Task 5: Add Workframe WebSocket Envelopes

**Files:**
- Modify: `nanobot/channels/websocket.py`
- Modify: `webui/src/lib/types.ts`
- Modify: `webui/src/lib/nanobot-client.ts`
- Test: `tests/channels/test_websocket_channel.py`
- Test: `webui/src/tests/nanobot-client.test.ts`

- [ ] **Step 1: Write backend protocol tests**

Append to `tests/channels/test_websocket_channel.py` near the multiplex envelope tests:

```python
@pytest.mark.asyncio
async def test_websocket_rejects_reading_snapshot_on_ordinary_message(bus: MagicMock) -> None:
    channel = _ch(bus, port=29941)
    async with channel.run():
        async with websockets.connect("ws://127.0.0.1:29941/?client_id=test") as client:
            await client.send(json.dumps({"type": "new_chat"}))
            attached = json.loads(await client.recv())
            chat_id = attached["chat_id"]
            await client.send(json.dumps({
                "type": "message",
                "chat_id": chat_id,
                "content": "question",
                "webui": True,
                "reading_snapshot": {"document": {"title": "Book"}},
            }))
            error = json.loads(await client.recv())

    assert error["event"] == "error"
    assert error["detail"] == "reading_snapshot_requires_workframe"
    bus.publish_inbound.assert_not_called()


@pytest.mark.asyncio
async def test_workframe_message_publishes_isolated_session_key(bus: MagicMock) -> None:
    channel = _ch(bus, port=29942)
    async with channel.run():
        async with websockets.connect("ws://127.0.0.1:29942/?client_id=test") as client:
            await client.send(json.dumps({"type": "new_workframe", "surface": "reader"}))
            attached = json.loads(await client.recv())
            workframe_id = attached["workframe_id"]
            await client.send(json.dumps({
                "type": "workframe_message",
                "workframe_id": workframe_id,
                "surface": "reader",
                "content": "question",
                "webui": True,
                "reading_snapshot": {
                    "document": {"title": "Book"},
                    "location": {"paragraph_index": None, "paragraph_count": 1},
                    "focus": {
                        "focused_text": "",
                        "before": "",
                        "after": "",
                        "user_note": "",
                        "current_question": "question",
                    },
                },
            }))

    inbound = bus.publish_inbound.call_args.args[0]
    assert inbound.channel == "websocket"
    assert inbound.chat_id == workframe_id
    assert inbound.session_key_override == f"workframe:{workframe_id}"
    assert inbound.metadata["workframe"] is True
    assert inbound.metadata["surface"] == "reader"
    assert "reading_snapshot" in inbound.metadata
```

- [ ] **Step 2: Run backend tests and confirm they fail**

Run:

```bash
.venv/bin/python -m pytest tests/channels/test_websocket_channel.py::test_websocket_rejects_reading_snapshot_on_ordinary_message tests/channels/test_websocket_channel.py::test_workframe_message_publishes_isolated_session_key -v
```

Expected: FAIL because the new envelopes and rejection do not exist.

- [ ] **Step 3: Implement backend envelope handling**

In `nanobot/channels/websocket.py`, add helpers near `_is_valid_chat_id` if that helper exists:

```python
def _is_valid_workframe_id(value: Any) -> bool:
    return isinstance(value, str) and bool(re.fullmatch(r"[A-Za-z0-9._:-]{1,128}", value))


def _workframe_session_key(workframe_id: str) -> str:
    return f"workframe:{workframe_id}"
```

In `_dispatch_envelope()`, add before `if t == "new_chat":`

```python
        if t == "new_workframe":
            workframe_id = str(uuid.uuid4())
            self._attach(connection, workframe_id)
            await self._send_event(
                connection,
                "workframe_attached",
                workframe_id=workframe_id,
                surface=envelope.get("surface") if isinstance(envelope.get("surface"), str) else None,
            )
            await self._hydrate_after_subscribe(workframe_id)
            return
        if t == "attach_workframe":
            workframe_id = envelope.get("workframe_id")
            if not _is_valid_workframe_id(workframe_id):
                await self._send_event(connection, "error", detail="invalid_workframe_id")
                return
            self._attach(connection, workframe_id)
            await self._send_event(connection, "workframe_attached", workframe_id=workframe_id)
            await self._hydrate_after_subscribe(workframe_id)
            return
```

In the ordinary `message` branch, before validating `raw_reading_snapshot`, add:

```python
            if envelope.get("reading_snapshot") is not None:
                await self._send_event(
                    connection,
                    "error",
                    detail="reading_snapshot_requires_workframe",
                    chat_id=cid,
                )
                return
```

Add a new `workframe_message` branch before the ordinary `message` branch. Copy the ordinary media handling and metadata validation, but use `workframe_id` and `session_key=_workframe_session_key(workframe_id)`:

```python
        if t == "workframe_message":
            workframe_id = envelope.get("workframe_id")
            content = envelope.get("content")
            if not _is_valid_workframe_id(workframe_id):
                await self._send_event(connection, "error", detail="invalid_workframe_id")
                return
            if not isinstance(content, str):
                await self._send_event(connection, "error", detail="missing content")
                return
            raw_media = envelope.get("media")
            media_paths: list[str] = []
            if raw_media is not None and not isinstance(raw_media, list):
                await self._send_event(connection, "error", detail="image_rejected", reason="malformed")
                return
            metadata: dict[str, Any] = {
                "remote": getattr(connection, "remote_address", None),
                "workframe": True,
                "surface": envelope.get("surface") if isinstance(envelope.get("surface"), str) else "generic",
            }
            if envelope.get("webui") is True:
                metadata["webui"] = True
                metadata.update(self._transcripts.client_turn_metadata(envelope.get("turn_id")))
            raw_reading_snapshot = envelope.get("reading_snapshot")
            if raw_reading_snapshot is not None:
                try:
                    metadata["reading_snapshot"] = normalize_reading_snapshot(raw_reading_snapshot)
                except ReadingSnapshotError as exc:
                    await self._send_event(
                        connection,
                        "error",
                        detail="reading_snapshot_rejected",
                        reason=str(exc),
                    )
                    return
            if raw_media is not None:
                media_paths, reason = self._save_envelope_media(raw_media)
                if reason is not None:
                    await self._send_event(connection, "error", detail="image_rejected", reason=reason)
                    return
            if not content.strip() and not media_paths:
                await self._send_event(connection, "error", detail="missing content")
                return
            self._attach(connection, workframe_id)
            await self._hydrate_after_subscribe(workframe_id)
            if metadata.get("webui") is True and self.is_allowed(client_id):
                self._transcripts.append_user_message(
                    workframe_id,
                    content,
                    metadata=metadata,
                    media_paths=media_paths or None,
                )
            await self._handle_message(
                sender_id=client_id,
                chat_id=workframe_id,
                content=content,
                media=media_paths or None,
                metadata=metadata,
                session_key=_workframe_session_key(workframe_id),
                is_dm=False,
            )
            return
```

- [ ] **Step 4: Add frontend client types and tests**

In `webui/src/lib/types.ts`, extend `Outbound` with:

```ts
  | { type: "new_workframe"; surface?: string; workspace_scope?: WorkspaceScopePayload }
  | { type: "attach_workframe"; workframe_id: string }
```

and add a new message shape:

```ts
  | {
      type: "workframe_message";
      workframe_id: string;
      surface?: string;
      content: string;
      media?: OutboundMedia[];
      workspace_scope?: WorkspaceScopePayload;
      turn_id?: string;
      reading_snapshot?: ReadingSnapshot;
      webui?: true;
    }
```

In `webui/src/tests/nanobot-client.test.ts`, add:

```ts
it("sends workframe messages with reading snapshots", () => {
  const { client, sent } = connectedClient();
  client.sendWorkframeMessage("frame-a", "question", {
    surface: "reader",
    readingSnapshot: {
      document: { title: "Book" },
      location: { paragraph_index: null, paragraph_count: 1 },
      focus: {
        focused_text: "",
        before: "",
        after: "",
        user_note: "",
        current_question: "question",
      },
    },
  });

  expect(sent.at(-1)).toMatchObject({
    type: "workframe_message",
    workframe_id: "frame-a",
    surface: "reader",
    content: "question",
    webui: true,
  });
  expect(sent.at(-1)?.reading_snapshot).toBeDefined();
});
```

- [ ] **Step 5: Implement frontend client methods**

In `webui/src/lib/nanobot-client.ts`, add `pendingNewWorkframe` alongside `pendingNewChat`, handle `workframe_attached` in the event dispatcher, and add:

```ts
newWorkframe(
  timeoutMs: number = 5_000,
  options?: { surface?: string; workspaceScope?: WorkspaceScopePayload | null },
): Promise<string> {
  if (this.pendingNewWorkframe) {
    return Promise.reject(new Error("newWorkframe already in flight"));
  }
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      this.pendingNewWorkframe = null;
      reject(new Error("newWorkframe timed out"));
    }, timeoutMs);
    this.pendingNewWorkframe = { resolve, reject, timer };
    this.queueSend({
      type: "new_workframe",
      ...(options?.surface ? { surface: options.surface } : {}),
      ...(options?.workspaceScope ? { workspace_scope: options.workspaceScope } : {}),
    });
  });
}

attachWorkframe(workframeId: string): void {
  this.knownChats.add(workframeId);
  if (this.socket?.readyState === WS_OPEN) {
    this.queueSend({ type: "attach_workframe", workframe_id: workframeId });
  }
}

sendWorkframeMessage(
  workframeId: string,
  content: string,
  options?: {
    surface?: string;
    media?: OutboundMedia[];
    workspaceScope?: WorkspaceScopePayload | null;
    turnId?: string;
    readingSnapshot?: ReadingSnapshot;
  },
): void {
  this.knownChats.add(workframeId);
  this.queueSend({
    type: "workframe_message",
    workframe_id: workframeId,
    content,
    ...(options?.surface ? { surface: options.surface } : {}),
    ...(options?.media?.length ? { media: options.media } : {}),
    ...(options?.workspaceScope ? { workspace_scope: options.workspaceScope } : {}),
    ...(options?.turnId ? { turn_id: options.turnId } : {}),
    ...(options?.readingSnapshot ? { reading_snapshot: options.readingSnapshot } : {}),
    webui: true,
  });
}
```

- [ ] **Step 6: Run protocol tests**

Run:

```bash
.venv/bin/python -m pytest tests/channels/test_websocket_channel.py::test_websocket_rejects_reading_snapshot_on_ordinary_message tests/channels/test_websocket_channel.py::test_workframe_message_publishes_isolated_session_key -v
cd webui
./node_modules/.bin/vitest run src/tests/nanobot-client.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add nanobot/channels/websocket.py webui/src/lib/types.ts webui/src/lib/nanobot-client.ts tests/channels/test_websocket_channel.py webui/src/tests/nanobot-client.test.ts
git commit -m "feat: add workframe websocket protocol"
```

---

### Task 6: Hydrate Workframe Reader History Without Listing Workframes

**Files:**
- Modify: `nanobot/webui/ws_http.py`
- Modify: `nanobot/webui/gateway_services.py`
- Modify: `nanobot/channels/websocket.py`
- Modify: `nanobot/cli/commands.py`
- Test: `tests/channels/test_websocket_http_routes.py`

- [ ] **Step 1: Write the failing HTTP route test**

Add to `tests/channels/test_websocket_http_routes.py`:

```python
@pytest.mark.asyncio
async def test_webui_thread_reads_workframe_session_without_listing_it(tmp_path: Path, bus: MagicMock) -> None:
    ordinary = SessionManager(tmp_path / "state")
    workframes = SessionManager(tmp_path / "state" / "workframes")
    session = workframes.get_or_create("workframe:frame-a")
    session.add_message("user", "workframe question")
    session.add_message("assistant", "workframe answer")
    workframes.save(session)
    channel = _ch(
        bus,
        session_manager=ordinary,
        workframe_session_manager=workframes,
        port=29943,
    )
    headers = _auth_headers(channel)

    async with channel.run():
        thread = await _http_get(
            "http://127.0.0.1:29943/api/sessions/websocket:frame-a/webui-thread",
            headers=headers,
        )
        sessions = await _http_get("http://127.0.0.1:29943/api/sessions", headers=headers)

    assert thread.status_code == 200
    assert [m["content"] for m in thread.json()["messages"]] == [
        "workframe question",
        "workframe answer",
    ]
    assert all(row["key"] != "workframe:frame-a" for row in sessions.json()["sessions"])
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
.venv/bin/python -m pytest tests/channels/test_websocket_http_routes.py::test_webui_thread_reads_workframe_session_without_listing_it -v
```

Expected: FAIL because HTTP routing only knows the ordinary session manager.

- [ ] **Step 3: Add workframe manager to HTTP services**

In `nanobot/webui/ws_http.py`, add a constructor parameter:

```python
        workframe_session_manager: SessionManager | None = None,
```

Store it:

```python
        self.workframe_session_manager = workframe_session_manager
```

Add:

```python
    def _workframe_session_key_for_websocket_key(self, decoded_key: str) -> str | None:
        if not decoded_key.startswith("websocket:"):
            return None
        chat_id = decoded_key.split(":", 1)[1]
        if not chat_id:
            return None
        return f"workframe:{chat_id}"
```

In `_handle_webui_thread_get()`, after ordinary `session_data` lookup, fall back to the workframe manager:

```python
        if session_messages is None and self.workframe_session_manager is not None:
            workframe_key = self._workframe_session_key_for_websocket_key(decoded_key)
            workframe_data = (
                self.workframe_session_manager.read_session_file(workframe_key)
                if workframe_key is not None
                else None
            )
            raw_messages = workframe_data.get("messages") if isinstance(workframe_data, dict) else None
            if isinstance(raw_messages, list):
                session_messages = [m for m in raw_messages if isinstance(m, dict)]
```

Do not change `_handle_sessions_list()`.

Pass `agent.workframe.sessions` into `WebSocketChannel`/`WebUIHttpRouter` construction from the gateway setup path.

- [ ] **Step 4: Run the focused HTTP test**

Run:

```bash
.venv/bin/python -m pytest tests/channels/test_websocket_http_routes.py::test_webui_thread_reads_workframe_session_without_listing_it -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add nanobot/webui/ws_http.py nanobot/channels/websocket.py nanobot/cli/commands.py tests/channels/test_websocket_http_routes.py
git commit -m "feat: hydrate workframe webui threads"
```

---

### Task 7: Move Reader State And Sends To Workframes

**Files:**
- Modify: `webui/src/lib/reading.ts`
- Modify: `webui/src/components/reader/ReaderPage.tsx`
- Modify: `webui/src/App.tsx`
- Test: `webui/src/tests/reading.test.ts`
- Test: `webui/src/tests/reader-page.test.tsx`
- Test: `webui/src/tests/app-layout.test.tsx`

- [ ] **Step 1: Add failing Reader state tests**

In `webui/src/tests/reading.test.ts`, add:

```ts
it("persists reader workframe ids", () => {
  const state = {
    documentId: "book-1",
    title: "Book",
    rawText: "Text",
    readerSession: true,
    workframeId: "frame-a",
  };

  expect(saveReaderState("chat-a", state)).toBe(true);
  expect(loadReaderState("chat-a")?.workframeId).toBe("frame-a");
});
```

In `webui/src/tests/reader-page.test.tsx`, update the existing history-key expectation:

```ts
expect(useSessionHistoryMock).toHaveBeenCalledWith("websocket:frame-a");
```

Use a Reader state fixture that includes `workframeId: "frame-a"`.

- [ ] **Step 2: Run failing frontend tests**

Run:

```bash
cd webui
./node_modules/.bin/vitest run src/tests/reading.test.ts src/tests/reader-page.test.tsx
```

Expected: FAIL because Reader state does not persist `workframeId` and ReaderPage still uses the ordinary session key.

- [ ] **Step 3: Persist `workframeId` in Reader state**

In `webui/src/lib/reading.ts`, add to `ReaderState`:

```ts
  workframeId?: string;
```

In `parseReaderStatePayload()`, include:

```ts
    workframeId: typeof maybe.workframeId === "string" ? maybe.workframeId : undefined,
```

- [ ] **Step 4: Hydrate Reader chat from the workframe id**

In `webui/src/components/reader/ReaderPage.tsx`, replace:

```ts
  const {
    messages,
    loading: chatLoading,
    refresh: refreshHistory,
    hasPendingToolCalls,
  } = useSessionHistory(sessionKey);
```

with:

```ts
  const workframeSessionKey = state?.workframeId ? `websocket:${state.workframeId}` : null;
  const {
    messages,
    loading: chatLoading,
    refresh: refreshHistory,
    hasPendingToolCalls,
  } = useSessionHistory(workframeSessionKey);
```

Replace `activeChatId` derivation with:

```ts
  const activeChatId = state?.workframeId ?? null;
```

Keep `sessionKey` in props for now only if existing routing still needs it; remove it after tests prove no caller uses it.

- [ ] **Step 5: Create workframes during Reader import**

In `webui/src/App.tsx`, update the Reader import flow so after a reader-backed chat is created, it also creates a workframe:

```ts
const workframeId = await client.newWorkframe(CHAT_CREATE_TIMEOUT_MS, {
  surface: "reader",
  workspaceScope: activeWorkspaceScope,
});
```

Save it into Reader state:

```ts
saveReaderState(chatId, {
  ...imported,
  workframeId,
});
```

When opening an existing Reader session without a `workframeId`, create one lazily and persist it before allowing sends.

- [ ] **Step 6: Send Reader questions through workframe messages**

In `webui/src/App.tsx`, replace the Reader `onSendReading` body with:

```tsx
onSendReading={(content, snapshot) => {
  const workframeId = readerState?.workframeId;
  if (!workframeId) return;
  client.sendWorkframeMessage(workframeId, content, {
    surface: "reader",
    ...(activeWorkspaceScope ? { workspaceScope: activeWorkspaceScope } : {}),
    readingSnapshot: snapshot,
  });
}}
```

- [ ] **Step 7: Update app-layout tests**

In `webui/src/tests/app-layout.test.tsx`, update Reader import mocks to expect `new_workframe` and Reader sends to expect `workframe_message`. Use this assertion shape:

```ts
expect(sentFrames.some((frame) => frame.type === "new_workframe" && frame.surface === "reader")).toBe(true);
expect(sentFrames.at(-1)).toMatchObject({
  type: "workframe_message",
  workframe_id: expect.any(String),
  surface: "reader",
});
```

- [ ] **Step 8: Run frontend focused tests**

Run:

```bash
cd webui
./node_modules/.bin/vitest run \
  src/tests/reading.test.ts \
  src/tests/reader-page.test.tsx \
  src/tests/app-layout.test.tsx \
  src/tests/reader-mode.test.tsx \
  src/tests/nanobot-client.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add webui/src/lib/reading.ts webui/src/components/reader/ReaderPage.tsx webui/src/App.tsx webui/src/tests/reading.test.ts webui/src/tests/reader-page.test.tsx webui/src/tests/app-layout.test.tsx
git commit -m "feat(webui): move reader chat to workframes"
```

---

### Task 8: Update Docs And Stable Branch Notes

**Files:**
- Modify: `docs/superpowers/specs/2026-07-18-workframe-entry-session-isolation-design.md`
- Modify: `docs/frame-reader-stable-branch.md`
- Modify: `docs/webui.md`
- Modify: `docs/architecture.md`

- [ ] **Step 1: Correct the transport-channel wording in the spec**

In `docs/superpowers/specs/2026-07-18-workframe-entry-session-isolation-design.md`, replace the request path line:

```text
The channel publishes `InboundMessage` with `channel="workframe"` and
metadata such as `{"workframe": true, "surface": "reader"}`.
```

with:

```text
The WebSocket channel publishes `InboundMessage` with `channel="websocket"`,
`chat_id=<workframe_id>`, `session_key_override="workframe:<workframe_id>"`,
and metadata such as `{"workframe": true, "surface": "reader"}`. The transport
channel remains WebSocket so existing outbound routing can deliver replies.
```

- [ ] **Step 2: Update public docs**

In `docs/frame-reader-stable-branch.md`, change the stable baseline from “New agent turns are represented to the provider as a rendered Workspace Frame” to:

```text
Workframe turns are represented to the provider as a rendered Workspace Frame
plus the current user event. Ordinary chat turns use the cache-friendly prompt
path.
```

In `docs/webui.md`, add under Reader:

```text
Reader chat uses a workframe session, separate from the ordinary chat session
list. The Reader page stores the associated workframe id locally and sends
reading snapshots only through the workframe WebSocket protocol.
```

In `docs/architecture.md`, update the Workspace Frame section:

```text
WorkspaceFrame is no longer the default request envelope for every chat turn.
It is selected by workframe entry points such as Reader. Workframe sessions and
their memory archive live under `workframes/` so ordinary chat history and
prompt-cache behavior remain separate.
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-07-18-workframe-entry-session-isolation-design.md docs/frame-reader-stable-branch.md docs/webui.md docs/architecture.md
git commit -m "docs: document workframe entry boundaries"
```

---

### Task 9: Final Verification

**Files:**
- No code edits expected.

- [ ] **Step 1: Run backend focused checks**

Run:

```bash
.venv/bin/python -m pytest \
  tests/agent/test_context_workframe_memory.py \
  tests/agent/test_loop_workframe_runtime.py \
  tests/agent/test_loop_frame_request.py \
  tests/agent/test_frame_request.py \
  tests/agent/test_workspace_frame.py \
  tests/agent/test_runner_frame_tool_loop.py \
  tests/test_reading_snapshot.py \
  tests/channels/test_websocket_channel.py \
  tests/channels/test_websocket_http_routes.py -v
```

Expected: PASS.

- [ ] **Step 2: Run lint for touched Python areas**

Run:

```bash
uv run ruff check nanobot/agent/context.py nanobot/agent/loop.py nanobot/channels/websocket.py nanobot/webui/ws_http.py tests/agent/test_context_workframe_memory.py tests/agent/test_loop_workframe_runtime.py tests/channels/test_websocket_channel.py tests/channels/test_websocket_http_routes.py
```

Expected: PASS.

- [ ] **Step 3: Run frontend focused checks**

Run:

```bash
cd webui
./node_modules/.bin/vitest run \
  src/tests/reading.test.ts \
  src/tests/reader-page.test.tsx \
  src/tests/app-layout.test.tsx \
  src/tests/reader-mode.test.tsx \
  src/tests/nanobot-client.test.ts \
  src/tests/useSessions.test.tsx
./node_modules/.bin/tsc -p tsconfig.build.json --noEmit
```

Expected: PASS.

- [ ] **Step 4: Inspect final diff**

Run:

```bash
git status --short
git log --oneline -8
```

Expected: working tree is clean after commits, and recent commits match the task commits above.
