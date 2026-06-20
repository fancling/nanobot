# Reading Companion v0.1 Design

## Goal

Reading Companion v0.1 validates whether the WorkspaceFrame/GWT request mode can support a real reading-companion scene. The goal is not to build an ebook reader. The goal is to turn lightweight reading behavior into structured foreground state that the agent can use for a higher-quality response.

The v0.1 target is:

- Paste or import plain text / Markdown content in the existing WebUI thread.
- Display enough structure for the user to focus a paragraph.
- Let the user write a short note or question about the focused passage.
- Send a bounded `reading_snapshot` with the normal chat message.
- Render that snapshot as a WorkspaceFrame module for the current LLM call.
- Keep reader document state in browser `localStorage`, scoped by `chatId`.

Out of scope:

- EPUB, PDF, foliate-js, Readium, or other rich format integration.
- Library management, multi-device sync, full-text search, advanced annotations, social reading, reading statistics, or theme systems.
- Backend storage for reading documents or reading progress.
- Reader-specific branches in `AgentLoop` or `AgentRunner`.

## Product Shape

The UI is a lightweight Reader Strip inside the existing WebUI chat thread. It lives near the composer, initially above the composer dock. The strip can be collapsed so normal chat remains the default surface.

The strip supports:

- Creating a reading document by pasting plain text or Markdown.
- Splitting the document into paragraphs.
- Clicking a paragraph to set the current focus.
- Showing the focused paragraph and small surrounding context.
- Writing a short note.
- Sending "chat about this passage" as a normal user turn with a reading snapshot attached.

The strip intentionally feels like a scene container, not a full reader. It gives the model concrete reading state without requiring the user to manually paste "I am reading..." prompts into the chat box.

## Architecture

The implementation has four narrow layers.

### 1. WebUI Reader Strip

Add a WebUI component under the existing thread surface. It owns local reader state:

- `documentId`
- `title`
- `rawText`
- parsed paragraphs
- focused paragraph id/index
- optional selected text
- note draft
- reading mode, initially `slow_reading`

The component persists this state to `localStorage` using a versioned key scoped by `chatId`, for example:

```text
nanobot.webui.readerShell.v1:<chatId>
```

If `localStorage` is unavailable or throws, the component keeps the current state in React memory and still allows sending the current snapshot.

### 2. Reading Snapshot Protocol

The WebUI attaches a bounded `reading_snapshot` object to the existing WebSocket `message` envelope. It does not create a new message type.

Shape:

```json
{
  "version": 1,
  "scene": "reading",
  "document": {
    "id": "local-doc-id",
    "title": "Document title",
    "kind": "markdown"
  },
  "location": {
    "paragraph_index": 18,
    "paragraph_count": 92,
    "progress_label": "early chapter"
  },
  "focus": {
    "focused_text": "...",
    "selected_text": null,
    "before": "...",
    "after": "...",
    "user_note": "...",
    "current_question": "..."
  },
  "reading_state": {
    "mode": "slow_reading",
    "engagement": "actively_reflecting"
  },
  "prediction": {
    "likely_need": "respond to the user's reflection about this passage",
    "bad_response_risk": "avoid generic summary"
  }
}
```

The frontend builder caps text fields before sending. The backend validates shape and caps again before placing the snapshot into prompt-visible metadata.

### 3. WebSocket Channel Metadata

`nanobot/channels/websocket.py` accepts `reading_snapshot` on `message` envelopes from WebUI clients. It performs narrow validation:

- value must be an object
- `scene` must be `reading`
- `version` must be supported
- text fields must be strings or null
- oversized fields are truncated
- malformed snapshots are rejected with a protocol error

Accepted snapshots are copied to:

```python
metadata["reading_snapshot"] = normalized_snapshot
```

No reader document state is stored server-side.

### 4. WorkspaceFrame Module

`WorkspaceFrameBuilder` checks `msg.metadata.get("reading_snapshot")`. When present, it appends a module:

```text
module_id: scene.reading
module_type: scene
priority: high
source: webui.reading_shell
ttl: current_turn
```

The module content is the normalized snapshot plus a short instruction that this represents the current reading scene. The existing frame focus can remain `event_type="user_message"`; reading semantics belong in the scene module, not in a runner branch.

## Data Flow

```text
Reader Strip event
-> reading_snapshot
-> WebSocket message envelope
-> InboundMessage.metadata["reading_snapshot"]
-> WorkspaceFrame scene.reading module
-> LLM response
```

The visible chat message remains ordinary user text, such as "聊聊这一段" or the user's specific question. The reading snapshot supplies foreground scene state.

## Prompt And Memory Behavior

The snapshot is current-turn foreground state. It should not become a hidden permanent book store.

Session history will still record the user turn and assistant reply through the existing machinery. If the visible user message includes a concise natural-language prompt and the assistant response refers to the passage, that history is enough for continuity. The raw reading document remains in browser storage only.

Future memory candidate generation can use normal session content first. A later version may add a reading-memory candidate module, but v0.1 should not create a separate memory pipeline.

## Error Handling

- Empty pasted content does not create or replace a reader document.
- If paragraph parsing produces no non-empty paragraphs, the Reader Strip shows an inline error.
- If no paragraph is focused, sending from the Reader Strip focuses the first paragraph or disables the action until the user chooses one.
- If snapshot validation fails on the server, the WebSocket channel returns a protocol error and does not publish a malformed message to the bus.
- If the snapshot is too large, text fields are truncated deterministically. The full document is never sent.
- If `localStorage` fails, the UI continues with in-memory state and indicates that local draft persistence is unavailable.

## Testing

Frontend tests:

- Paragraph parsing from plain text and Markdown-like input.
- Snapshot builder includes focused paragraph, before/after context, note, question, and progress.
- Snapshot builder truncates long fields.
- Reader state persists and restores by `chatId`.
- Sending from the Reader Strip calls the existing `send` path with `readingSnapshot` in options.

Backend tests:

- WebSocket `message` envelope accepts a valid `reading_snapshot` and stores it in inbound metadata.
- Malformed snapshots are rejected with a protocol error.
- WorkspaceFrame rendering includes a `scene.reading` module when metadata contains a snapshot.
- Long snapshot fields are bounded before rendering.
- Normal messages without snapshots render unchanged.

Manual verification:

- Start WebUI and gateway.
- Paste a short Markdown/text passage.
- Focus a paragraph, write a note, send "chat about this passage".
- Confirm the assistant responds to the passage and the user's note without needing the user to paste the passage into the chat box.

## Open Decisions Resolved

- v0.1 optimizes for WorkspaceFrame/GWT quality validation, not a complete reading product.
- The entry point is the existing chat page.
- Reading state persists in browser `localStorage`, not in backend storage.
- The recommended UI is Reader Strip now, with protocol boundaries compatible with a future right-side Reader Panel.
