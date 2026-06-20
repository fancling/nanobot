# Book-Scoped Reader Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Reading Companion to a sidebar Reader page where each imported book owns its own nanobot session.

**Architecture:** Keep the backend session and `reading_snapshot` contracts unchanged. Add client-side reader metadata and EPUB sections to the existing reader state, route Reader-marked sessions to a new `reader` shell view, and reuse the v0.2 immersive reader components inside a dedicated Reader page wrapper.

**Tech Stack:** React, TypeScript, Vite, Vitest, Testing Library, epubjs, localStorage-backed reader state.

---

## File Structure

- Modify `webui/src/lib/reading.ts`
  - Add `ReaderSection`, `readerSession`, `sourceFileName`, `sections`, and `activeSectionIndex`.
  - Add helpers for active-section text and reader-session detection.
  - Keep the existing snapshot API stable.

- Modify `webui/src/lib/readerEpub.ts`
  - Return section metadata from EPUB import.
  - Preserve `rawText` as the first active section text for compatibility.

- Create `webui/src/components/reader/ReaderPage.tsx`
  - Own the standalone Reader page, empty state, import control, section navigation, persistence bridge, and send-to-session wiring.

- Modify `webui/src/components/thread/reader/ReaderMode.tsx`
  - Accept optional section navigation props and render the active section controls without owning persistence.

- Modify `webui/src/components/thread/ThreadShell.tsx`
  - Remove `ReaderStrip` from the composer area.

- Modify `webui/src/components/Sidebar.tsx`
  - Add a Reader utility button and active state.

- Modify `webui/src/App.tsx`
  - Add `reader` route parsing/writing.
  - Add Reader page rendering.
  - Route Reader-marked sessions to `reader?chat=<key>`.
  - Create a book session when importing from the empty Reader page.

- Modify `webui/src/components/ChatList.tsx` if needed
  - Show a small Reader marker for sessions whose stored reader state has `readerSession: true`.

- Tests:
  - Modify `webui/src/tests/reading.test.ts`.
  - Modify `webui/src/tests/reader-mode.test.tsx`.
  - Add `webui/src/tests/reader-page.test.tsx`.
  - Modify `webui/src/tests/thread-shell.test.tsx`.
  - Modify `webui/src/tests/app-layout.test.tsx`.

## Task 1: Reader State And EPUB Sections

**Files:**
- Modify: `webui/src/lib/reading.ts`
- Modify: `webui/src/lib/readerEpub.ts`
- Modify: `webui/src/tests/reading.test.ts`

- [ ] **Step 1: Write failing reader-state section tests**

Add tests like this to `webui/src/tests/reading.test.ts`:

```ts
it("loads reader session metadata and uses the active section for snapshots", () => {
  const state: ReaderState = {
    version: 1,
    documentId: "book-1",
    title: "Book",
    rawText: "Chapter one.\n\nSecond paragraph.",
    focusedParagraphIndex: 1,
    selectedText: "",
    note: "",
    question: "Why this?",
    mode: "slow_reading",
    collapsed: false,
    documentKind: "epub",
    readerModeOpen: false,
    readerSession: true,
    sourceFileName: "book.epub",
    activeSectionIndex: 1,
    sections: [
      { id: "s-1", title: "Opening", rawText: "Opening text.", paragraphCount: 1 },
      { id: "s-2", title: "Chapter one", rawText: "Chapter one.\n\nSecond paragraph.", paragraphCount: 2 },
    ],
  };

  expect(isReaderSessionState(state)).toBe(true);
  expect(getActiveReaderText(state)).toBe("Chapter one.\n\nSecond paragraph.");
  expect(buildReadingSnapshot(state)).toMatchObject({
    document: { id: "book-1", title: "Book", kind: "epub" },
    location: { paragraph_index: 1, paragraph_count: 2 },
    focus: { focused_text: "Second paragraph.", current_question: "Why this?" },
  });
});
```

- [ ] **Step 2: Write failing EPUB section import test**

Extend the existing mocked EPUB import test in `webui/src/tests/reading.test.ts` so the result assertion includes sections:

