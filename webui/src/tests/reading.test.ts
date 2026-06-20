import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildReadingSnapshot,
  loadReaderState,
  parseReaderParagraphs,
  READER_STATE_STORAGE_PREFIX,
  saveReaderState,
} from "@/lib/reading";
import { importEpubDocument } from "@/lib/readerEpub";

const epubMocks = vi.hoisted(() => ({
  bookLoad: vi.fn(),
  itemLoad: vi.fn(),
  rawItemLoad: vi.fn(),
  itemUnload: vi.fn(),
  chapterMarkup: `<html><body>
    <h1>Chapter One</h1>
    <p>First EPUB paragraph.</p><p>Second EPUB paragraph.</p>
    <ul><li>Listed thought.</li></ul>
  </body></html>`,
}));

vi.mock("epubjs", () => ({
  default: vi.fn(() => ({
    load: epubMocks.bookLoad,
    loaded: {
      metadata: Promise.resolve({ title: "Mock EPUB" }),
      spine: Promise.resolve({
        items: [
          {
            load: epubMocks.rawItemLoad,
          },
        ],
        spineItems: [
          {
            load: epubMocks.itemLoad.mockImplementation(async (request: (url: string) => Promise<unknown>) => {
              await request("chapter-one.xhtml");
              return new DOMParser().parseFromString(epubMocks.chapterMarkup, "text/html");
            }),
            unload: epubMocks.itemUnload,
          },
        ],
      }),
    },
  })),
}));

