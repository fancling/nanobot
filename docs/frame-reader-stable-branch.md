# Frame Reader Stable Branch

This branch establishes the first stable baseline for two related changes:

- nanobot can build LLM provider requests through an explicit Workframe entry
  backed by a Workspace Frame request context.
- the WebUI Reader is the first product surface that uses that workframe entry
  for scene-specific foreground state.

The important boundary is that Workspace Frame is a request context envelope,
not a synonym for the Reader UI and not a guarantee that every request has a
workspace foreground.

## Stable Baseline

The stable behavior for this branch is:

- Workframe turns are represented to the provider as a rendered Workspace Frame
  plus the current user event. Ordinary chat turns use the cache-friendly
  prompt path.
- Raw session history remains canonical storage inside nanobot.
- Workframe cross-turn history, memory, runtime information, tool semantics,
  and scene state are selected into frame modules before the provider call.
- `AgentRunner` still owns the current-turn provider/tool loop after the
  initial request is built.
- Provider implementations do not need special frame support; they receive
  ordinary provider messages.

Ordinary chat does not go through the Workspace Frame builder by default. It
keeps the stable system prompt plus replayed history so provider prompt caching
continues to work for daily chat.

## Reader Scope

The Reader surface is a scene-specific WebUI mode built on top of the workframe
request model.

Current Reader capabilities:

- Standalone Reader page in the WebUI.
- EPUB import through the WebUI source bundle.
- Book-scoped reader sessions.
- Section navigation based on EPUB spine content.
- Main reading space for document text.
- Right-side Reader chat stream.
- Paragraph focus by clicking a paragraph.
- Focus clearing by clicking the focused paragraph again.
- Selected text included in reading snapshots.
- Reader chat can send with or without a focused paragraph.
- Reader chat request errors use the same error notice pattern as the main chat
  panel.

The Reader stores a generated workframe id in its local reader state and sends
questions through `workframe_message` envelopes. Those envelopes carry a
normalized `reading_snapshot`; the WebSocket channel validates the snapshot
before publishing the inbound message with `session_key_override="workframe:<id>"`.
The Workspace Frame builder turns the snapshot into a current-state reading
module. That module is current foreground state, so it has higher semantic
priority than older conversation history when they conflict.

## Explicit Non-Goals

This branch is not a complete reading product. These remain outside the stable
baseline:

- full library management;
- cross-device reading progress sync;
- annotation database and export flows;
- advanced EPUB layout fidelity;
- chapter search and table-of-contents UI;
- mobile-polished long-session reading;
- provider-specific conversation continuation;
- deleting raw session history in favor of frame-only persistence.

## Source Development Runbook

When validating frame/Reader changes locally, make sure the gateway is launched
from this source checkout rather than an installed nanobot process:

```bash
cd /Users/guquan/code/nanobot
source .venv/bin/activate

PYTHONPATH=$PWD python -m nanobot.cli.commands gateway \
  --config /private/tmp/nanobot-source-config.json \
  --workspace /private/tmp/nanobot-source-workspace \
  --port 18791
```

The WebUI is served by the WebSocket channel on port `8765` by default. Port
`18791` above is the gateway health/runtime port for this source process, not
the browser UI port.

## Verification Baseline

Before treating this branch as stable, run focused backend and frontend checks:

```bash
.venv/bin/python -m pytest \
  tests/agent/test_workspace_frame.py \
  tests/agent/test_frame_request.py \
  tests/agent/test_loop_frame_request.py \
  tests/agent/test_runner_frame_tool_loop.py \
  tests/test_reading_snapshot.py \
  tests/channels/test_websocket_channel.py
```

```bash
cd webui
./node_modules/.bin/vitest run \
  src/tests/reader-mode.test.tsx \
  src/tests/reader-page.test.tsx \
  src/tests/app-layout.test.tsx \
  src/tests/reading.test.ts \
  src/tests/nanobot-client.test.ts \
  src/tests/thread-shell.test.tsx
./node_modules/.bin/tsc -p tsconfig.build.json --noEmit
npm run build
```

Expected behavior during dogfood:

- A normal chat turn does not include a Reader reading module.
- A Reader turn includes the active book, section, focus, selected text, and
  current reader prompt when available.
- A Reader chat request without focus is accepted as a book-level question.
- If the request fails before an LLM response is produced, the right panel shows
  the same style of error notice as the main chat panel and removes the local
  pending waiting state.