```ts
await expect(importEpubDocument(file)).resolves.toMatchObject({
  title: "Mock EPUB",
  documentKind: "epub",
  readerSession: true,
  activeSectionIndex: 0,
  sections: [
    { id: "section-0", title: "Chapter 1", rawText: "First chapter.", paragraphCount: 1 },
    { id: "section-1", title: "Chapter 2", rawText: "Second chapter.\n\nMore text.", paragraphCount: 2 },
  ],
  rawText: "First chapter.",
});
```

- [ ] **Step 3: Run tests to verify RED**

Run:

```bash
cd webui && ./node_modules/.bin/vitest run src/tests/reading.test.ts
```

Expected: FAIL because `ReaderSection`, `isReaderSessionState`, `getActiveReaderText`, and EPUB `sections` do not exist yet.

- [ ] **Step 4: Implement reader state helpers**

Update `webui/src/lib/reading.ts`:

```ts
export interface ReaderSection {
  id: string;
  title: string;
  rawText: string;
  paragraphCount: number;
}

export interface ReaderState {
  version: 1;
  documentId: string;
  title: string;
  rawText: string;
  focusedParagraphIndex: number;
  selectedText: string;
  note: string;
  question: string;
  mode: "slow_reading";
  collapsed: boolean;
  documentKind?: ReaderDocumentKind;
  readerModeOpen?: boolean;
  readerSession?: boolean;
  sourceFileName?: string;
  sections?: ReaderSection[];
  activeSectionIndex?: number;
}

export function getActiveReaderSection(state: ReaderState): ReaderSection | null {
  const sections = Array.isArray(state.sections) ? state.sections : [];
  if (sections.length === 0) return null;
  const index = Math.max(0, Math.min(state.activeSectionIndex ?? 0, sections.length - 1));
  return sections[index] ?? null;
}

export function getActiveReaderText(state: ReaderState): string {
  return getActiveReaderSection(state)?.rawText ?? state.rawText;
}

export function isReaderSessionState(state: ReaderState | null): boolean {
  return state?.readerSession === true;
}
```

Update `buildReadingSnapshot` to call `getActiveReaderText(state)` instead of reading `state.rawText` directly.

Extend `loadReaderStateResult` normalization to preserve `readerSession`, `sourceFileName`, `activeSectionIndex`, and valid `sections`.

- [ ] **Step 5: Implement EPUB sections**

Update `webui/src/lib/readerEpub.ts` so `ImportedReaderDocument` includes the new fields:

```ts
export interface ImportedReaderDocument {
  documentId: string;
  title: string;
  rawText: string;
  documentKind: ReaderDocumentKind;
  readerSession: true;
  sourceFileName: string;
  sections: ReaderSection[];
  activeSectionIndex: 0;
}
```

Build one section per loadable spine item:

```ts
const sections: ReaderSection[] = [];
let sectionIndex = 0;
for (const item of loadableSections(spine)) {
  try {
    const loaded = await item.load(book.load.bind(book));
    const rawText = normalizeWhitespace(textFromLoadedContent(loaded));
    if (rawText) {
      sections.push({
        id: `section-${sectionIndex}`,
        title: `Chapter ${sectionIndex + 1}`,
        rawText,
        paragraphCount: parseReaderParagraphs(rawText).length,
      });
      sectionIndex += 1;
    }
  } finally {
    item.unload?.();
  }
}
```

Return `rawText: sections[0].rawText` after the empty-content guard.

- [ ] **Step 6: Run tests to verify GREEN**

Run:

```bash
cd webui && ./node_modules/.bin/vitest run src/tests/reading.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add webui/src/lib/reading.ts webui/src/lib/readerEpub.ts webui/src/tests/reading.test.ts
git commit -m "feat(webui): add reader book sections"
```

## Task 2: Reader Mode Section Navigation

**Files:**
- Modify: `webui/src/components/thread/reader/ReaderMode.tsx`
- Modify: `webui/src/tests/reader-mode.test.tsx`

- [ ] **Step 1: Write failing section navigation test**

Add to `webui/src/tests/reader-mode.test.tsx`:

