# Reader Chat Panel Design

## Goal

Replace the Reader right rail with a book-scoped chat stream while keeping the document as the primary reading surface.

## Scope

- The center pane remains the reader document with paragraph focus and text selection.
- The right pane becomes a compact chat panel for the current book session.
- The chat panel displays the current session's conversation history and a composer.
- Messages sent from the reader composer include the active reading snapshot.
- The previous note/question form layout is removed from the right rail.
- Paragraph-level quick actions remain lightweight and may prefill or send through the chat panel, but a full inline composer is out of scope for this step.

## Architecture

`ReaderPage` receives the active reader session key and loads its history with `useSessionHistory`. It passes the projected UI messages and loading/streaming state to `ReaderMode`. `ReaderMode` keeps paragraph and section state unchanged, then renders `ReaderChatPanel` in the right pane.

`ReaderChatPanel` is a focused reader-specific component. It reuses `ThreadMessages` for transcript rendering and a compact textarea composer for sending book-scoped messages. On send, it builds a `ReadingSnapshot` from the active reader state, updates `question` in reader state, and calls the existing `onSendReading(content, snapshot)` path.

## Data Flow

1. User focuses a paragraph or selects text in `ReaderDocument`.
2. `ReaderMode` updates `ReaderState`.
3. `ReaderChatPanel` reads the active paragraph, selected text, and draft message.
4. On send, it builds a snapshot with `buildReadingSnapshot`.
5. `ReaderPage` forwards the send to `App`, which calls `client.sendMessage` with `readingSnapshot`.
6. The current book session history refreshes through the existing session history mechanism and renders in the panel.

## UX

The right panel has a compact header with the agent/avatar affordance, a scrollable message stream, and a bottom composer. The composer placeholder reflects whether selected text exists. Empty history shows a small prompt to ask about the focused paragraph.

The panel should stay usable at desktop widths and collapse below the document on smaller screens, matching the existing responsive rail behavior.

## Testing

- `ReaderMode` renders a right-side chat panel, not the old companion note/question form.
- The chat panel displays passed session messages.
- Sending from the reader chat panel sends the message with a reading snapshot for the active paragraph.
- Selected text is included in the snapshot when present.
- `ReaderPage` loads and passes book session history into the reader mode.
