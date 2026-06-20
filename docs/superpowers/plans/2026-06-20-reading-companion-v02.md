# Reading Companion v0.2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an in-chat immersive Reader mode with a document-first layout, right companion rail, paragraph focus, selection questions, lightweight paragraph note/question actions, Hybrid agent presence, and EPUB import.

**Architecture:** Keep the existing `reading_snapshot` and WorkspaceFrame backend contract. Extend the WebUI reader state and split the current strip into a small entry point plus focused Reader mode components under `webui/src/components/thread/reader/`.

**Tech Stack:** React 18, TypeScript, Vite, Vitest, Testing Library, Tailwind, lucide-react, `epubjs` for client-side EPUB import.

---

## File Structure

- Modify `webui/src/lib/reading.ts`: extend `ReaderState` with `documentKind` and `readerModeOpen`; keep backward-compatible storage restore; make snapshot `document.kind` reflect the reader document kind.
- Create `webui/src/lib/readerEpub.ts`: dynamic EPUB import helper that returns normalized reader document data.
- Create `webui/src/types/epubjs.d.ts`: narrow local module declaration for the EPUB API used by `readerEpub`.
- Modify `webui/package.json` and `webui/package-lock.json`: add `epubjs`.
- Modify `webui/src/components/thread/ReaderStrip.tsx`: convert the current expanded form into a compact reader entry/import control and render `ReaderMode` when open.
- Create `webui/src/components/thread/reader/ReaderMode.tsx`: in-chat immersive shell with document region, companion rail, and floating agent presence.
- Create `webui/src/components/thread/reader/ReaderDocument.tsx`: prose paragraph rendering, paragraph focus, and text-selection capture.
- Create `webui/src/components/thread/reader/ReaderCompanionRail.tsx`: agent identity, focus summary, paragraph note/question actions, and send controls.
- Create `webui/src/components/thread/reader/ReaderAgentPresence.tsx`: optional floating active-state avatar/status container.
- Create `webui/src/tests/reader-mode.test.tsx`: focused component behavior tests.
- Modify `webui/src/tests/reading.test.ts`: state migration and snapshot kind coverage.
- Modify `webui/src/tests/thread-shell.test.tsx`: update the existing reader send test for Reader mode.

---

### Task 1: Extend Reader State And Snapshot Kind

**Files:**
- Modify: `webui/src/lib/reading.ts`
- Modify: `webui/src/tests/reading.test.ts`

- [ ] **Step 1: Write failing tests for document kind and mode restore**

Append these tests inside `describe("reading utilities", () => { ... })` in `webui/src/tests/reading.test.ts`:

```ts
  it("uses the reader document kind in snapshots", () => {
    const snapshot = buildReadingSnapshot({
      version: 1,
      documentId: "doc-epub",
      title: "Novel",
      rawText: "Chapter text.",
      focusedParagraphIndex: 0,
      selectedText: "",
      note: "",
      question: "",
      mode: "slow_reading",
      collapsed: false,
      documentKind: "epub",
      readerModeOpen: true,
    });

    expect(snapshot.document.kind).toBe("epub");
  });

  it("restores new reader v0.2 fields with backward-compatible defaults", () => {
    const key = `${READER_STATE_STORAGE_PREFIX}chat-v02`;
    window.localStorage.setItem(key, JSON.stringify({ version: 1, rawText: "Text" }));

    const state = loadReaderState("chat-v02");

    expect(state?.documentKind).toBe("markdown");
    expect(state?.readerModeOpen).toBe(false);
  });
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
cd webui && bun run test -- src/tests/reading.test.ts
```

Expected: FAIL because `ReaderState` lacks `documentKind`/`readerModeOpen` and snapshots always use `"markdown"`.

- [ ] **Step 3: Implement reader state extensions**

In `webui/src/lib/reading.ts`, add:

```ts
export type ReaderDocumentKind = "text" | "markdown" | "epub";
```

Update `ReaderState`:

```ts
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
  documentKind: ReaderDocumentKind;
  readerModeOpen: boolean;
}
```

Add a normalizer near `normalizeInt`:

```ts
function normalizeDocumentKind(value: unknown): ReaderDocumentKind {
  return value === "text" || value === "markdown" || value === "epub"
    ? value
    : "markdown";
}
```