```tsx
it("renders section controls and navigates sections", () => {
  const onChange = vi.fn();
  render(
    <ReaderMode
      state={state({
        activeSectionIndex: 1,
        sections: [
          { id: "s-1", title: "Opening", rawText: "Opening.", paragraphCount: 1 },
          { id: "s-2", title: "Middle", rawText: "Middle.", paragraphCount: 1 },
          { id: "s-3", title: "Ending", rawText: "Ending.", paragraphCount: 1 },
        ],
      })}
      disabled={false}
      persistenceFailed={false}
      onChange={onChange}
      onClose={vi.fn()}
      onSendReading={vi.fn()}
    />,
  );

  expect(screen.getByText("Middle")).toBeInTheDocument();
  expect(screen.getByText("2 / 3")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: /Previous section/i }));
  expect(onChange).toHaveBeenCalledWith({
    activeSectionIndex: 0,
    rawText: "Opening.",
    focusedParagraphIndex: 0,
    selectedText: "",
  });

  fireEvent.click(screen.getByRole("button", { name: /Next section/i }));
  expect(onChange).toHaveBeenCalledWith({
    activeSectionIndex: 2,
    rawText: "Ending.",
    focusedParagraphIndex: 0,
    selectedText: "",
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
cd webui && ./node_modules/.bin/vitest run src/tests/reader-mode.test.tsx
```

Expected: FAIL because section controls are missing.

- [ ] **Step 3: Implement section controls in ReaderMode**

In `ReaderMode`, derive:

```ts
const sections = state.sections ?? [];
const activeSectionIndex = Math.max(0, Math.min(state.activeSectionIndex ?? 0, sections.length - 1));
const activeSection = sections[activeSectionIndex] ?? null;
const activeRawText = activeSection?.rawText ?? state.rawText;
```

Render a compact toolbar above `ReaderDocument` when `sections.length > 1`, with `Previous section` and `Next section` icon buttons. When changing sections, call:

```ts
onChange({
  activeSectionIndex: nextIndex,
  rawText: sections[nextIndex].rawText,
  focusedParagraphIndex: 0,
  selectedText: "",
});
```

Pass `activeRawText` to `ReaderDocument`.

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
cd webui && ./node_modules/.bin/vitest run src/tests/reader-mode.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add webui/src/components/thread/reader/ReaderMode.tsx webui/src/tests/reader-mode.test.tsx
git commit -m "feat(webui): add reader section navigation"
```

## Task 3: Standalone Reader Page

**Files:**
- Create: `webui/src/components/reader/ReaderPage.tsx`
- Add: `webui/src/tests/reader-page.test.tsx`

- [ ] **Step 1: Write failing empty-state and send tests**

Create `webui/src/tests/reader-page.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ReaderPage } from "@/components/reader/ReaderPage";
import type { ReaderState } from "@/lib/reading";

function state(overrides: Partial<ReaderState> = {}): ReaderState {
  return {
    version: 1,
    documentId: "book-1",
    title: "Book",
    rawText: "First paragraph.\n\nSecond paragraph.",
    focusedParagraphIndex: 0,
    selectedText: "",
    note: "",
    question: "",
    mode: "slow_reading",
    collapsed: false,
    documentKind: "epub",
    readerModeOpen: false,
    readerSession: true,
    sections: [{ id: "s-1", title: "Chapter 1", rawText: "First paragraph.\n\nSecond paragraph.", paragraphCount: 2 }],
    activeSectionIndex: 0,
    ...overrides,
  };
}

