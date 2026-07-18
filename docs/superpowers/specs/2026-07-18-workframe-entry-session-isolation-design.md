# Workframe Entry And Session Isolation Design

## Context

The current WorkspaceFrame request format is useful for foreground-state
interactions, but it is too expensive for ordinary daily chat because the frame
system prompt changes often and weakens provider prompt caching. Reader should
continue to use this richer exchange model, but the model should not be
Reader-specific. The product boundary is a general workframe interaction
surface, with Reader as the first client.

## Goals

- Add an explicit workframe entry point for model information exchange based on
  WorkspaceFrame.
- Keep ordinary chat on the cache-friendly non-frame request path.
- Isolate workframe sessions, compacted summaries, and recent-history memory
  from ordinary chat sessions.
- Keep Reader behavior as the first workframe client without naming the backend
  protocol after Reader.
- Preserve existing provider and tool contracts: providers still receive normal
  message arrays, and tools still execute through AgentRunner.

## Non-Goals

- Build a full workframe session list UI.
- Replace ordinary chat storage with frame-only persistence.
- Run a second AgentLoop process.
- Make WorkspaceFrame provider-specific.
- Migrate existing ordinary sessions into workframe storage.

## Recommended Approach

Use the existing WebSocket connection but add explicit workframe envelope types:

- `new_workframe`
- `attach_workframe`
- `workframe_message`

Ordinary `new_chat` and `message` remain ordinary chat protocol. They use the
normal session store and normal request builder. Workframe envelopes use a
separate runtime bundle with separate session and memory roots, then build the
LLM request through `FrameRequestAdapter`.

This keeps the deployment surface small while making the behavioral boundary
explicit. It also leaves room for future clients such as browser, file, or
canvas workframes without coupling the protocol to Reader.

## Runtime Ownership

Add a small runtime holder for workframe state, equivalent to:

```python
@dataclass
class WorkframeRuntime:
    sessions: SessionManager
    context: ContextBuilder
    frame_request_adapter: FrameRequestAdapter
    consolidator: Consolidator
    auto_compact: AutoCompact
```

The ordinary runtime keeps using:

```text
workspace/
  sessions/
  memory/
```

The workframe runtime uses:

```text
workspace/
  workframes/
    sessions/
    memory/
```

`WorkspaceFrameBuilder` does not read session files directly. It receives
`session`, `history`, and `pending_summary` from the caller, and it reads memory
through its `ContextBuilder`. Therefore workframe isolation must include both
the `SessionManager` and the `ContextBuilder.memory` root. Otherwise workframe
turns could still see ordinary recent history through `memory/history.jsonl`.

The workframe `ContextBuilder` should use the project workspace as the identity
and bootstrap root, but use `workspace/workframes` as its memory root. If this
requires a small constructor extension, prefer making the memory root explicit
instead of special-casing Workframe in `WorkspaceFrameBuilder`.

## Request Paths

Ordinary chat:

1. WebSocket receives `message`.
2. AgentLoop uses `self.sessions`.
3. AgentLoop calls `ContextBuilder.build_messages()`.
4. The provider sees stable system prompt, replayed raw history, current user
   input, and runtime metadata in the existing format.

Workframe:

1. WebSocket receives `workframe_message`.
2. The WebSocket channel publishes `InboundMessage` with `channel="websocket"`,
   `chat_id=<workframe_id>`, `session_key_override="workframe:<workframe_id>"`,
   and metadata such as `{"workframe": true, "surface": "reader"}`. The
   transport channel remains WebSocket so existing outbound routing can deliver
   replies.
3. AgentLoop chooses `self.workframe.sessions`.
4. AgentLoop gets history from the workframe session only.
5. Workframe auto-compact and consolidation use the workframe memory root.
6. AgentLoop calls `_build_workframe_initial_messages()`.
7. `FrameRequestAdapter` renders a WorkspaceFrame plus the current user event.

