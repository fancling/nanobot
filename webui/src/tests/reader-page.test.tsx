import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReaderPage } from "@/components/reader/ReaderPage";
import type { ReaderState } from "@/lib/reading";
import type { UIMessage } from "@/lib/types";
import { useSessionHistory } from "@/hooks/useSessions";

vi.mock("@/hooks/useSessions", () => ({
  useSessionHistory: vi.fn(),
}));

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
  const useSessionHistoryMock = vi.mocked(useSessionHistory);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    useSessionHistoryMock.mockReturnValue({
      messages: [],
      loading: false,
      loadingOlder: false,
      error: null,
      refresh: vi.fn(),
      loadOlder: vi.fn(),
      hasMoreBefore: false,
      userMessageOffset: 0,
      version: 0,
      forkBoundaryMessageCount: null,
      hasPendingToolCalls: false,
    });
  });

  it("renders an empty reader page without an active book", () => {
    const inputClickSpy = vi.spyOn(HTMLInputElement.prototype, "click");
    const onImportEpub = vi.fn();
    render(
      <ReaderPage
        state={null}
        sessionKey={null}
        disabled={false}
        persistenceFailed={false}
        onChange={vi.fn()}
        onImportEpub={onImportEpub}
        onSendReading={vi.fn()}
        onBackToChat={vi.fn()}
      />,
    );

    expect(screen.getByRole("main", { name: /reader page/i })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Import EPUB/i })).toHaveLength(2);
    expect(screen.getByText("Import a book to start a reader session.")).toBeInTheDocument();

    const importButtons = screen.getAllByRole("button", { name: /Import EPUB/i });
    fireEvent.click(importButtons[0]);
    fireEvent.click(importButtons[1]);
    expect(inputClickSpy).toHaveBeenCalledTimes(2);

    const input = screen.getByLabelText("Import EPUB") as HTMLInputElement;
    const file = new File(["epub"], "sample.epub", { type: "application/epub+zip" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onImportEpub).toHaveBeenCalledWith(file);
  });

  it("sends reader questions from the active book", () => {
    const onSendReading = vi.fn();
    render(
      <ReaderPage
        state={state({ focusedParagraphIndex: 1 })}
        sessionKey="websocket:book-1"
        disabled={false}
        persistenceFailed={false}
        onChange={vi.fn()}
        onImportEpub={vi.fn()}
        onSendReading={onSendReading}
        onBackToChat={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Reader chat message/i), {
      target: { value: "Why this paragraph?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(onSendReading).toHaveBeenCalledWith(
      "Why this paragraph?",
      expect.objectContaining({
        focus: expect.objectContaining({ focused_text: "Second paragraph." }),
      }),
    );
  });

  it("renders the active book session history in the reader chat", () => {
    const messages: UIMessage[] = [
      { id: "u-1", role: "user", content: "Explain this image", createdAt: 1 },
      { id: "a-1", role: "assistant", content: "The passage is contrasting memory and place.", createdAt: 2 },
    ];
    useSessionHistoryMock.mockReturnValue({
      messages,
      loading: false,
      loadingOlder: false,
      error: null,
      refresh: vi.fn(),
      loadOlder: vi.fn(),
      hasMoreBefore: false,
      userMessageOffset: 0,
      version: 1,
      forkBoundaryMessageCount: null,
      hasPendingToolCalls: false,
    });

    render(
      <ReaderPage
        state={state()}
        sessionKey="websocket:book-1"
        disabled={false}
        persistenceFailed={false}
        onChange={vi.fn()}
        onImportEpub={vi.fn()}
        onSendReading={vi.fn()}
        onBackToChat={vi.fn()}
      />,
    );

    expect(useSessionHistoryMock).toHaveBeenCalledWith("websocket:book-1");
    const chatPanel = screen.getByRole("complementary", { name: /reader chat/i });
    expect(chatPanel).toHaveTextContent("Explain this image");
    expect(chatPanel).toHaveTextContent("The passage is contrasting memory and place.");
  });
});
