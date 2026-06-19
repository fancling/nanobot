# Workspace Frame Request Mode Design

## Summary

Nanobot should communicate with LLM providers through a per-call Workspace Frame
rather than replaying a provider-visible chat transcript across turns.

The first implementation is `Frame-Only Adapter v0.1`. It keeps the existing
agent loop, session storage, memory files, compaction, and tool loop intact, but
short-circuits the initial provider request for each turn:

```text
session / memory / runtime / current event / tools
        -> WorkspaceFrameBuilder
        -> WorkspaceFrame
        -> WorkspaceFrameRenderer
        -> provider messages:
           [system: rendered frame, user: current event]
```

The provider sees the current workspace frame and current event. Nanobot owns
cross-turn continuity.

## Motivation

Each LLM request is treated as a fresh "foreground moment" rather than a durable
ongoing self. The runtime must construct the currently active foreground state
before every provider call. That foreground state is not a generic summary of
old messages; it is a Global Self Workspace Snapshot containing the identity,
relationship state, current task, memory, environment, available tools, and
unfinished work relevant to this moment.

This changes the role of session history. Raw history remains canonical
continuity and audit data inside Nanobot, but it is no longer the provider
request's primary structure.

## Goals

- Send frame-only initial provider requests for new turns.
- Preserve existing session persistence and raw continuity.
- Preserve the current `AgentRunner` tool-call loop within a turn.
- Build frames from structured runtime sources rather than parsing rendered
  legacy prompts.
- Keep provider implementations unchanged.
- Keep the first implementation reviewable and reversible at the adapter
  boundary.

## Non-Goals

- No autonomous no-input loop in v0.1.
- No rewrite of Dream, auto-compact, or memory consolidation algorithms.
- No deletion of raw session history.
- No provider-specific session state or cross-turn provider continuation.
- No database migration for structured memory/state.
- No attempt to infer rich emotion, interests, or relationship state beyond
  what existing memory/session sources already expose.

## Current Behavior

Today, a turn is built as:

```text
system prompt
  + replayed session history
  + current user message with runtime context
  -> provider.chat()
```

`Session.messages` is both the raw conversation log and the provider replay
source. Compaction produces summaries that are injected into the system prompt
as archived context.

## Target Behavior

For each new turn, Nanobot sends:

```python
[
    {"role": "system", "content": rendered_workspace_frame},
    {"role": "user", "content": current_event},
]
```

Replayed history is not sent as ordinary chat messages. Instead, selected raw
history and derived summaries become frame modules, such as
`conversation.recent_raw` and `conversation.archived_summary`.

Within a single turn, `AgentRunner` continues to append assistant tool calls,
tool results, and follow-up assistant messages to the local message chain. That
local chain is required by function/tool calling protocols and remains scoped
to the current run.

```text
cross-turn continuity = Nanobot runtime
single-turn tool loop = provider message chain
```

## Architecture

### New Modules

Add `nanobot/agent/workspace_frame.py`:

- `WorkspaceFrame`
- `WorkspaceFrameFocus`
- `WorkspaceFrameModule`
- `WorkspaceFramePolicy`
- `WorkspaceFrameMeta`
- `WorkspaceFrameBuilder`
- `WorkspaceFrameRenderer`

Add `nanobot/agent/frame_request.py`:

- `FrameRequestAdapter`
- `build_frame_only_messages(...)`

The adapter owns the short-circuit from structured runtime inputs to the final
provider-visible initial messages.

### Existing Modules Kept

The first implementation keeps these systems in place:

- `AgentLoop` state machine
- `Session.messages`
- `memory/history.jsonl`
- Dream and auto-compact
- `ContextBuilder` helper methods
- `AgentRunner` and its tool loop
- Provider implementations

### Integration Point

The adapter should run in `AgentLoop._state_build()` or immediately below
`_build_initial_messages()`, where structured runtime objects are still
available:

```python
ctx.history = ctx.session.get_history(...)

ctx.initial_messages = self.frame_request_adapter.build_frame_only_messages(
    session=ctx.session,
    history=ctx.history,
    msg=ctx.msg,
    pending_summary=ctx.pending_summary,
    context=self.context,
    runtime_state=self,
    tools=ctx.tools or self.tools,
)
```

The implementation may keep the legacy `_build_initial_messages()` path for
debugging or rollback, but the default provider request should be frame-only.

## Workspace Frame Shape

The internal typed object follows this v0.1 shape:

```json
{
  "frame_id": "uuid",
  "frame_type": "agent_os_workspace_frame",
  "created_at": "datetime",
  "focus": {},
  "modules": [],
  "policy": {},
  "meta": {}
}
```

### Focus

`focus` describes what this frame is currently processing:

- `event_type`: `user_message`, `app_event`, `scheduler`, or
  `internal_trigger`
- `current_input`: current event payload after existing input normalization,
  including image-generation intent rewriting when applicable
- `active_topic`: optional in v0.1
- `active_question`: optional in v0.1
- `dialogue_anchor`: session key, channel, and chat id

### Modules

Each module contains activation, content, lifecycle, provenance, and visibility
metadata. v0.1 modules:

- `self.identity`
  - Type: `self_context`
  - Content: runtime, workspace path, platform/channel format policy