Change the snapshot document kind:

```ts
    document: {
      id: state.documentId,
      title,
      kind: normalizeDocumentKind(state.documentKind),
    },
```

Update `loadReaderStateResult` return state:

```ts
        documentKind: normalizeDocumentKind(maybe.documentKind),
        readerModeOpen: maybe.readerModeOpen === true,
```

- [ ] **Step 4: Update existing test fixtures**

In every `ReaderState` object literal in `webui/src/tests/reading.test.ts` and `webui/src/tests/reader-strip.test.tsx`, add:

```ts
      documentKind: "markdown",
      readerModeOpen: false,
```

In every direct `buildReadingSnapshot({ ... })` call in `webui/src/tests/reading.test.ts`, add these two fields to the object:

```ts
      documentKind: "markdown",
      readerModeOpen: false,
```

Keep the existing assertions unchanged.

- [ ] **Step 5: Run tests and verify pass**

Run:

```bash
cd webui && bun run test -- src/tests/reading.test.ts src/tests/reader-strip.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add webui/src/lib/reading.ts webui/src/tests/reading.test.ts webui/src/tests/reader-strip.test.tsx
git commit -m "feat(webui): extend reader state for immersive mode"
```

---

### Task 2: Add EPUB Import Utility

**Files:**
- Modify: `webui/package.json`
- Modify: `webui/package-lock.json`
- Create: `webui/src/types/epubjs.d.ts`
- Create: `webui/src/lib/readerEpub.ts`
- Modify: `webui/src/tests/reading.test.ts`

- [ ] **Step 1: Add failing EPUB utility tests**

Add this mock and test block to `webui/src/tests/reading.test.ts` after imports:

```ts
vi.mock("epubjs", () => ({
  default: vi.fn(() => ({
    loaded: {
      metadata: Promise.resolve({ title: "Mock EPUB" }),
      spine: Promise.resolve({
        items: [
          {
            load: vi.fn(async () => ({
              body: {
                textContent: "First EPUB paragraph.\n\nSecond EPUB paragraph.",
              },
            })),
            unload: vi.fn(),
          },
        ],
      }),
    },
  })),
}));
```

Import the utility:

```ts
import { importEpubDocument } from "@/lib/readerEpub";
```

Append this test:

```ts
  it("imports EPUB files into the shared reader document model", async () => {
    const file = new File(["epub bytes"], "book.epub", { type: "application/epub+zip" });

    const document = await importEpubDocument(file);

    expect(document.title).toBe("Mock EPUB");
    expect(document.documentKind).toBe("epub");
    expect(document.rawText).toContain("First EPUB paragraph.");
    expect(document.rawText).toContain("Second EPUB paragraph.");
  });
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
cd webui && bun run test -- src/tests/reading.test.ts
```

Expected: FAIL because `@/lib/readerEpub` does not exist.

- [ ] **Step 3: Install EPUB dependency**

Run:

```bash
cd webui && npm install epubjs
```

Expected: `webui/package.json` and `webui/package-lock.json` include `epubjs`.

- [ ] **Step 4: Add local EPUB type declaration**

Create `webui/src/types/epubjs.d.ts`:

```ts
declare module "epubjs" {
  interface EpubSpineItem {
    load: (book: unknown) => Promise<Document | Element | { body?: { textContent?: string | null } }>;
    unload?: () => void;
  }

  interface EpubBook {
    loaded: {
      metadata: Promise<{ title?: string | null }>;
      spine: Promise<{ items?: EpubSpineItem[] }>;
    };
  }

  export default function ePub(input: ArrayBuffer): EpubBook;
}
```

- [ ] **Step 5: Implement EPUB import helper**

Create `webui/src/lib/readerEpub.ts`:

```ts
import ePub from "epubjs";
import type { ReaderDocumentKind } from "@/lib/reading";

export interface ImportedReaderDocument {
  documentId: string;
  title: string;
  rawText: string;
  documentKind: ReaderDocumentKind;
}

function normalizeWhitespace(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function textFromLoadedContent(content: Document | Element | { body?: { textContent?: string | null } }): string {
  if ("body" in content && content.body?.textContent) {
    return content.body.textContent;
  }
  if ("textContent" in content && typeof content.textContent === "string") {
    return content.textContent;
  }
  return "";
}

export async function importEpubDocument(file: File): Promise<ImportedReaderDocument> {
  const buffer = await file.arrayBuffer();
  const book = ePub(buffer);
  const [metadata, spine] = await Promise.all([
    book.loaded.metadata,
    book.loaded.spine,
  ]);
  const title = metadata.title?.trim() || file.name.replace(/\.epub$/i, "") || "Untitled EPUB";
  const parts: string[] = [];

  for (const item of spine.items ?? []) {
    const loaded = await item.load(book);
    const text = normalizeWhitespace(textFromLoadedContent(loaded));
    if (text) parts.push(text);
    item.unload?.();
  }

  const rawText = normalizeWhitespace(parts.join("\n\n"));
  if (!rawText) {
    throw new Error("No readable text found in EPUB.");
  }

  return {
    documentId: crypto.randomUUID(),
    title,
    rawText,
    documentKind: "epub",
  };
}
```

- [ ] **Step 6: Run tests and verify pass**

Run:

```bash
cd webui && bun run test -- src/tests/reading.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add webui/package.json webui/package-lock.json webui/src/types/epubjs.d.ts webui/src/lib/readerEpub.ts webui/src/tests/reading.test.ts
git commit -m "feat(webui): import epub documents for reader"
```

---

### Task 3: Add Reader Mode Components

**Files:**
- Create: `webui/src/components/thread/reader/ReaderAgentPresence.tsx`
- Create: `webui/src/components/thread/reader/ReaderDocument.tsx`
- Create: `webui/src/components/thread/reader/ReaderCompanionRail.tsx`
- Create: `webui/src/components/thread/reader/ReaderMode.tsx`
- Create: `webui/src/tests/reader-mode.test.tsx`

- [ ] **Step 1: Write failing Reader mode tests**

Create `webui/src/tests/reader-mode.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ReaderMode } from "@/components/thread/reader/ReaderMode";
import type { ReaderState } from "@/lib/reading";

function state(overrides: Partial<ReaderState> = {}): ReaderState {
  return {
    version: 1,
    documentId: "doc-1",
    title: "Essay",
    rawText: "Before.\n\nFocused passage.\n\nAfter.",
    focusedParagraphIndex: 0,
    selectedText: "",
    note: "",
    question: "",
    mode: "slow_reading",
    collapsed: false,
    documentKind: "markdown",
    readerModeOpen: true,
    ...overrides,
  };
}

describe("ReaderMode", () => {
  it("renders document-first reader mode with companion rail and agent presence", () => {
    render(
      <ReaderMode
        state={state()}
        disabled={false}
        persistenceFailed={false}
        onChange={vi.fn()}
        onClose={vi.fn()}
        onSendReading={vi.fn()}
      />,
    );

    expect(screen.getByRole("main", { name: /reader document/i })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: /reader companion/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/agent presence/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Focus paragraph 2/i })).toBeInTheDocument();
  });

  it("clicking a paragraph updates the focused paragraph", () => {
    const onChange = vi.fn();
    render(
      <ReaderMode
        state={state()}
        disabled={false}
        persistenceFailed={false}
        onChange={onChange}
        onClose={vi.fn()}
        onSendReading={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Focus paragraph 2/i }));

    expect(onChange).toHaveBeenCalledWith({ focusedParagraphIndex: 1, selectedText: "" });
  });

  it("sends a paragraph question with a reading snapshot", () => {
    const onSendReading = vi.fn();
    render(
      <ReaderMode
        state={state({ focusedParagraphIndex: 1 })}
        disabled={false}
        persistenceFailed={false}
        onChange={vi.fn()}
        onClose={vi.fn()}
        onSendReading={onSendReading}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Question about focused paragraph/i), {
      target: { value: "Why this turn?" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Ask about paragraph/i }));

    expect(onSendReading).toHaveBeenCalledWith(
      "Why this turn?",
      expect.objectContaining({
        focus: expect.objectContaining({
          focused_text: "Focused passage.",
          current_question: "Why this turn?",
        }),
      }),
    );
  });

  it("captures selected text and sends a selection question", async () => {
    const onChange = vi.fn();
    const onSendReading = vi.fn();
    render(
      <ReaderMode
        state={state({ focusedParagraphIndex: 1, selectedText: "Focused" })}
        disabled={false}
        persistenceFailed={false}
        onChange={onChange}
        onClose={vi.fn()}
        onSendReading={onSendReading}
      />,
    );

    expect(screen.getByText(/Selected text/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Question about selection/i), {
      target: { value: "What does this word imply?" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Ask about selection/i }));

    await waitFor(() => {
      expect(onSendReading).toHaveBeenCalledWith(
        "What does this word imply?",
        expect.objectContaining({
          focus: expect.objectContaining({
            selected_text: "Focused",
            current_question: "What does this word imply?",
          }),
        }),
      );
    });
  });
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
cd webui && bun run test -- src/tests/reader-mode.test.tsx
```

