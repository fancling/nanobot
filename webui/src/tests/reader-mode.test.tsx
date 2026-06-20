import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReaderMode } from "@/components/thread/reader/ReaderMode";
import type { ReaderState } from "@/lib/reading";

const getSelectionSpy = vi.spyOn(window, "getSelection");

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
  afterEach(() => {
    getSelectionSpy.mockReset();
    vi.clearAllMocks();
  });

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

  it("keeps selected text after the paragraph mouse and click sequence", () => {
    const onChange = vi.fn();
    getSelectionSpy.mockReturnValue({ toString: () => "Focused passage" } as Selection);
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

    const paragraph = screen.getByRole("button", { name: /Focus paragraph 2/i });
    fireEvent.mouseDown(paragraph);
    fireEvent.mouseUp(paragraph);
    fireEvent.click(paragraph);

    expect(onChange).toHaveBeenCalledWith({
      focusedParagraphIndex: 1,
      selectedText: "Focused passage",
    });
    expect(onChange).not.toHaveBeenLastCalledWith({
      focusedParagraphIndex: 1,
      selectedText: "",
    });
  });

  it("keeps selected text after keyboard paragraph activation", () => {
    const onChange = vi.fn();
    getSelectionSpy.mockReturnValue({ toString: () => "Focused passage" } as Selection);
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

    fireEvent.keyDown(screen.getByRole("button", { name: /Focus paragraph 2/i }), {
      key: "Enter",
    });

    expect(onChange).toHaveBeenCalledWith({
      focusedParagraphIndex: 1,
      selectedText: "Focused passage",
    });
    expect(onChange).not.toHaveBeenLastCalledWith({
      focusedParagraphIndex: 1,
      selectedText: "",
    });
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

  it("resets local companion drafts when the document changes", () => {
    const onSendReading = vi.fn();
    const { rerender } = render(
      <ReaderMode
        state={state({ documentId: "doc-a", note: "Doc A saved note" })}
        disabled={false}
        persistenceFailed={false}
        onChange={vi.fn()}
        onClose={vi.fn()}
        onSendReading={onSendReading}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Question about focused paragraph/i), {
      target: { value: "Doc A draft question" },
    });
    fireEvent.change(screen.getByLabelText(/Note for this paragraph/i), {
      target: { value: "Doc A draft note" },
    });

    rerender(
      <ReaderMode
        state={state({
          documentId: "doc-b",
          title: "Second essay",
          rawText: "Doc B opening.",
          note: "Doc B saved note",
        })}
        disabled={false}
        persistenceFailed={false}
        onChange={vi.fn()}
        onClose={vi.fn()}
        onSendReading={onSendReading}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Ask about paragraph/i }));
    fireEvent.click(screen.getByRole("button", { name: /Send note with paragraph/i }));

    expect(onSendReading).not.toHaveBeenCalledWith(
      "Doc A draft question",
      expect.anything(),
    );
    expect(onSendReading).toHaveBeenCalledWith(
      "聊聊这一段",
      expect.objectContaining({
        focus: expect.objectContaining({
          user_note: "Doc B saved note",
        }),
      }),
    );
    expect(onSendReading).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        focus: expect.objectContaining({
          user_note: "Doc A draft note",
        }),
      }),
    );
  });

  it("uses the last paragraph when focused index is above range", () => {
    const onSendReading = vi.fn();
    render(
      <ReaderMode
        state={state({ focusedParagraphIndex: 99 })}
        disabled={false}
        persistenceFailed={false}
        onChange={vi.fn()}
        onClose={vi.fn()}
        onSendReading={onSendReading}
      />,
    );

    expect(
      within(screen.getByRole("complementary", { name: /reader companion/i })).getByText("After."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Focus paragraph 3/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.change(screen.getByLabelText(/Question about focused paragraph/i), {
      target: { value: "Why the ending?" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Ask about paragraph/i }));

    expect(onSendReading).toHaveBeenCalledWith(
      "Why the ending?",
      expect.objectContaining({
        location: expect.objectContaining({
          paragraph_index: 2,
        }),
        focus: expect.objectContaining({
          focused_text: "After.",
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

  it("resets the selection question when selected text changes in the same document", () => {
    const onSendReading = vi.fn();
    const { rerender } = render(
      <ReaderMode
        state={state({ focusedParagraphIndex: 1, selectedText: "Selected A" })}
        disabled={false}
        persistenceFailed={false}
        onChange={vi.fn()}
        onClose={vi.fn()}
        onSendReading={onSendReading}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Question about selection/i), {
      target: { value: "Question for selected A" },
    });

    rerender(
      <ReaderMode
        state={state({ focusedParagraphIndex: 1, selectedText: "Selected B" })}
        disabled={false}
        persistenceFailed={false}
        onChange={vi.fn()}
        onClose={vi.fn()}
        onSendReading={onSendReading}
      />,
    );

    expect(screen.getByLabelText(/Question about selection/i)).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: /Ask about selection/i }));

    expect(onSendReading).not.toHaveBeenCalledWith("Question for selected A", expect.anything());
    expect(onSendReading).toHaveBeenCalledWith(
      "解释我选中的这段",
      expect.objectContaining({
        focus: expect.objectContaining({
          selected_text: "Selected B",
          current_question: "解释我选中的这段",
        }),
      }),
    );
  });

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
});