describe("ReaderPage", () => {
  it("renders an empty reader page without an active book", () => {
    render(
      <ReaderPage
        state={null}
        disabled={false}
        persistenceFailed={false}
        onChange={vi.fn()}
        onImportEpub={vi.fn()}
        onSendReading={vi.fn()}
        onBackToChat={vi.fn()}
      />,
    );

    expect(screen.getByRole("main", { name: /reader page/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Import EPUB/i })).toBeInTheDocument();
    expect(screen.getByText(/Import a book to start a reader session/i)).toBeInTheDocument();
  });

  it("sends reader questions from the active book", () => {
    const onSendReading = vi.fn();
    render(
      <ReaderPage
        state={state({ focusedParagraphIndex: 1 })}
        disabled={false}
        persistenceFailed={false}
        onChange={vi.fn()}
        onImportEpub={vi.fn()}
        onSendReading={onSendReading}
        onBackToChat={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Question about focused paragraph/i), {
      target: { value: "Why this paragraph?" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Ask about paragraph/i }));

    expect(onSendReading).toHaveBeenCalledWith(
      "Why this paragraph?",
      expect.objectContaining({
        focus: expect.objectContaining({ focused_text: "Second paragraph." }),
      }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
cd webui && ./node_modules/.bin/vitest run src/tests/reader-page.test.tsx
```

Expected: FAIL because `ReaderPage` does not exist.

- [ ] **Step 3: Implement ReaderPage**

Create `webui/src/components/reader/ReaderPage.tsx`:

```tsx
import { useRef } from "react";
import { ArrowLeft, BookOpen, Upload } from "lucide-react";

import { ReaderMode } from "@/components/thread/reader/ReaderMode";
import { Button } from "@/components/ui/button";
import type { ReaderState } from "@/lib/reading";
import type { ReadingSnapshot } from "@/lib/types";

interface ReaderPageProps {
  state: ReaderState | null;
  disabled: boolean;
  persistenceFailed: boolean;
  onChange: (patch: Partial<ReaderState>) => void;
  onImportEpub: (file: File) => void;
  onSendReading: (content: string, snapshot: ReadingSnapshot) => void;
  onBackToChat: () => void;
}

export function ReaderPage({
  state,
  disabled,
  persistenceFailed,
  onChange,
  onImportEpub,
  onSendReading,
  onBackToChat,
}: ReaderPageProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <main aria-label="Reader page" className="flex h-full min-h-0 flex-1 flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border/60 px-4">
        <Button type="button" variant="ghost" size="sm" className="gap-1.5" onClick={onBackToChat}>
          <ArrowLeft className="h-4 w-4" aria-hidden />
          <span>Chat</span>
        </Button>
        <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={disabled} onClick={() => fileInputRef.current?.click()}>
          <Upload className="h-4 w-4" aria-hidden />
          <span>Import EPUB</span>
        </Button>
        <input
          ref={fileInputRef}
          aria-label="Import EPUB"
          type="file"
          accept=".epub,application/epub+zip"
          className="sr-only"
          disabled={disabled}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.currentTarget.value = "";
            if (file) onImportEpub(file);
          }}
        />
      </header>
      {state ? (
        <ReaderMode
          state={state}
          disabled={disabled}
          persistenceFailed={persistenceFailed}
          onChange={onChange}
          onClose={onBackToChat}
          onSendReading={onSendReading}
        />
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center px-6">
          <div className="flex max-w-sm flex-col items-center gap-4 text-center">
            <BookOpen className="h-10 w-10 text-muted-foreground" aria-hidden />
            <div className="space-y-1">
              <h1 className="text-lg font-semibold">Reader</h1>
              <p className="text-sm text-muted-foreground">Import a book to start a reader session.</p>
            </div>
            <Button type="button" className="gap-1.5" disabled={disabled} onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-4 w-4" aria-hidden />
              <span>Import EPUB</span>
            </Button>
          </div>
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 4: Run test to verify GREEN**

Run:

```bash
cd webui && ./node_modules/.bin/vitest run src/tests/reader-page.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add webui/src/components/reader/ReaderPage.tsx webui/src/tests/reader-page.test.tsx
git commit -m "feat(webui): add standalone reader page"
```

## Task 4: Sidebar Route And Book Session Wiring

**Files:**
- Modify: `webui/src/App.tsx`
- Modify: `webui/src/components/Sidebar.tsx`
- Modify: `webui/src/tests/app-layout.test.tsx`

- [ ] **Step 1: Write failing sidebar Reader route test**

Add to `webui/src/tests/app-layout.test.tsx` near existing sidebar navigation tests:

```tsx
it("opens the sidebar Reader page", async () => {
  renderApp();

  const sidebar = await screen.findByRole("navigation", { name: "Sidebar navigation" });
  fireEvent.click(within(sidebar).getByRole("button", { name: "Reader" }));

  expect(await screen.findByRole("main", { name: /reader page/i })).toBeInTheDocument();
  expect(window.location.hash).toBe("#/reader");
});
```

- [ ] **Step 2: Write failing Reader session routing test**

Add a localStorage-backed test:

```tsx
it("routes reader-marked sessions to the Reader page", async () => {
  window.localStorage.setItem(
    `${READER_STATE_STORAGE_PREFIX}book-chat`,
    JSON.stringify({
      version: 1,
      documentId: "book-1",
      title: "Book",
      rawText: "Book text.",
      focusedParagraphIndex: 0,
      selectedText: "",
      note: "",
      question: "",
      mode: "slow_reading",
      collapsed: false,
      documentKind: "epub",
      readerSession: true,
    }),
  );
  mockSessions([{ key: "websocket:book-chat", chatId: "book-chat", preview: "Book" }]);
  renderApp();

  fireEvent.click(await screen.findByText("Book"));

  expect(await screen.findByRole("main", { name: /reader page/i })).toBeInTheDocument();
  expect(window.location.hash).toBe("#/reader?chat=websocket%3Abook-chat");
});
```

- [ ] **Step 3: Run tests to verify RED**

Run the relevant app test file or narrowed tests:

```bash
cd webui && ./node_modules/.bin/vitest run src/tests/app-layout.test.tsx
```

Expected: FAIL because `reader` route and sidebar button are missing.

- [ ] **Step 4: Implement Sidebar Reader button**

In `webui/src/components/Sidebar.tsx`:

- import `BookOpen`.
- add prop `onOpenReader: () => void`.
- extend `activeUtility` to include `"reader"`.
- render the Reader action between Search and Apps:

```tsx
<SidebarActionButton
  collapsed={collapsed}
  label="Reader"
  onClick={props.onOpenReader}
  active={props.activeUtility === "reader"}
  icon={<BookOpen className="h-4 w-4" />}
/>
```

- [ ] **Step 5: Implement App reader route**

In `webui/src/App.tsx`:

- extend `ShellView` with `"reader"`.
- parse `#/reader` and `#/reader?chat=<key>`.
- serialize reader route in `shellRouteHash`.
- add `onOpenReader`.
- pass `onOpenReader` and `activeUtility`.
- render `ReaderPage` when `view === "reader"`.

Use the existing `loadReaderState`/`saveReaderState` path to load the active book state by `activeSession?.chatId`.

- [ ] **Step 6: Run tests to verify GREEN**

Run:

```bash
cd webui && ./node_modules/.bin/vitest run src/tests/app-layout.test.tsx
```

Expected: PASS, or only unrelated pre-existing tests fail. Fix any regressions caused by this task before continuing.

- [ ] **Step 7: Commit**

```bash
git add webui/src/App.tsx webui/src/components/Sidebar.tsx webui/src/tests/app-layout.test.tsx
git commit -m "feat(webui): add sidebar reader route"
```

## Task 5: Remove Chat Reader Entry And Add Book Marker

**Files:**
- Modify: `webui/src/components/thread/ThreadShell.tsx`
- Modify: `webui/src/components/ChatList.tsx`
- Modify: `webui/src/tests/thread-shell.test.tsx`
- Modify: `webui/src/tests/app-layout.test.tsx`

- [ ] **Step 1: Write failing ThreadShell removal test**

Add to `webui/src/tests/thread-shell.test.tsx`:

```tsx
it("does not render the reader strip in the chat composer area", async () => {
  const client = makeClient();
  render(wrap(
    client,
    <ThreadShell
      session={session("chat-reader-removed")}
      title="Normal chat"
      onToggleSidebar={() => {}}
      onNewChat={() => {}}
    />,
  ));

  await waitFor(() => expect(screen.getByText("Normal chat")).toBeInTheDocument());
  expect(screen.queryByRole("button", { name: /Open reader/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Enter reader mode/i })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Write failing book marker test**

In `webui/src/tests/app-layout.test.tsx`, assert a Reader-marked session has visible marker text or accessible label:

```tsx
expect(await screen.findByLabelText(/Reader session: Book/i)).toBeInTheDocument();
```

- [ ] **Step 3: Run tests to verify RED**

Run:

```bash
cd webui && ./node_modules/.bin/vitest run src/tests/thread-shell.test.tsx src/tests/app-layout.test.tsx
```

Expected: FAIL because chat still renders `ReaderStrip` and session marker is missing.

- [ ] **Step 4: Remove ReaderStrip from ThreadShell**

In `webui/src/components/thread/ThreadShell.tsx`:

- remove the `ReaderStrip` import.
- remove `readerModeOpen` state if no longer used.
- remove the `<ReaderStrip ... />` block from `composer`.
- remove composer suppression based on reader mode.

Do not remove the lower-level reader components; `ReaderPage` uses them.

- [ ] **Step 5: Add session marker**

In `webui/src/components/ChatList.tsx`, load reader metadata conservatively from localStorage by `chatId` using `loadReaderState`. For reader sessions, render a small book icon or label with:

```tsx
aria-label={`Reader session: ${displayLabel}`}
```

Keep the marker compact and non-interactive.

- [ ] **Step 6: Run tests to verify GREEN**

Run:

```bash
cd webui && ./node_modules/.bin/vitest run src/tests/thread-shell.test.tsx src/tests/app-layout.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add webui/src/components/thread/ThreadShell.tsx webui/src/components/ChatList.tsx webui/src/tests/thread-shell.test.tsx webui/src/tests/app-layout.test.tsx
git commit -m "feat(webui): move reader entry out of chat"
```

## Task 6: Full Verification

**Files:**
- No required source changes unless verification finds regressions.

- [ ] **Step 1: Run focused frontend tests**

Run:

```bash
cd webui && ./node_modules/.bin/vitest run src/tests/reading.test.ts src/tests/reader-mode.test.tsx src/tests/reader-page.test.tsx src/tests/reader-strip.test.tsx src/tests/thread-shell.test.tsx src/tests/app-layout.test.tsx
```

Expected: PASS. If `reader-strip.test.tsx` is obsolete after removing chat entry, update or delete only tests that target the removed entry; keep EPUB importer tests.

- [ ] **Step 2: Run TypeScript build check**

Run:

```bash
cd webui && ./node_modules/.bin/tsc -p tsconfig.build.json --noEmit
```

Expected: PASS.

- [ ] **Step 3: Run WebUI build**

Run:

```bash
cd webui && npm run build
```

Expected: PASS. Existing Vite chunk-size warnings are acceptable if unchanged.

- [ ] **Step 4: Run backend reading tests**

Run:

```bash
.venv/bin/python -m pytest tests/test_reading_snapshot.py tests/channels/test_websocket_channel.py::test_webui_message_envelope_accepts_reading_snapshot_metadata tests/agent/test_workspace_frame.py::test_builder_adds_reading_scene_module -v
```

Expected: PASS.

- [ ] **Step 5: Check git status**

Run:

```bash
git status --short
```

Expected: only intended files changed. The existing unrelated `webui/package-lock.json` dirty change must not be included unless explicitly requested.

- [ ] **Step 6: Final commit if verification required fixes**

If verification required source fixes, commit them:

```bash
git add <fixed files>
git commit -m "fix(webui): stabilize book reader page"
```

## Self-Review

- Spec coverage: sidebar Reader entry, book-scoped sessions, session-list visibility, EPUB section chunking, reader page layout, existing send path, and removal of chat composer entry are covered.
- Backend scope: no new backend session type is planned; existing snapshot tests remain in verification.
- Type consistency: `ReaderSection`, `readerSession`, `sections`, and `activeSectionIndex` are introduced in Task 1 and reused by later tasks.
- Known risk: App-level tests may need small harness adjustments because existing helpers differ across the large `app-layout` suite. Keep those changes local to test setup and do not alter product behavior to satisfy the harness.