Expected: FAIL because `ReaderMode` does not exist.

- [ ] **Step 3: Implement `ReaderAgentPresence`**

Create `webui/src/components/thread/reader/ReaderAgentPresence.tsx`:

```tsx
import { Bot } from "lucide-react";
import { cn } from "@/lib/utils";

interface ReaderAgentPresenceProps {
  active?: boolean;
}

export function ReaderAgentPresence({ active = false }: ReaderAgentPresenceProps) {
  return (
    <div
      aria-label="Agent presence"
      className={cn(
        "pointer-events-none absolute bottom-5 right-[22rem] hidden h-16 w-16 items-center justify-center rounded-full border border-background bg-primary text-primary-foreground shadow-xl lg:flex",
        active ? "opacity-100" : "opacity-80",
      )}
    >
      <Bot className="h-8 w-8" aria-hidden />
    </div>
  );
}
```

- [ ] **Step 4: Implement `ReaderDocument`**

Create `webui/src/components/thread/reader/ReaderDocument.tsx`:

```tsx
import { useCallback } from "react";
import { parseReaderParagraphs, type ReaderParagraph } from "@/lib/reading";
import { cn } from "@/lib/utils";

interface ReaderDocumentProps {
  title: string;
  rawText: string;
  focusedParagraphIndex: number;
  onFocusParagraph: (index: number) => void;
  onSelectedText: (text: string, paragraphIndex: number | null) => void;
}

function selectedText(): string {
  if (typeof window === "undefined") return "";
  return window.getSelection()?.toString().trim() ?? "";
}

export function ReaderDocument({
  title,
  rawText,
  focusedParagraphIndex,
  onFocusParagraph,
  onSelectedText,
}: ReaderDocumentProps) {
  const paragraphs = parseReaderParagraphs(rawText);

  const handleMouseUp = useCallback((paragraph: ReaderParagraph) => {
    const text = selectedText();
    if (text) onSelectedText(text, paragraph.index);
  }, [onSelectedText]);

  return (
    <main
      aria-label="Reader document"
      className="min-h-0 flex-1 overflow-y-auto bg-background"
    >
      <article className="mx-auto max-w-3xl px-6 py-8 sm:px-10 lg:px-12">
        <div className="mb-8">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Reader
          </p>
          <h1 className="mt-2 text-2xl font-semibold leading-tight text-foreground">
            {title.trim() || "Untitled"}
          </h1>
        </div>
        <div className="space-y-5 text-base leading-8 text-foreground">
          {paragraphs.map((paragraph) => {
            const active = paragraph.index === focusedParagraphIndex;
            return (
              <button
                key={paragraph.id}
                type="button"
                aria-label={`Focus paragraph ${paragraph.index + 1}`}
                aria-pressed={active}
                className={cn(
                  "block w-full rounded-md border px-4 py-3 text-left transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "border-primary/40 bg-primary/10"
                    : "border-transparent hover:border-border hover:bg-muted/40",
                )}
                onClick={() => onFocusParagraph(paragraph.index)}
                onMouseUp={() => handleMouseUp(paragraph)}
              >
                <span className="whitespace-pre-wrap">{paragraph.text}</span>
              </button>
            );
          })}
        </div>
      </article>
    </main>
  );
}
```

- [ ] **Step 5: Implement `ReaderCompanionRail`**

Create `webui/src/components/thread/reader/ReaderCompanionRail.tsx`:

