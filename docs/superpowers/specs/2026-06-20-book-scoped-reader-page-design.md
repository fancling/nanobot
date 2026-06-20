# Book-Scoped Reader Page Design

## Goal

Move Reading Companion from an in-chat entry point to a first-class Reader area in the WebUI sidebar. A reader session is scoped to a book, not to an arbitrary chat.

The approved product direction is:

- The chat composer Reader entry is removed.
- The WebUI sidebar gets a Reader entry alongside Apps, Skills, and Automations.
- One imported book maps to one nanobot session.
- Book sessions appear in the existing session list, with a visible Reader/book marker.
- The Reader page is the primary place to import, read, focus paragraphs, ask about selections, and talk with the companion.
- The existing message stream and `reading_snapshot` contract remain the AI/backend path.

Out of scope:

- A separate backend bookshelf model.
- Cross-device EPUB file sync.
- A full EPUB layout engine with pagination fidelity.
- A bookmark/search/annotation database.
- Replacing the existing session history system.

## Product Shape

The sidebar gains a `Reader` utility button. Clicking it opens a dedicated Reader page instead of opening anything inside the chat composer.

The Reader page has two states:

- **No active book**: an empty reading surface with import/open controls. The user can import an EPUB or choose an existing book-marked session from the normal session list.
- **Active book session**: the immersive reader layout occupies the main surface, with the document as the dominant region and the companion rail on the right.

Book sessions remain normal nanobot sessions underneath. They can be selected, renamed, archived, and deleted through the existing session list. Their title should default to the imported book title. The UI marks them as Reader/book sessions so they are distinguishable from normal chats.

## Session Model

A book session is represented as a normal WebSocket session plus client-side reader metadata.

The Reader state remains stored by `chatId`, but it gains enough metadata to identify a session as a book session:

- `documentId`
- `title`
- `documentKind`
- `readerSession: true`
- `sourceFileName` when available
- `sections` for EPUB/text chunking
- `activeSectionIndex`
- `focusedParagraphIndex`
- `selectedText`
- transient note/question drafts

The source of truth for conversation history remains the existing session history. The source of truth for imported reading content remains local reader state for this step.

If the user opens a book session from the session list, the App route should show the Reader page rather than a normal chat transcript when the stored reader state marks the session as a Reader session.

## Routing

Add a new shell view: `reader`.

Routes:

- `#/reader` opens Reader with no selected book if there is no active reader session.
- `#/reader?chat=<sessionKey>` opens the Reader page for that book session.
- Existing chat routes remain `#/chat/<sessionKey>`.

The sidebar Reader button navigates to `reader` and preserves the last active reader session when available. If there is no reader session yet, it opens the empty Reader state.

Selecting a Reader-marked session from the existing session list should navigate to `reader?chat=<key>`. Selecting a normal chat should navigate to the normal chat route.

## EPUB Chunking

EPUB import should produce sections instead of flattening the full book into one `rawText`.

Each section has:

- `id`
- `title`
- `rawText`
- `paragraphCount`

For v0.3, sections map to readable EPUB spine items when possible. If spine metadata is sparse, fallback section titles can be `Chapter 1`, `Chapter 2`, and so on.

The active section supplies the prose rendered by `ReaderDocument`. `rawText` can remain as the active section text for compatibility with the existing snapshot builder, or the snapshot builder can derive from `sections[activeSectionIndex]`. The implementation should choose the smaller, safer change.

Required controls:

- Previous section.
- Next section.
- Current section title.
- Progress like `3 / 18`.

Out of scope:

- Page-level pagination.
- Full table of contents navigation.
- EPUB CFI persistence.
- Search across all sections.

## Reader Page Layout

Reuse the v0.2 immersive reader components where possible:

- `ReaderDocument` remains the main prose surface.
- `ReaderCompanionRail` remains the right rail.
- `ReaderAgentPresence` remains a floating active-state affordance.

Introduce a Reader page wrapper that owns:

- import/open empty state,
- current book session selection,
- EPUB import flow,
- section navigation,
- persistence by `chatId`,
- send-to-session integration.

The page must keep the document as the dominant surface. The companion rail is secondary but always reachable. On mobile, the rail can collapse into a bounded bottom panel or stacked region.

## Sending

Reader questions send to the current book session using the existing `sendMessage` path with `readingSnapshot`.

The visible user message stays short and natural:

- the explicit question,
- `聊聊这一段`,
- or `解释我选中的这段`.

The structured snapshot carries the focused paragraph, selected text, section-derived progress, note/question, and document kind.

If a user tries to ask from the Reader page without an active book session, the ask controls should be disabled and the page should prompt for an import/open action.

## Sidebar And Session List

The sidebar gets a `Reader` utility action using a book icon.

Active states:

- Reader utility is active while `view === "reader"`.
- Existing Apps/Skills/Automations active states remain unchanged.
- Reader-marked sessions in the list get a small book marker or label.

The chat composer no longer renders `ReaderStrip`. Reader import and entry actions live on the Reader page only.

## Error Handling

- EPUB import failures show inline errors and leave the current book session unchanged.
- Empty EPUB/text import does not create a reader session.
- If local reader state is unavailable for a Reader-marked session, the Reader page shows a recoverable empty/error state rather than crashing.
- If a selected session is normal chat but the route is `reader`, the page shows the empty Reader state and allows import.
- If a Reader session is opened through the chat route, navigation should prefer the Reader page.

## Testing

Frontend tests:

- Sidebar exposes a Reader button and navigates to the Reader view.
- Chat composer no longer renders the Reader entry.
- Reader view renders an empty import/open state without an active book.
- Importing EPUB creates or initializes a book-scoped session state.
- EPUB import preserves section boundaries and exposes previous/next section navigation.
- Reader-marked sessions route to the Reader page from the session list.
- Reader questions send through the existing message path with `readingSnapshot`.
- Snapshot focus uses the active section and focused paragraph.
- Existing normal chat behavior is unchanged for non-reader sessions.

Backend tests:

- Existing `reading_snapshot` validation and WorkspaceFrame rendering remain valid.
- No new backend session type is required for v0.3.

Manual verification:

- Start WebUI and open the sidebar Reader entry.
- Import an EPUB and confirm the page creates/uses a book session named after the book.
- Confirm the book appears in the session list with a Reader marker.
- Move across sections and focus paragraphs.
- Select text and ask a question.
- Confirm assistant response is sent in the book session and uses the focused reading context.
- Open a normal chat and confirm there is no Reader entry in the composer.

## Open Decisions Resolved

- Reader is a sidebar-level page, not a chat composer mode.
- Reader sessions are book-scoped.
- Book sessions reuse existing nanobot sessions and appear in the existing session list with a Reader marker.
- Reader content storage remains client-side for this step.
- EPUB section chunking is required, but full EPUB reader features remain out of scope.