describe("reading utilities", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
    epubMocks.bookLoad.mockReset();
    epubMocks.itemLoad.mockReset();
    epubMocks.rawItemLoad.mockReset();
    epubMocks.itemUnload.mockReset();
    epubMocks.chapterMarkup = `<html><body>
      <h1>Chapter One</h1>
      <p>First EPUB paragraph.</p><p>Second EPUB paragraph.</p>
      <ul><li>Listed thought.</li></ul>
    </body></html>`;
  });

  it("parses plain text and markdown-like paragraphs", () => {
    const paragraphs = parseReaderParagraphs("# Title\n\nFirst paragraph.\n\n- bullet one\n- bullet two\n\nSecond paragraph.");

    expect(paragraphs).toEqual([
      { id: "p-0", text: "# Title", index: 0 },
      { id: "p-1", text: "First paragraph.", index: 1 },
      { id: "p-2", text: "- bullet one\n- bullet two", index: 2 },
      { id: "p-3", text: "Second paragraph.", index: 3 },
    ]);
  });

  it("parses empty text into no paragraphs", () => {
    const paragraphs = parseReaderParagraphs("  \n\n ");

    expect(paragraphs).toEqual([]);
  });

  it("builds a bounded reading snapshot around the focused paragraph", () => {
    const snapshot = buildReadingSnapshot({
      documentId: "doc-1",
      title: "Essay",
      rawText: "Before.\n\nFocused passage.\n\nAfter.",
      focusedParagraphIndex: 1,
      selectedText: "",
      note: "This feels connected.",
      question: "Why this turn?",
      mode: "slow_reading",
      documentKind: "markdown",
      readerModeOpen: false,
    });

    expect(snapshot.scene).toBe("reading");
    expect(snapshot.document.title).toBe("Essay");
    expect(snapshot.location.paragraph_index).toBe(1);
    expect(snapshot.location.paragraph_count).toBe(3);
    expect(snapshot.focus.before).toBe("Before.");
    expect(snapshot.focus.focused_text).toBe("Focused passage.");
    expect(snapshot.focus.after).toBe("After.");
    expect(snapshot.focus.user_note).toBe("This feels connected.");
    expect(snapshot.focus.current_question).toBe("Why this turn?");
  });

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

  it("uses sane defaults for blank raw text", () => {
    const snapshot = buildReadingSnapshot({
      documentId: "doc-1",
      title: "Essay",
      rawText: "   ",
      focusedParagraphIndex: 99,
      selectedText: "",
      note: "",
      question: "",
      mode: "slow_reading",
      documentKind: "markdown",
      readerModeOpen: false,
    });

    expect(snapshot.location.paragraph_count).toBe(1);
    expect(snapshot.location.paragraph_index).toBe(0);
    expect(snapshot.focus.focused_text).toBe("");
  });

  it("clamps focused paragraph index below zero to the first paragraph", () => {
    const snapshot = buildReadingSnapshot({
      documentId: "doc-1",
      title: "Essay",
      rawText: "Before.\n\nMiddle.\n\nAfter.",
      focusedParagraphIndex: -5,
      selectedText: "",
      note: "",
      question: "",
      mode: "slow_reading",
      documentKind: "markdown",
      readerModeOpen: false,
    });

    expect(snapshot.location.paragraph_index).toBe(0);
    expect(snapshot.focus.focused_text).toBe("Before.");
  });

  it("clamps focused paragraph index above range to the last paragraph", () => {
    const snapshot = buildReadingSnapshot({
      documentId: "doc-1",
      title: "Essay",
      rawText: "Before.\n\nMiddle.\n\nAfter.",
      focusedParagraphIndex: 99,
      selectedText: "",
      note: "",
      question: "",
      mode: "slow_reading",
      documentKind: "markdown",
      readerModeOpen: false,
    });

    expect(snapshot.location.paragraph_index).toBe(2);
    expect(snapshot.focus.focused_text).toBe("After.");
  });

  it("truncates long snapshot fields", () => {
    const snapshot = buildReadingSnapshot({
      documentId: "doc-1",
      title: "T".repeat(500),
      rawText: `${"A".repeat(5000)}\n\n${"B".repeat(5000)}`,
      focusedParagraphIndex: 1,
      selectedText: "S".repeat(5000),
      note: "N".repeat(5000),
      question: "Q".repeat(5000),
      mode: "slow_reading",
      documentKind: "markdown",
      readerModeOpen: false,
    });

    expect(snapshot.document.title.length).toBeLessThanOrEqual(243);
    expect(snapshot.document.title.endsWith("...")).toBe(true);
    expect(snapshot.focus.focused_text.length).toBeLessThanOrEqual(1203);
    expect(snapshot.focus.focused_text.endsWith("...")).toBe(true);
    expect(snapshot.focus.selected_text?.length).toBeLessThanOrEqual(803);
    expect(snapshot.focus.selected_text?.endsWith("...")).toBe(true);
    expect(snapshot.focus.before.length).toBeLessThanOrEqual(603);
    expect(snapshot.focus.before.endsWith("...")).toBe(true);
    expect(snapshot.focus.user_note.length).toBeLessThanOrEqual(803);
    expect(snapshot.focus.user_note.endsWith("...")).toBe(true);
  });

  it("persists reader state by chat id", () => {
    const saved = saveReaderState("chat-1", {
      version: 1,
      documentId: "doc-1",
      title: "Essay",
      rawText: "Text",
      focusedParagraphIndex: 0,
      selectedText: "",
      note: "Note",
      question: "",
      mode: "slow_reading",
      collapsed: false,
      documentKind: "markdown",
      readerModeOpen: false,
    });

    expect(saved).toBe(true);
    expect(window.localStorage.getItem(`${READER_STATE_STORAGE_PREFIX}chat-1`)).toContain("Essay");
    expect(loadReaderState("chat-1")?.note).toBe("Note");
  });

  it("returns null on invalid raw storage payload", () => {
    const key = `${READER_STATE_STORAGE_PREFIX}chat-1`;
    window.localStorage.setItem(key, "{invalid-json");
    expect(loadReaderState("chat-1")).toBeNull();
  });

  it("returns null when storage payload has wrong version", () => {
    const key = `${READER_STATE_STORAGE_PREFIX}chat-1`;
    window.localStorage.setItem(key, JSON.stringify({ version: 2, rawText: "Text" }));
    expect(loadReaderState("chat-1")).toBeNull();
  });

  it("returns null when storage payload is not an object", () => {
    const key = `${READER_STATE_STORAGE_PREFIX}chat-1`;
    window.localStorage.setItem(key, JSON.stringify([]));
    expect(loadReaderState("chat-1")).toBeNull();

    window.localStorage.setItem(key, JSON.stringify(null));
    expect(loadReaderState("chat-1")).toBeNull();
  });

  it("returns null when storage payload has non-string raw text", () => {
    const key = `${READER_STATE_STORAGE_PREFIX}chat-1`;
    window.localStorage.setItem(key, JSON.stringify({ version: 1, rawText: 42 }));
    expect(loadReaderState("chat-1")).toBeNull();
  });

  it("restores missing optional fields with defaults", () => {
    const key = `${READER_STATE_STORAGE_PREFIX}chat-1`;
    window.localStorage.setItem(key, JSON.stringify({ version: 1, rawText: "Text" }));

    const state = loadReaderState("chat-1");

    expect(state).not.toBeNull();
    expect(state?.title).toBe("");
    expect(state?.focusedParagraphIndex).toBe(0);
    expect(state?.mode).toBe("slow_reading");
    expect(state?.collapsed).toBe(false);
  });

  it("restores new reader v0.2 fields with backward-compatible defaults", () => {
    const key = `${READER_STATE_STORAGE_PREFIX}chat-v02`;
    window.localStorage.setItem(key, JSON.stringify({ version: 1, rawText: "Text" }));

    const state = loadReaderState("chat-v02");

    expect(state?.documentKind).toBe("markdown");
    expect(state?.readerModeOpen).toBe(false);
  });

  it("imports EPUB files into the shared reader document model", async () => {
    const file = new File(["epub bytes"], "book.epub", { type: "application/epub+zip" });

    const document = await importEpubDocument(file);

    expect(document.title).toBe("Mock EPUB");
    expect(document.documentKind).toBe("epub");
    expect(document.rawText).toBe(
      "Chapter One\n\nFirst EPUB paragraph.\n\nSecond EPUB paragraph.\n\nListed thought.",
    );
    expect(epubMocks.rawItemLoad).not.toHaveBeenCalled();
    expect(epubMocks.itemLoad).toHaveBeenCalledOnce();
    expect(epubMocks.bookLoad).toHaveBeenCalledWith("chapter-one.xhtml");
    expect(epubMocks.itemUnload).toHaveBeenCalledOnce();
  });

  it("preserves EPUB paragraph breaks between adjacent div blocks", async () => {
    epubMocks.chapterMarkup = `<html><body>
      <div>First EPUB paragraph.</div><div>Second EPUB paragraph.</div>
    </body></html>`;
    const file = new File(["epub bytes"], "book.epub", { type: "application/epub+zip" });

    const document = await importEpubDocument(file);

    expect(document.rawText).toContain("First EPUB paragraph.\n\nSecond EPUB paragraph.");
    expect(document.rawText).not.toContain("First EPUB paragraph.Second EPUB paragraph.");
  });

  it("preserves EPUB paragraph breaks for nested blockquote paragraphs", async () => {
    epubMocks.chapterMarkup = `<html><body>
      <blockquote><p>First EPUB paragraph.</p><p>Second EPUB paragraph.</p></blockquote>
    </body></html>`;
    const file = new File(["epub bytes"], "book.epub", { type: "application/epub+zip" });

    const document = await importEpubDocument(file);

    expect(document.rawText).toContain("First EPUB paragraph.\n\nSecond EPUB paragraph.");
    expect(document.rawText).not.toContain("First EPUB paragraph.Second EPUB paragraph.");
  });
});
