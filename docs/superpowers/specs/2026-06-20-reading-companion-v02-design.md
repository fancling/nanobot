# Reading Companion v0.2 Design

## Goal

Reading Companion v0.2 turns the v0.1 Reader Strip into a focused in-chat Reader mode. The goal is a more immersive reading experience without becoming a full ebook reader product.

The user-approved product boundary is:

- Reader is a mode inside the current chat, not a separate global workbench or route.
- The main space is the reading document.
- The right side is a companion rail.
- Clicking a paragraph sets the current focus.
- Selecting text enables asking about the selection.
- Notes and questions are lightweight paragraph actions, not persistent form fields.
- EPUB is supported through an open-source client-side import/parser path.
- The existing `reading_snapshot` and WorkspaceFrame `scene.reading` flow remain the backend contract.

Out of scope:

- A bookshelf/library, multi-document management, multi-device sync, full annotation database, bookmarks, reading statistics, pagination engine, typography settings suite, or separate reader route.
- Server-side storage for EPUB contents or reading progress.
- Reader-specific branches in `AgentLoop` or `AgentRunner`.

## Product Shape

Reader mode replaces the normal message transcript region for the active chat. The shell still belongs to the same chat: the session header, model/workspace controls, and send path remain connected to the current `chatId`.

The desktop layout has two primary regions:

- **Document region**: left/center, dominant width, optimized for continuous prose. It renders paragraphs from pasted Markdown/text or imported EPUB content. Each paragraph is clickable and can become the focused paragraph.
- **Companion rail**: right side, fixed-width panel for current focus, agent identity, quick actions, and recent companion response context.

The existing collapsed Reader Strip can remain as the entry point from normal chat. Opening it switches the current thread into Reader mode. Exiting Reader mode returns to the chat transcript.

## Agent Presence

The selected agent presence model is Hybrid.

The companion rail includes a stable agent identity area near the top. This area reserves layout for an agent image/avatar, name/status, and concise state such as "reading with you" or "thinking about the selected text".

Reader mode also provides a small floating avatar/status container above the reader UI for active states. It must be treated as presentation, not core layout:

- It must not cover selected text, paragraph action popovers, or the send controls.
- It can be hidden without losing functionality.
- On small screens it collapses into the rail or bottom companion sheet.
- v0.2 only needs the container and state hooks; rich animation and custom character rendering can come later.

## Interaction Model

### Paragraph Focus

Clicking a paragraph updates `focusedParagraphIndex`. The focused paragraph gets a quiet highlight and is used as `reading_snapshot.focus.focused_text`.

The document should preserve reading flow:

- Paragraphs look like prose, not chips or cards.
- Hover/focus affordances are subtle.
- The selected focus is visible but not visually loud.

### Paragraph Actions

`note` and `question` stop being always-visible form fields. They become lightweight actions attached to the current paragraph:

- Ask about this paragraph.
- Add a note/reflection for this paragraph.
- Explain or connect this paragraph.

For v0.2, notes can remain transient and be included only in the next snapshot as `focus.user_note`. They do not need a persisted annotations model.

### Text Selection

Selecting text inside the document captures `selectedText` and shows a small contextual action near the selection when possible.

The primary action is "Ask about selection". Sending uses:

- `focus.focused_text`: the paragraph containing the selection when detectable, otherwise the current focused paragraph.
- `focus.selected_text`: the selected text, capped by existing snapshot limits.
- `focus.current_question`: the user's typed or generated question.

If browser selection geometry is unavailable, the action can fall back to the companion rail.

## EPUB Support

EPUB support is an import path, not a full EPUB reader.

Use an open-source client-side EPUB parser such as `epubjs` to load an uploaded `.epub` file in the browser. The import flow extracts readable chapter text and converts it into the same internal paragraph model used by pasted text.

The internal reader state should add only minimal metadata needed by v0.2:

- `documentId`
- `title`
- `rawText` or normalized paragraph source text
- `documentKind`: `text`, `markdown`, or `epub`
- `focusedParagraphIndex`
- `selectedText`
- transient current action state

The snapshot builder sets `document.kind` to `epub` for imported EPUB content. The backend validation already accepts bounded string kinds and does not need EPUB-specific logic.

EPUB limitations for v0.2:

- No server upload or persistence.
- No original EPUB layout fidelity.
- No page numbers, table of contents UI beyond basic imported title/chapter text if inexpensive.
- No DRM handling.

## Architecture

### Frontend Components

Add a dedicated Reader mode surface under the existing thread components.

Recommended component split:

- `ReaderStrip`: remains the small entry/collapsed control and persistence bridge where appropriate.
- `ReaderMode`: owns the two-column immersive layout for the current chat.
- `ReaderDocument`: renders paragraphs, focus state, and selection capture.
- `ReaderCompanionRail`: renders agent identity, current focus summary, paragraph actions, and send affordances.
- `ReaderAgentPresence`: optional floating avatar/status container.
- `readerEpub` utility: imports EPUB into the existing reader document model.

This keeps the v0.2 UI isolated while preserving the existing `buildReadingSnapshot`, `saveReaderState`, and `loadReaderState` concepts.

### State And Persistence

Reader state stays scoped by `chatId` in `localStorage` using the existing versioned storage pattern. A small migration can extend the state with `documentKind` and Reader mode UI flags.

If `localStorage` is unavailable, Reader mode continues in memory and shows the existing persistence warning pattern.

### Sending

Reader mode sends through the existing WebUI chat send path with `readingSnapshot` attached. It does not introduce a new WebSocket event type.

The visible user message should be natural and short, for example:

- the user's explicit question,
- "聊聊这一段",
- "解释我选中的这段",
- or a localized equivalent.

The structured snapshot carries the passage, selection, note, and current reading state.

### WorkspaceFrame

No backend architecture change is required. Accepted snapshots continue to become a high-priority `scene.reading` WorkspaceFrame module for the current turn.

The renderer semantics already establish that current-state modules override historical conversation modules when they conflict, which is the right behavior for Reader mode.

## Responsive Behavior

Desktop and wide tablet:

- Document region remains dominant.
- Companion rail is visible on the right.
- Floating agent presence can appear near the document/rail boundary or lower-right safe area.

Narrow tablet and mobile:

- Document remains primary.
- Companion rail becomes a bottom sheet or slide-over.
- Paragraph actions and selection actions must remain reachable without requiring hover.
- Floating agent presence collapses into the rail/sheet header by default.

## Error Handling

- Empty pasted/imported content does not enter Reader mode as a document.
- EPUB parse failure shows an inline import error and leaves the current reader document intact.
- Oversized EPUB/text content is normalized and bounded before snapshot sending; the full document is never sent to the backend.
- Selection actions are hidden when selected text normalizes to empty.
- If no paragraph is focused, Reader mode focuses the first paragraph before sending or disables paragraph actions until content exists.
- If snapshot validation fails server-side, the existing protocol error path applies.

## Testing

Frontend tests:

- Reader mode opens from the chat reader entry point and can return to normal chat.
- Document paragraphs render as prose and clicking a paragraph updates focus.
- Focused paragraph is included in `buildReadingSnapshot`.
- Selected text is captured and included as `focus.selected_text`.
- Paragraph ask/note actions send through the existing send path with `readingSnapshot`.
- Reader state persists by `chatId` and restores mode/document metadata.
- EPUB import utility converts a simple EPUB fixture or mocked parser result into title, kind `epub`, and paragraphs.
- Mobile/narrow rendering keeps document primary and exposes companion actions without hover-only controls.

Backend tests:

- Existing reading snapshot validation continues to accept `document.kind: "epub"`.
- WorkspaceFrame still renders `scene.reading` unchanged for Reader mode snapshots.

Manual verification:

- Start gateway and WebUI.
- Open a chat, enter Reader mode, paste text, focus a paragraph, ask about it.
- Select text and ask about the selection.
- Import a small EPUB, focus a paragraph, and send a companion question.
- Confirm the assistant responds to the current paragraph/selection without the user pasting passage text into the chat message.
- Confirm exiting Reader mode returns to the same chat transcript.

## Open Decisions Resolved

- Reader v0.2 is an in-chat mode.
- The main space is the document; the right side is the companion rail.
- Agent presence uses the Hybrid model: stable rail identity plus optional floating active-state container.
- EPUB is supported as client-side import to the shared paragraph model, not as a full reading engine.
- Notes/questions are transient paragraph actions for snapshot context, not a persisted annotation system.
