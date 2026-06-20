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