```tsx
import { useMemo, useState } from "react";
import { Bot, MessageCircle, StickyNote, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  buildReadingSnapshot,
  parseReaderParagraphs,
  type ReaderState,
} from "@/lib/reading";

interface ReaderCompanionRailProps {
  state: ReaderState;
  disabled: boolean;
  persistenceFailed: boolean;
  onChange: (patch: Partial<ReaderState>) => void;
  onClose: () => void;
  onSendReading: (content: string, snapshot: ReturnType<typeof buildReadingSnapshot>) => void;
}

export function ReaderCompanionRail({
  state,
  disabled,
  persistenceFailed,
  onChange,
  onClose,
  onSendReading,
}: ReaderCompanionRailProps) {
  const [paragraphQuestion, setParagraphQuestion] = useState("");
  const [selectionQuestion, setSelectionQuestion] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const paragraphs = useMemo(() => parseReaderParagraphs(state.rawText), [state.rawText]);
  const focused = paragraphs[state.focusedParagraphIndex] ?? paragraphs[0];

  const send = (question: string, selectedText = state.selectedText, note = noteDraft) => {
    if (!focused || disabled) return;
    const nextState: ReaderState = {
      ...state,
      focusedParagraphIndex: focused.index,
      selectedText,
      note,
      question,
    };
    onChange({
      focusedParagraphIndex: focused.index,
      selectedText,
      note,
      question,
    });
    onSendReading(question.trim() || "聊聊这一段", buildReadingSnapshot(nextState));
  };

  return (
    <aside
      aria-label="Reader companion"
      className="flex w-full shrink-0 flex-col border-t border-border bg-muted/20 lg:w-80 lg:border-l lg:border-t-0"
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Bot className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">Reading companion</p>
            <p className="truncate text-xs text-muted-foreground">Reading with you</p>
          </div>
        </div>
        <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close reader">
          <X className="h-4 w-4" aria-hidden />
        </Button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <section>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Current focus
          </p>
          <p className="mt-2 line-clamp-5 rounded-md border border-border bg-background p-3 text-sm leading-6">
            {focused?.text || "Add reading text to begin."}
          </p>
        </section>

        <section className="space-y-2">
          <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground" htmlFor="reader-paragraph-question">
            Question about focused paragraph
          </label>
          <Textarea
            id="reader-paragraph-question"
            value={paragraphQuestion}
            onChange={(event) => setParagraphQuestion(event.target.value)}
            className="min-h-20 resize-none"
            placeholder="Ask about this paragraph"
          />
          <Button
            type="button"
            className="w-full gap-2"
            disabled={disabled || !focused}
            onClick={() => send(paragraphQuestion)}
          >
            <MessageCircle className="h-4 w-4" aria-hidden />
            <span>Ask about paragraph</span>
          </Button>
        </section>

        <section className="space-y-2">
          <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground" htmlFor="reader-note">
            Note for this paragraph
          </label>
          <Textarea
            id="reader-note"
            value={noteDraft}
            onChange={(event) => setNoteDraft(event.target.value)}
            className="min-h-16 resize-none"
            placeholder="Add a brief note"
          />
          <Button
            type="button"
            variant="outline"
            className="w-full gap-2"
            disabled={disabled || !focused || !noteDraft.trim()}
            onClick={() => send("聊聊这一段", state.selectedText, noteDraft)}
          >
            <StickyNote className="h-4 w-4" aria-hidden />
            <span>Send note with paragraph</span>
          </Button>
        </section>

        {state.selectedText ? (
          <section className="space-y-2 rounded-md border border-primary/30 bg-primary/10 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Selected text
            </p>
            <p className="line-clamp-4 text-sm leading-6">{state.selectedText}</p>
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground" htmlFor="reader-selection-question">
              Question about selection
            </label>
            <Textarea
              id="reader-selection-question"
              value={selectionQuestion}
              onChange={(event) => setSelectionQuestion(event.target.value)}
              className="min-h-16 resize-none bg-background"
              placeholder="Ask about the selected text"
            />
            <Button
              type="button"
              className="w-full gap-2"
              disabled={disabled}
              onClick={() => send(selectionQuestion || "解释我选中的这段")}
            >
              <MessageCircle className="h-4 w-4" aria-hidden />
              <span>Ask about selection</span>
            </Button>
          </section>
        ) : null}

        {persistenceFailed ? (
          <p className="text-xs text-muted-foreground">
            Reader draft persistence is unavailable in this browser context.
          </p>
        ) : null}
      </div>
    </aside>
  );
}
```

