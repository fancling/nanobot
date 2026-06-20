import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildReadingSnapshot,
  loadReaderState,
  parseReaderParagraphs,
  READER_STATE_STORAGE_PREFIX,
  saveReaderState,
} from "@/lib/reading";

describe("reading utilities", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
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
    saveReaderState("chat-1", {
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
    });

    expect(window.localStorage.getItem(`${READER_STATE_STORAGE_PREFIX}chat-1`)).toContain("Essay");
    expect(loadReaderState("chat-1")?.note).toBe("Note");
  });
});
