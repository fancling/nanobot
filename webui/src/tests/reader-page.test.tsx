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
    expect(screen.getAllByRole("button", { name: /Import EPUB/i })).toHaveLength(2);
    expect(screen.getByText("Import a book to start a reader session.")).toBeInTheDocument();
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