- [ ] **Step 6: Implement `ReaderMode`**

Create `webui/src/components/thread/reader/ReaderMode.tsx`:

```tsx
import type { ReadingSnapshot } from "@/lib/types";
import type { ReaderState } from "@/lib/reading";
import { ReaderAgentPresence } from "@/components/thread/reader/ReaderAgentPresence";
import { ReaderCompanionRail } from "@/components/thread/reader/ReaderCompanionRail";
import { ReaderDocument } from "@/components/thread/reader/ReaderDocument";

interface ReaderModeProps {
  state: ReaderState;
  disabled: boolean;
  persistenceFailed: boolean;
  onChange: (patch: Partial<ReaderState>) => void;
  onClose: () => void;
  onSendReading: (content: string, snapshot: ReadingSnapshot) => void;
}

export function ReaderMode({
  state,
  disabled,
  persistenceFailed,
  onChange,
  onClose,
  onSendReading,
}: ReaderModeProps) {
  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background lg:flex-row">
      <ReaderDocument
        title={state.title}
        rawText={state.rawText}
        focusedParagraphIndex={state.focusedParagraphIndex}
        onFocusParagraph={(focusedParagraphIndex) => {
          onChange({ focusedParagraphIndex, selectedText: "" });
        }}
        onSelectedText={(selectedText, paragraphIndex) => {
          onChange({
            selectedText,
            ...(paragraphIndex === null ? {} : { focusedParagraphIndex: paragraphIndex }),
          });
        }}
      />
      <ReaderCompanionRail
        state={state}
        disabled={disabled}
        persistenceFailed={persistenceFailed}
        onChange={onChange}
        onClose={onClose}
        onSendReading={onSendReading}
      />
      <ReaderAgentPresence active={Boolean(state.selectedText || state.question)} />
    </div>
  );
}
```

- [ ] **Step 7: Run tests and verify pass**

Run:

```bash
cd webui && bun run test -- src/tests/reader-mode.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add webui/src/components/thread/reader webui/src/tests/reader-mode.test.tsx
git commit -m "feat(webui): add immersive reader mode components"
```

---

### Task 4: Wire Reader Mode Into The Chat Thread

**Files:**
- Modify: `webui/src/components/thread/ReaderStrip.tsx`
- Modify: `webui/src/tests/reader-strip.test.tsx`
- Modify: `webui/src/tests/thread-shell.test.tsx`

- [ ] **Step 1: Update integration tests for Reader mode**

In `webui/src/tests/thread-shell.test.tsx`, change the existing `"sends a reading snapshot from the reader strip"` test after opening the reader:

```tsx
    fireEvent.click(await screen.findByRole("button", { name: /open reader/i }));
    fireEvent.change(await screen.findByLabelText(/reading title/i), {
      target: { value: "Essay" },
    });
    fireEvent.change(screen.getByLabelText(/reading text/i), {
      target: { value: "Before.\n\nFocused passage.\n\nAfter." },
    });
    fireEvent.click(screen.getByRole("button", { name: /enter reader mode/i }));
    fireEvent.click(screen.getByRole("button", { name: /Focus paragraph 2/i }));
    fireEvent.change(screen.getByLabelText(/Question about focused paragraph/i), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText(/Note for this paragraph/i), {
      target: { value: "This feels connected." },
    });
    fireEvent.click(screen.getByRole("button", { name: /Send note with paragraph/i }));
```

Keep the existing `expect(client.sendMessage).toHaveBeenCalledWith(...)` assertion.

Append this test to `webui/src/tests/reader-strip.test.tsx`:

```tsx
  it("opens immersive reader mode from saved reader text", async () => {
    const savedState: ReaderState = {
      version: 1,
      documentId: "doc-saved",
      title: "Saved essay",
      rawText: "Saved intro.\n\nSaved focus.",
      focusedParagraphIndex: 0,
      selectedText: "",
      note: "",
      question: "",
      mode: "slow_reading",
      collapsed: false,
      documentKind: "markdown",
      readerModeOpen: false,
    };
    window.localStorage.setItem(`${READER_STATE_STORAGE_PREFIX}chat-reader`, JSON.stringify(savedState));

    render(<ReaderStrip chatId="chat-reader" onSendReading={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: /open reader/i }));
    fireEvent.click(screen.getByRole("button", { name: /enter reader mode/i }));

    expect(screen.getByRole("main", { name: /reader document/i })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: /reader companion/i })).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
cd webui && bun run test -- src/tests/reader-strip.test.tsx src/tests/thread-shell.test.tsx
```

