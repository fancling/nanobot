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
    expect(chatPanel).toHaveClass(
      "max-h-[45vh]",
      "min-h-0",
      "lg:max-h-none",
      "lg:w-[clamp(24rem,34%,34rem)]",
    );
    expect(within(chatPanel).getByText("What does this mean?")).toBeInTheDocument();
    expect(within(chatPanel).getByText("It marks a shift.")).toBeInTheDocument();
    expect(within(chatPanel).queryByLabelText(/Question about focused paragraph/i)).not.toBeInTheDocument();
    expect(within(chatPanel).queryByLabelText(/Note for this paragraph/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Previous section/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Next section/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/agent presence/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Focus paragraph 2/i })).toBeInTheDocument();
  });

  it("keeps the reader chat message area empty before the first book message", () => {
    render(
      <ReaderMode
        state={state()}
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
    expect(
      within(chatPanel).queryByText("Ask about the focused paragraph to start this book conversation."),
    ).not.toBeInTheDocument();
    expect(within(chatPanel).getByLabelText(/Reader chat message/i)).toBeInTheDocument();
  });

  it("renders compact reader chat chrome around the message stream", () => {
    render(
      <ReaderMode
        state={state({ focusedParagraphIndex: 1, selectedText: "Focused" })}
        messages={[message({ id: "a-1", role: "assistant", content: "Reader answer", createdAt: 1 })]}
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
    expect(within(chatPanel).queryByText("Current focus")).not.toBeInTheDocument();
    expect(within(chatPanel).queryByText("Sends with the active reading context.")).not.toBeInTheDocument();
    expect(within(chatPanel).getByLabelText("Focus: Focused passage.")).toHaveClass("truncate");
    expect(within(chatPanel).getByLabelText("Selection: Focused")).toHaveClass("truncate");
    expect(within(chatPanel).getByLabelText(/Reader chat message/i)).toHaveClass("min-h-14");
  });

  it("preserves the reader chat scroll position across transcript refreshes and remounts", () => {
    window.sessionStorage.clear();
    const scrollHeightSpy = vi
      .spyOn(HTMLElement.prototype, "scrollHeight", "get")
      .mockImplementation(function scrollHeight() {
        return this.dataset.testid === "reader-chat-scroll" ? 1_200 : 0;
      });
    const clientHeightSpy = vi
      .spyOn(HTMLElement.prototype, "clientHeight", "get")
      .mockImplementation(function clientHeight() {
        return this.dataset.testid === "reader-chat-scroll" ? 300 : 0;
      });

    try {
      const baseProps = {
        state: state({ workframeId: "reader-workframe-1" }),
        chatLoading: false,
        isStreaming: false,
        disabled: false,
        persistenceFailed: false,
        onChange: vi.fn(),
        onClose: vi.fn(),
        onSendReading: vi.fn(),
      };
      const initialMessages = [
        message({ id: "u-1", role: "user", content: "First question", createdAt: 1 }),
        message({ id: "a-1", role: "assistant", content: "First answer", createdAt: 2 }),
      ];
      const { rerender, unmount } = render(
        <ReaderMode {...baseProps} messages={initialMessages} />,
      );
      const scrollArea = screen.getByTestId("reader-chat-scroll");
      scrollArea.scrollTop = 260;
      fireEvent.scroll(scrollArea);

      rerender(
        <ReaderMode
          {...baseProps}
          messages={[
            ...initialMessages,
            message({ id: "a-2", role: "assistant", content: "Refreshed answer", createdAt: 3 }),
          ]}
        />,
      );
      expect(scrollArea.scrollTop).toBe(260);

      unmount();
      render(<ReaderMode {...baseProps} messages={initialMessages} />);
      expect(screen.getByTestId("reader-chat-scroll").scrollTop).toBe(260);
    } finally {
      scrollHeightSpy.mockRestore();
      clientHeightSpy.mockRestore();
      window.sessionStorage.clear();
    }
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

  it("clicking the focused paragraph clears reader focus", () => {
    const onChange = vi.fn();
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
        onSendReading={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Focus paragraph 2/i }));

    expect(onChange).toHaveBeenCalledWith({
      focusedParagraphIndex: null,
      selectedText: "",
      note: "",
      question: "",
    });
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
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

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

  it("sends the focused paragraph prompt when the reader chat draft is empty", () => {
    const onSendReading = vi.fn();
    render(
      <ReaderMode
        state={state({ focusedParagraphIndex: 1 })}
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

    expect(screen.queryByRole("button", { name: "聊聊这一段" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    const chatPanel = screen.getByRole("complementary", { name: /reader chat/i });
    expect(within(chatPanel).getByText("Waiting for response...")).toBeInTheDocument();
    expect(within(chatPanel).getAllByText("聊聊这一段").length).toBeGreaterThanOrEqual(1);
    expect(onSendReading).toHaveBeenCalledWith(
      "聊聊这一段",
      expect.objectContaining({
        focus: expect.objectContaining({
          focused_text: "Focused passage.",
          current_question: "聊聊这一段",
        }),
      }),
    );
  });

  it("sends a reader chat message without an active paragraph focus", () => {
    const onChange = vi.fn();
    const onSendReading = vi.fn();
    render(
      <ReaderMode
        state={state({ focusedParagraphIndex: null })}
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
      target: { value: "Summarize the chapter so far." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(onChange).toHaveBeenCalledWith({
      focusedParagraphIndex: null,
      selectedText: "",
      note: "",
      question: "Summarize the chapter so far.",
    });
    expect(onSendReading).toHaveBeenCalledWith(
      "Summarize the chapter so far.",
      expect.objectContaining({
        location: expect.objectContaining({
          paragraph_index: null,
        }),
        focus: expect.objectContaining({
          focused_text: "",
          current_question: "Summarize the chapter so far.",
        }),
      }),
    );
  });

  it("clears the local pending reader prompt after history contains it", () => {
    const { rerender } = render(
      <ReaderMode
        state={state({ focusedParagraphIndex: 1 })}
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

    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(screen.getByText("Waiting for response...")).toBeInTheDocument();

    rerender(
      <ReaderMode
        state={state({ focusedParagraphIndex: 1 })}
        messages={[
          { id: "u-1", role: "user", content: "聊聊这一段", createdAt: 1 },
          { id: "a-1", role: "assistant", content: "This paragraph sets the contrast.", createdAt: 2 },
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

    expect(screen.queryByText("Waiting for response...")).not.toBeInTheDocument();
    expect(screen.getByText("This paragraph sets the contrast.")).toBeInTheDocument();
  });

  it("keeps the local prompt before live assistant output until canonical history includes it", () => {
    const { rerender } = render(
      <ReaderMode
        state={state({ focusedParagraphIndex: 1 })}
        messages={[
          { id: "u-old", role: "user", content: "Previous question", createdAt: 1 },
          { id: "a-old", role: "assistant", content: "Previous answer", createdAt: 2 },
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

    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(screen.getByText("Waiting for response...")).toBeInTheDocument();

    rerender(
      <ReaderMode
        state={state({ focusedParagraphIndex: 1 })}
        messages={[
          { id: "u-old", role: "user", content: "Previous question", createdAt: 1 },
          { id: "a-old", role: "assistant", content: "Previous answer", createdAt: 2 },
          { id: "a-new", role: "assistant", content: "Fresh answer from the model.", createdAt: 3 },
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

    expect(screen.getByText("Waiting for response...")).toBeInTheDocument();
    expect(screen.getByText("Fresh answer from the model.")).toBeInTheDocument();
    const renderedMessages = screen.getAllByText(
      /聊聊这一段|Fresh answer from the model\./,
    );
    expect(renderedMessages[renderedMessages.length - 2]).toHaveTextContent("聊聊这一段");
    expect(renderedMessages[renderedMessages.length - 1]).toHaveTextContent(
      "Fresh answer from the model.",
    );
  });

  it("keeps the local pending reader prompt visible while history refreshes", () => {
    const { rerender } = render(
      <ReaderMode
        state={state({ focusedParagraphIndex: 1 })}
        messages={[
          { id: "u-old", role: "user", content: "Previous question", createdAt: 1 },
          { id: "a-old", role: "assistant", content: "Previous answer", createdAt: 2 },
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

    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(screen.getByText("Waiting for response...")).toBeInTheDocument();

    rerender(
      <ReaderMode
        state={state({ focusedParagraphIndex: 1 })}
        messages={[
          { id: "u-old", role: "user", content: "Previous question", createdAt: 1 },
          { id: "a-old", role: "assistant", content: "Previous answer", createdAt: 2 },
        ]}
        chatLoading
        isStreaming={false}
        disabled={false}
        persistenceFailed={false}
        onChange={vi.fn()}
        onClose={vi.fn()}
        onSendReading={vi.fn()}
      />,
    );

    expect(screen.getByText("Waiting for response...")).toBeInTheDocument();
    expect(screen.getByText("Previous answer")).toBeInTheDocument();
    expect(screen.queryByText("Loading book conversation...")).not.toBeInTheDocument();
  });

  it("clears the local pending reader prompt when the request reports an error", () => {
    const { rerender } = render(
      <ReaderMode
        state={state({ focusedParagraphIndex: 1 })}
        messages={[]}
        chatLoading={false}
        isStreaming={false}
        streamError={null}
        disabled={false}
        persistenceFailed={false}
        onChange={vi.fn()}
        onClose={vi.fn()}
        onSendReading={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(screen.getByText("Waiting for response...")).toBeInTheDocument();

    rerender(
      <ReaderMode
        state={state({ focusedParagraphIndex: 1 })}
        messages={[]}
        chatLoading={false}
        isStreaming={false}
        streamError={{ kind: "message_too_big" }}
        disabled={false}
        persistenceFailed={false}
        onDismissStreamError={vi.fn()}
        onChange={vi.fn()}
        onClose={vi.fn()}
        onSendReading={vi.fn()}
      />,
    );

    expect(screen.queryByText("Waiting for response...")).not.toBeInTheDocument();
  });

  it("renders the reader send action inside the message input", () => {
    render(
      <ReaderMode
        state={state({ focusedParagraphIndex: 1 })}
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

    const sendButton = screen.getByRole("button", { name: "Send message" });
    expect(sendButton).toBeEnabled();
    expect(sendButton).toHaveClass("absolute", "bottom-2", "right-2", "rounded-full");
    fireEvent.change(screen.getByLabelText(/Reader chat message/i), {
      target: { value: "Why this turn?" },
    });

    expect(screen.getByRole("button", { name: "Send message" })).toBeEnabled();
    expect(screen.queryByText("聊聊这一段")).not.toBeInTheDocument();
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

    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

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
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

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

    expect(screen.getByLabelText("Selection: Focused")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Reader chat message/i), {
      target: { value: "What does this word imply?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

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

    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
    expect(screen.getByText(/Add reading text to begin/i)).toBeInTheDocument();
  });
});