Reader sends `reading_snapshot` only through `workframe_message`. The
WorkspaceFrame builder turns it into `scene.reading`, but the workframe protocol
is still generic.

## Session Keys And Storage

Use generated workframe ids rather than ordinary chat ids. Session keys should
be stable and readable, for example:

```text
workframe:<workframe_id>
```

The storage directory is the hard isolation boundary, not the prefix. The prefix
exists for logs, debugging, and future filtering.

Ordinary `/api/sessions` lists only ordinary sessions. Workframe sessions should
not appear there. A future `/api/workframes/sessions` can be added when a
workframe library UI exists.

Fork, delete, generated titles, workspace scope metadata, and transcript
hydration must operate on the matching session store. Workframe operations must
not read or mutate ordinary `sessions/*.jsonl`.

## WebSocket Protocol

`new_workframe` creates a workframe id and returns an attached event such as:

```json
{
  "type": "workframe_attached",
  "workframe_id": "..."
}
```

`attach_workframe` subscribes the connection to outbound events for that
workframe id.

`workframe_message` accepts:

```json
{
  "type": "workframe_message",
  "workframe_id": "...",
  "surface": "reader",
  "content": "...",
  "reading_snapshot": {}
}
```

`reading_snapshot` is valid only for workframe messages. If a normal `message`
includes `reading_snapshot`, the channel should return a clear protocol error,
for example `reading_snapshot_requires_workframe`, instead of silently routing
the turn through WorkspaceFrame.

## Reader Integration

Reader should create or attach a workframe session when importing/opening a
book. Its local persisted Reader state stores the associated `workframe_id`.

Reader chat sends `workframe_message` with `surface="reader"` and the current
reading snapshot. Replies render in the Reader chat panel. Ordinary chat
composer code should not send `reading_snapshot` or any workframe mode flag.

Reader can continue storing draft reading state in local browser storage for
the first version. Server-side workframe history is the chat transcript for
model continuity, not a full book database.

## Error Handling

- Reject malformed workframe ids before publishing to the bus.
- Reject `reading_snapshot` on ordinary `message` envelopes.
- Validate `reading_snapshot` before media persistence, as current code does.
- Workframe messages must contain text or media.
- Unknown workframe ids may be auto-created in the same style as ordinary chat,
  but only after id validation. If stricter lifecycle tracking is later needed,
  require `new_workframe` before first message.
- Workframe failures should use the same outbound error-notice pattern that
  Reader chat already uses.

## Testing

Backend focused tests:

- Ordinary `_build_initial_messages()` does not include `<workspace_frame>`.
- Ordinary `_build_initial_messages()` includes normal prompt, history, current
  user content, and runtime context.
- Workframe messages use `<workspace_frame>`.
- Workframe session files are written under `workspace/workframes/sessions`.
- Workframe recent history is written under `workspace/workframes/memory`.
- Ordinary recent history is not visible to workframe frame construction.
- Workframe recent history is not visible to ordinary chat prompt construction.
- Normal `message` with `reading_snapshot` returns
  `reading_snapshot_requires_workframe`.
- `workframe_message` with `reading_snapshot` renders `scene.reading`.
- `/api/sessions` does not list workframe sessions.

Frontend focused tests:

- Reader creates a workframe instead of a normal chat.
- Reader stores and reuses the returned `workframe_id`.
- Reader sends `workframe_message` with `surface="reader"` and
  `reading_snapshot`.
- Ordinary chat `sendMessage` does not send reading snapshots.
- Reader replies still render in the Reader chat panel.

## Rollout

1. Restore ordinary chat to `ContextBuilder.build_messages()`.
2. Add workframe runtime storage and request building.
3. Add WebSocket workframe envelopes.
4. Move Reader to the workframe envelopes.
5. Tighten protocol rejection for `reading_snapshot` on ordinary messages.
6. Update docs and focused tests.

This order keeps ordinary chat cost reduction testable before the Reader client
migration is complete.