Expected: FAIL because ReaderStrip does not render `Enter reader mode` or `ReaderMode`.

- [ ] **Step 3: Update ReaderStrip blank state**

In `webui/src/components/thread/ReaderStrip.tsx`, update `blankState()`:

```ts
function blankState(): ReaderState {
  return {
    version: 1,
    documentId: crypto.randomUUID(),
    title: "",
    rawText: "",
    selectedText: "",
    note: "",
    question: "",
    focusedParagraphIndex: 0,
    mode: "slow_reading",
    collapsed: true,
    documentKind: "markdown",
    readerModeOpen: false,
  };
}
```

- [ ] **Step 4: Import ReaderMode and EPUB helper**

In `webui/src/components/thread/ReaderStrip.tsx`, add imports:

```ts
import { Upload } from "lucide-react";
import { ReaderMode } from "@/components/thread/reader/ReaderMode";
import { importEpubDocument } from "@/lib/readerEpub";
```

Merge lucide imports so the file has one import from `lucide-react`.

- [ ] **Step 5: Render ReaderMode when active**

Before the existing strip return, add:

```tsx
  if (state.readerModeOpen) {
    return (
      <ReaderMode
        state={state}
        disabled={disabled}
        persistenceFailed={reader.persistenceFailed}
        onChange={updateState}
        onClose={() => updateState({ readerModeOpen: false })}
        onSendReading={onSendReading}
      />
    );
  }
```

- [ ] **Step 6: Replace expanded strip body with compact entry controls**

Inside the existing `!state.collapsed ? (...) : null` branch, keep title/text inputs but replace paragraph chips, note textarea, question input, and send button with:

```tsx
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              {paragraphs.length > 0
                ? `${paragraphs.length} passages ready`
                : "Paste text or import an EPUB to begin."}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                asChild
              >
                <label>
                  <Upload className="h-4 w-4" aria-hidden />
                  <span>Import EPUB</span>
                  <input
                    aria-label="Import EPUB"
                    type="file"
                    accept=".epub,application/epub+zip"
                    className="sr-only"
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      event.currentTarget.value = "";
                      if (!file) return;
                      try {
                        const imported = await importEpubDocument(file);
                        setInlineError(null);
                        updateState({
                          ...imported,
                          focusedParagraphIndex: 0,
                          selectedText: "",
                          note: "",
                          question: "",
                          collapsed: false,
                        });
                      } catch (error) {
                        setInlineError(error instanceof Error ? error.message : "Unable to import EPUB.");
                      }
                    }}
                  />
                </label>
              </Button>
              <Button
                type="button"
                className="gap-1.5"
                disabled={disabled || paragraphs.length === 0}
                onClick={() => updateState({ readerModeOpen: true, collapsed: false })}
              >
                <BookOpen className="h-4 w-4" aria-hidden />
                <span>Enter reader mode</span>
              </Button>
            </div>
          </div>
```

Keep the persistence warning and inline error below this block.

- [ ] **Step 7: Remove obsolete handleSend code if unused**

Delete `handleSend` from `ReaderStrip.tsx` if TypeScript reports it is unused after the compact entry replacement. Keep `buildReadingSnapshot` imported only if still used; otherwise remove that import too.

- [ ] **Step 8: Run tests and verify pass**

Run:

```bash
cd webui && bun run test -- src/tests/reader-strip.test.tsx src/tests/thread-shell.test.tsx src/tests/reader-mode.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add webui/src/components/thread/ReaderStrip.tsx webui/src/tests/reader-strip.test.tsx webui/src/tests/thread-shell.test.tsx
git commit -m "feat(webui): open immersive reader mode from chat"
```

---

### Task 5: Responsive And Accessibility Polish

**Files:**
- Modify: `webui/src/components/thread/reader/ReaderMode.tsx`
- Modify: `webui/src/components/thread/reader/ReaderDocument.tsx`
- Modify: `webui/src/components/thread/reader/ReaderCompanionRail.tsx`
- Modify: `webui/src/components/thread/reader/ReaderAgentPresence.tsx`
- Modify: `webui/src/tests/reader-mode.test.tsx`