- `bootstrap.agents`
  - Type: `policy`
  - Content: `AGENTS.md`, if present
- `bootstrap.soul`
  - Type: `self_context`
  - Content: `SOUL.md`, if present
- `bootstrap.user`
  - Type: `self_context`
  - Content: `USER.md`, if present
- `tool.contract`
  - Type: `tool_affordance`
  - Content: current tool contract semantics
- `memory.long_term`
  - Type: `memory`
  - Content: `memory/MEMORY.md`, if customized
- `skills.always`
  - Type: `domain_state`
  - Content: always-on skill text
- `skills.available`
  - Type: `tool_affordance`
  - Content: available skills summary
- `conversation.recent_raw`
  - Type: `conversation_context`
  - Content: recent selected raw session messages with a strict token cap
- `conversation.archived_summary`
  - Type: `conversation_context`
  - Content: pending compact summary, marked as derived state
- `runtime.current`
  - Type: `world_state`
  - Content: time, channel, chat id, sender id, goal state, MCP lines, CLI app
    lines, and other runtime annotations
- `tool.available`
  - Type: `tool_affordance`
  - Content: available tool names and any concise affordance metadata that is
    available without duplicating provider tool schemas

### Policy

`policy` describes how the frame should be turned into language or action:

- `response_mode`: `task_execution` by default
- `tone`: inherited from channel format policy
- `depth`: `medium` by default
- `should_do`: high-priority behavioral requirements
- `should_avoid`: high-priority prohibitions
- `action_constraints`: workspace and tool-use constraints

### Meta

`meta` supports engineering and observability:

- `schema_version`: `0.1`
- `token_budget`: per-section caps and estimated use
- `builder_trace`: which sources produced which modules
- `render_mode`: `xmlish`

## Rendering

`WorkspaceFrameRenderer` renders the typed frame into xml-ish semi-structured
text. It should not dump raw internal JSON directly.

Example shape:

```text
<workspace_frame schema_version="0.1" frame_id="...">
<focus>
event_type: user_message
dialogue_anchor: cli:direct
</focus>

<modules>
<module id="self.identity" type="self_context" priority="critical">
...
</module>
</modules>

<policy>
response_mode: task_execution
...
</policy>
</workspace_frame>
```

Only modules with `visibility.expose_to_llm = true` are rendered.

## Data Sources

The builder must use structured sources directly:

- `Session.messages`
- `Session.get_history(...)`
- `memory/MEMORY.md`
- `memory/history.jsonl`
- `SOUL.md`
- `USER.md`
- `AGENTS.md`
- `SkillsLoader`
- `ToolRegistry`
- `InboundMessage`
- `session.metadata`
- `runtime_lines(...)`
- `goal_state_runtime_lines(...)`
- `pending_summary`
- workspace scope

It must not parse rendered legacy system markdown to recover modules. Rendered
legacy prompt text may be retained as a fallback/debug module only if needed.

## Session Semantics

`Session.messages` remains canonical raw continuity. Its role changes:

```text
before: provider replay source
after: frame material and audit log
```

This preserves raw continuity while preventing the provider request from
becoming a long chat transcript. Derived summaries and selected raw snippets are
foregrounded explicitly as modules with provenance.

## Tool Loop Semantics

The adapter only transforms the initial request for a new turn. Once
`AgentRunner` starts, the current-turn message chain must remain valid for tool
calling:

```text
rendered frame
+ current event
+ assistant tool_call
+ tool result
+ assistant follow-up
```

The adapter must not re-compress this chain on subsequent iterations in the
same run.

## Error Handling

- If frame building fails, raise a clear exception and let the existing run
  error path handle the failure.
- If an optional source is unavailable, omit that module and record the omission
  in `meta.builder_trace`.
- If token estimates exceed the configured context budget, truncate lower
  priority modules first, especially `conversation.recent_raw`.
- Critical modules such as `tool.contract`, workspace policy, and current event
  should not be silently dropped.

## Testing

Add focused tests for the new boundary:

- Initial provider request does not contain replayed session history messages.
- Rendered frame contains `conversation.recent_raw`.
- Current event remains an independent user message.
- `pending_summary` becomes `conversation.archived_summary`.
- Runtime metadata becomes `runtime.current`.
- `visibility.expose_to_llm = false` modules are not rendered.
- The `AgentRunner` tool loop still appends tool-call and tool-result messages
  after the frame-only initial request.

Existing tests that assert history replay should be updated to assert frame
module inclusion instead.

## Migration Plan

1. Add the typed frame model, builder, renderer, and adapter.
2. Wire the adapter into the initial turn build path.
3. Update tests for the new provider request semantics.
4. Keep legacy prompt construction available only as internal fallback/debug
   while the new mode stabilizes.
5. Later versions can move more of `ContextBuilder` into structured frame
   building and clean up session compaction semantics.

## Implementation Decisions

- Frame-only mode is the default behavior. An emergency environment escape hatch
  may be added for local debugging, but it should not become a user-facing
  alternate architecture in v0.1.
- `conversation.recent_raw` should start with a conservative cap derived from
  the existing replay budget and must be the first large module truncated when
  space is tight.
- `current_event` remains an independent user message in v0.1. It may also be
  mirrored into `focus.current_input`, but the provider-visible request keeps
  the stable `system + user` shape.
