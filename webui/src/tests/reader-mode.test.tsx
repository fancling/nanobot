import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReaderMode } from "@/components/thread/reader/ReaderMode";
import type { ReaderState } from "@/lib/reading";
import type { UIMessage } from "@/lib/types";

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

function message(overrides: Partial<UIMessage>): UIMessage {
  return {
    id: "m-1",
    role: "assistant",
    content: "Reader answer",
    createdAt: 1,
    ...overrides,
  };
}

describe("ReaderMode", () => {
  afterEach(() => {
    getSelectionSpy.mockReset();
    vi.clearAllMocks();
  });

  it("renders the document with a book chat panel and agent presence", () => {
    render(
      <ReaderMode
        state={state()}
        messages={[
          message({ id: "u-1", role: "user", content: "What does this mean?", createdAt: 1 }),
          message({ id: "a-1", role: "assistant", content: "It marks a shift.", createdAt: 2 }),
        ]}
        chatLoading={false}
        isStreaming={false}
        disabled={false}
        persistenceFailed={false}
        onChange={vi.fn()}
        onClose={vi.fn()}
        onSendReading={vi.fn()}
      />,
    );

    expect(screen.getByRole("region", { name: /reader document/i })).toBeInTheDocument();
    const chatPanel = screen.getByRole("complementary", { name: /reader chat/i });
    expect(chatPanel).toBeInTheDocument();
    expect(chatPanel).toHaveClass("max-h-[45vh]", "min-h-0", "lg:max-h-none");
    expect(within(chatPanel).getByText("What does this mean?")).toBeInTheDocument();
    expect(within(chatPanel).getByText("It marks a shift.")).toBeInTheDocument();
    expect(within(chatPanel).queryByLabelText(/Question about focused paragraph/i)).not.toBeInTheDocument();
    expect(within(chatPanel).queryByLabelText(/Note for this paragraph/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Previous section/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Next section/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/agent presence/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Focus paragraph 2/i })).toBeInTheDocument();
  });

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
        messages={[]}
        chatLoading={false}
        isStreaming={false}
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
      note: "",
      question: "",
    });

    fireEvent.click(screen.getByRole("button", { name: /Next section/i }));
    expect(onChange).toHaveBeenCalledWith({
      activeSectionIndex: 2,
      rawText: "Ending.",
      focusedParagraphIndex: 0,
      selectedText: "",
      note: "",
      question: "",
    });
  });

  it("keeps the chat panel focused on the active section on initial render", () => {
    render(
      <ReaderMode
        state={state({
          rawText: "Full book opening.\n\nFull book middle.\n\nFull book ending.",
          focusedParagraphIndex: 1,
          activeSectionIndex: 1,
          sections: [
            { id: "s-1", title: "Opening", rawText: "Opening section.", paragraphCount: 1 },
            { id: "s-2", title: "Middle", rawText: "Middle section.", paragraphCount: 1 },
            { id: "s-3", title: "Ending", rawText: "Ending section.", paragraphCount: 1 },
          ],
        })}
        messages={[]}
        chatLoading={false}
        isStreaming={false}
        disabled={false}
        persistenceFailed={false}
        onChange={vi.fn()}
        onClose={vi.fn()}
        onSendReading={vi.fn()}
      />,
    );

    const chatPanel = screen.getByRole("complementary", { name: /reader chat/i });
    expect(within(chatPanel).getByText("Middle section.")).toBeInTheDocument();
    expect(within(chatPanel).queryByText("Full book middle.")).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: /reader document/i })).getByText("Middle section."),
    ).toBeInTheDocument();
  });

  it("clears stale section state when rerendering to another section", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ReaderMode
        state={state({
          documentId: "book-1",
          rawText: "Full book opening.\n\nFull book middle.",
          activeSectionIndex: 0,
          focusedParagraphIndex: 2,
          question: "Saved question for section A",
          selectedText: "Selected in section A",
          sections: [
            { id: "s-1", title: "Opening", rawText: "Opening section.", paragraphCount: 1 },
            { id: "s-2", title: "Middle", rawText: "Middle first.\n\nMiddle second.", paragraphCount: 2 },
          ],
        })}
        messages={[]}
        chatLoading={false}
        isStreaming={false}
        disabled={false}
        persistenceFailed={false}
        onChange={onChange}
        onClose={vi.fn()}
        onSendReading={vi.fn()}
      />,
    );

    expect(screen.getByText("Selected in section A")).toBeInTheDocument();

    rerender(
      <ReaderMode
        state={state({
          documentId: "book-1",
          rawText: "Full book opening.\n\nFull book middle.",
          activeSectionIndex: 1,
          focusedParagraphIndex: 2,
          selectedText: "Selected in section A",
          question: "Saved question for section A",
          sections: [
            { id: "s-1", title: "Opening", rawText: "Opening section.", paragraphCount: 1 },
            { id: "s-2", title: "Middle", rawText: "Middle first.\n\nMiddle second.", paragraphCount: 2 },
          ],
        })}
        messages={[]}
        chatLoading={false}
        isStreaming={false}
        disabled={false}
        persistenceFailed={false}
        onChange={onChange}
        onClose={vi.fn()}
        onSendReading={vi.fn()}
      />,
    );

    expect(within(screen.getByRole("region", { name: /reader document/i })).getByText("Middle first.")).toBeInTheDocument();
    expect(
      within(screen.getByRole("complementary", { name: /reader chat/i })).getByText("Middle first."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Selected in section A")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Reader chat message/i)).toHaveValue("");
    expect(screen.getByLabelText(/agent presence/i)).toHaveClass("opacity-80");
    expect(screen.getByRole("button", { name: /Focus paragraph 1/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(onChange).toHaveBeenCalledWith({
      focusedParagraphIndex: 0,
      selectedText: "",
      note: "",
      question: "",
    });
  });

  it("clicking a paragraph updates the focused paragraph", () => {
    const onChange = vi.fn();
    render(
      <ReaderMode
        state={state()}
        messages={[]}
        chatLoading={false}
        isStreaming={false}
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
        messages={[]}
        chatLoading={false}
        isStreaming={false}
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
        messages={[]}
        chatLoading={false}
        isStreaming={false}
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

  it("sends a reader chat message with a reading snapshot", () => {
    const onChange = vi.fn();
    const onSendReading = vi.fn();
    render(
      <ReaderMode
        state={state({ focusedParagraphIndex: 1 })}
        messages={[]}
        chatLoading={false}
        isStreaming={false}
        disabled={false}
        persistenceFailed={false}
        onChange={onChange}
        onClose={vi.fn()}
        onSendReading={onSendReading}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Reader chat message/i), {
      target: { value: "Why this turn?" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Send reader message/i }));

    expect(onChange).toHaveBeenCalledWith({
      focusedParagraphIndex: 1,
      selectedText: "",
      note: "",
      question: "Why this turn?",
    });
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

  it("resets local chat draft when the document changes", () => {
    const onSendReading = vi.fn();
    const { rerender } = render(
      <ReaderMode
        state={state({ documentId: "doc-a" })}
        messages={[]}
        chatLoading={false}
        isStreaming={false}
        disabled={false}
        persistenceFailed={false}
        onChange={vi.fn()}
        onClose={vi.fn()}
        onSendReading={onSendReading}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Reader chat message/i), {
      target: { value: "Doc A draft question" },
    });

    rerender(
      <ReaderMode
        state={state({
          documentId: "doc-b",
          title: "Second essay",
          rawText: "Doc B opening.",
        })}
        messages={[]}
        chatLoading={false}
        isStreaming={false}
        disabled={false}
        persistenceFailed={false}
        onChange={vi.fn()}
        onClose={vi.fn()}
        onSendReading={onSendReading}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Send reader message/i }));

    expect(onSendReading).not.toHaveBeenCalledWith("Doc A draft question", expect.anything());
    expect(onSendReading).toHaveBeenCalledWith(
      "聊聊这一段",
      expect.objectContaining({
        focus: expect.objectContaining({
          focused_text: "Doc B opening.",
        }),
      }),
    );
  });

  it("uses the last paragraph when focused index is above range", () => {
    const onSendReading = vi.fn();
    render(
      <ReaderMode
        state={state({ focusedParagraphIndex: 99 })}
        messages={[]}
        chatLoading={false}
        isStreaming={false}
        disabled={false}
        persistenceFailed={false}
        onChange={vi.fn()}
        onClose={vi.fn()}
        onSendReading={onSendReading}
      />,
    );

    expect(
      within(screen.getByRole("complementary", { name: /reader chat/i })).getByText("After."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Focus paragraph 3/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.change(screen.getByLabelText(/Reader chat message/i), {
      target: { value: "Why the ending?" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Send reader message/i }));

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

  it("includes selected text in reader chat snapshots", async () => {
    const onChange = vi.fn();
    const onSendReading = vi.fn();
    render(
      <ReaderMode
        state={state({ focusedParagraphIndex: 1, selectedText: "Focused" })}
        messages={[]}
        chatLoading={false}
        isStreaming={false}
        disabled={false}
        persistenceFailed={false}
        onChange={onChange}
        onClose={vi.fn()}
        onSendReading={onSendReading}
      />,
    );

    expect(screen.getByText(/Selected text/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Reader chat message/i), {
      target: { value: "What does this word imply?" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Send reader message/i }));

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

  it("lets the user close reader mode from the chat panel", () => {
    const onClose = vi.fn();
    render(
      <ReaderMode
        state={state()}
        messages={[]}
        chatLoading={false}
        isStreaming={false}
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

  it("keeps reader chat send disabled when there is no readable content", () => {
    render(
      <ReaderMode
        state={state({ rawText: "   " })}
        messages={[]}
        chatLoading={false}
        isStreaming={false}
        disabled={false}
        persistenceFailed={false}
        onChange={vi.fn()}
        onClose={vi.fn()}
        onSendReading={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /Send reader message/i })).toBeDisabled();
    expect(screen.getByText(/Add reading text to begin/i)).toBeInTheDocument();
  });
});