- [ ] **Step 1: Add accessibility behavior tests**

Append to `webui/src/tests/reader-mode.test.tsx`:

```tsx
  it("lets the user close reader mode from the companion rail", () => {
    const onClose = vi.fn();
    render(
      <ReaderMode
        state={state()}
        disabled={false}
        persistenceFailed={false}
        onChange={vi.fn()}
        onClose={onClose}
        onSendReading={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /close reader/i }));

    expect(onClose).toHaveBeenCalled();
  });

  it("keeps paragraph actions disabled when there is no readable content", () => {
    render(
      <ReaderMode
        state={state({ rawText: "   " })}
        disabled={false}
        persistenceFailed={false}
        onChange={vi.fn()}
        onClose={vi.fn()}
        onSendReading={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /Ask about paragraph/i })).toBeDisabled();
    expect(screen.getByText(/Add reading text to begin/i)).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run tests and verify current state**

Run:

```bash
cd webui && bun run test -- src/tests/reader-mode.test.tsx
```

Expected: PASS. If it fails, the failure must be limited to disabled empty-reader actions or the close-reader handler covered by Step 3.

- [ ] **Step 3: Apply final layout constraints**

Check these class names are present:

In `ReaderMode.tsx`, the root must include:

```tsx
className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background lg:flex-row"
```

In `ReaderCompanionRail.tsx`, the aside must include:

```tsx
className="flex w-full shrink-0 flex-col border-t border-border bg-muted/20 lg:w-80 lg:border-l lg:border-t-0"
```

In `ReaderAgentPresence.tsx`, the root must include:

```tsx
className="pointer-events-none absolute bottom-5 right-[22rem] hidden h-16 w-16 items-center justify-center rounded-full border border-background bg-primary text-primary-foreground shadow-xl lg:flex"
```

In `ReaderDocument.tsx`, paragraph buttons must include:

```tsx
className={cn(
  "block w-full rounded-md border px-4 py-3 text-left transition-colors",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  active
    ? "border-primary/40 bg-primary/10"
    : "border-transparent hover:border-border hover:bg-muted/40",
)}
```

- [ ] **Step 4: Run targeted tests**

Run:

```bash
cd webui && bun run test -- src/tests/reader-mode.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add webui/src/components/thread/reader webui/src/tests/reader-mode.test.tsx
git commit -m "fix(webui): polish reader mode responsive states"
```

---

### Task 6: Final Verification

**Files:**
- No new files expected.

- [ ] **Step 1: Run focused frontend tests**

Run:

```bash
cd webui && bun run test -- src/tests/reading.test.ts src/tests/reader-strip.test.tsx src/tests/reader-mode.test.tsx src/tests/thread-shell.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run frontend typecheck/build**

Run:

```bash
cd webui && bun run build
```

Expected: PASS with Vite build output under `nanobot/web/dist`.

- [ ] **Step 3: Run backend reading snapshot tests**

Run:

```bash
uv run pytest tests/test_reading_snapshot.py tests/channels/test_websocket_channel.py::test_webui_message_envelope_accepts_reading_snapshot_metadata tests/agent/test_workspace_frame.py::test_builder_adds_reading_scene_module -v
```

Expected: PASS.

- [ ] **Step 4: Inspect git status**

Run:

```bash
git status --short
```

Expected: only intentional source/test/package changes are present, plus any pre-existing unrelated dirty files noted before implementation.

- [ ] **Step 5: Commit final verification fixes**

If Step 1, Step 2, or Step 3 changed files during verification, commit exactly the changed Reader v0.2 files shown by `git status --short`:

```bash
git add webui/src/lib/reading.ts webui/src/lib/readerEpub.ts webui/src/types/epubjs.d.ts webui/src/components/thread/ReaderStrip.tsx webui/src/components/thread/reader webui/src/tests/reading.test.ts webui/src/tests/reader-strip.test.tsx webui/src/tests/reader-mode.test.tsx webui/src/tests/thread-shell.test.tsx webui/package.json webui/package-lock.json
git commit -m "fix(webui): stabilize reader v02 verification"
```

Do not commit unrelated dirty files.
