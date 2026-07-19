import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReaderPage } from "@/components/reader/ReaderPage";
import type { ReaderState } from "@/lib/reading";
import type { ChatSummary, UIMessage } from "@/lib/types";
import { useSessionHistory } from "@/hooks/useSessions";
import { useClient } from "@/providers/ClientProvider";

vi.mock("@/hooks/useSessions", () => ({
  useSessionHistory: vi.fn(),
}));

vi.mock("@/providers/ClientProvider", () => ({
  useClient: vi.fn(),
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
    workframeId: "11111111-1111-4111-8111-111111111111",
    sections: [{ id: "s-1", title: "Chapter 1", rawText: "First paragraph.\n\nSecond paragraph.", paragraphCount: 2 }],
    activeSectionIndex: 0,
    ...overrides,
  };
}

describe("ReaderPage", () => {
  const useSessionHistoryMock = vi.mocked(useSessionHistory);
  const useClientMock = vi.mocked(useClient);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    window.localStorage.clear();
    useClientMock.mockReturnValue({
      client: {
        onError: vi.fn(() => vi.fn()),
        onSessionUpdate: vi.fn(() => vi.fn()),
      },
      token: null,
      status: "open",
      modelName: null,
      modelPreset: null,
      setRuntimeModel: vi.fn(),
    });
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

  it("renders saved reader books before their associated sessions", () => {
    window.localStorage.setItem(
      "nanobot.webui.readerShell.v1:book-chat",
      JSON.stringify(state({
        documentId: "book-random-1",
        title: "Stored Book",
        focusedParagraphIndex: 1,
        sourceFileName: "stored.epub",
      })),
    );
    window.localStorage.setItem(
      "nanobot.webui.readerShell.v1:book-chat-2",
      JSON.stringify(state({
        documentId: "book-random-2",
        title: "Stored Book",
        focusedParagraphIndex: 0,
        sourceFileName: "stored.epub",
      })),
    );
    const sessions: ChatSummary[] = [
      {
        key: "websocket:plain-chat",
        channel: "websocket",
        chatId: "plain-chat",
        createdAt: "2026-04-16T10:00:00Z",
        updatedAt: "2026-04-16T10:00:00Z",
        preview: "Plain chat",
      },
      {
        key: "websocket:book-chat",
        channel: "websocket",
        chatId: "book-chat",
        createdAt: "2026-04-16T10:00:00Z",
        updatedAt: "2026-04-16T10:30:00Z",
        preview: "Book chat",
        reader: {
          reader_session: true,
          document_id: "book-random-1",
          title: "Server Book",
          document_kind: "epub",
          source_file_name: "server.epub",
          focused_paragraph_index: 0,
        },
      },
      {
        key: "websocket:book-chat-2",
        channel: "websocket",
        chatId: "book-chat-2",
        createdAt: "2026-04-16T10:00:00Z",
        updatedAt: "2026-04-16T10:35:00Z",
        title: "Second session",
        preview: "Book chat",
        reader: {
          reader_session: true,
          document_id: "book-random-2",
          title: "Server Book",
          document_kind: "epub",
          source_file_name: "server.epub",
          focused_paragraph_index: 0,
        },
      },
    ];
    const onOpenSession = vi.fn();
    const onCreateSessionFromBook = vi.fn();
    const onRequestDeleteSession = vi.fn();

    render(
      <ReaderPage
        state={null}
        readerSessions={sessions}
        titleOverrides={{ "websocket:book-chat": "Pinned Title" }}
        disabled={false}
        persistenceFailed={false}
        onChange={vi.fn()}
        onImportEpub={vi.fn()}
        onSendReading={vi.fn()}
        onBackToChat={vi.fn()}
        onOpenSession={onOpenSession}
        onCreateSessionFromBook={onCreateSessionFromBook}
        onRequestDeleteSession={onRequestDeleteSession}
      />,
    );

    expect(screen.getByRole("heading", { name: "Reader library" })).toBeInTheDocument();
    expect(screen.getByText("Stored Book")).toBeInTheDocument();
    expect(screen.getByText(/stored\.epub/i)).toBeInTheDocument();
    expect(screen.getByText("2 sessions")).toBeInTheDocument();
    expect(screen.queryByText("Plain chat")).not.toBeInTheDocument();
    expect(screen.queryByText("Pinned Title")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open Reader book: Stored Book" }));

    expect(screen.getByRole("heading", { name: "Stored Book" })).toBeInTheDocument();
    expect(screen.getByText("2 associated sessions")).toBeInTheDocument();
    expect(screen.getByText("Pinned Title")).toBeInTheDocument();
    expect(screen.getByText("Second session")).toBeInTheDocument();
    expect(screen.getAllByText("2 / 2 paragraphs").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Create Reader session for book: Stored Book" }));
    expect(onCreateSessionFromBook).toHaveBeenCalledWith("websocket:book-chat-2");

    fireEvent.click(screen.getByRole("button", { name: "Open Reader session: Pinned Title" }));
    expect(onOpenSession).toHaveBeenCalledWith("websocket:book-chat");

    fireEvent.click(screen.getByRole("button", { name: "Delete Reader session: Pinned Title" }));
    expect(onRequestDeleteSession).toHaveBeenCalledWith("websocket:book-chat", "Pinned Title");
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

  it("renders the active workframe history in the reader chat", () => {
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
        disabled={false}
        persistenceFailed={false}
        onChange={vi.fn()}
        onImportEpub={vi.fn()}
        onSendReading={vi.fn()}
        onBackToChat={vi.fn()}
      />,
    );

    expect(useSessionHistoryMock).toHaveBeenCalledWith("websocket:11111111-1111-4111-8111-111111111111");
    const chatPanel = screen.getByRole("complementary", { name: /reader chat/i });
    expect(chatPanel).toHaveTextContent("Explain this image");
    expect(chatPanel).toHaveTextContent("The passage is contrasting memory and place.");
  });

  it("does not read reader history from the ordinary chat session without a workframe", () => {
    render(
      <ReaderPage
        state={state({ workframeId: undefined })}
        disabled={false}
        persistenceFailed={false}
        onChange={vi.fn()}
        onImportEpub={vi.fn()}
        onSendReading={vi.fn()}
        onBackToChat={vi.fn()}
      />,
    );

    expect(useSessionHistoryMock).toHaveBeenCalledWith(null);
  });

  it("refreshes the active workframe history after thread updates", () => {
    const refresh = vi.fn();
    let sessionUpdateHandler: ((chatId: string, scope?: string) => void) | null = null;
    const unsubscribe = vi.fn();
    useClientMock.mockReturnValue({
      client: {
        onError: vi.fn(() => vi.fn()),
        onSessionUpdate: vi.fn((handler: (chatId: string, scope?: string) => void) => {
          sessionUpdateHandler = handler;
          return unsubscribe;
        }),
      },
      token: null,
      status: "open",
      modelName: null,
      modelPreset: null,
      setRuntimeModel: vi.fn(),
    });
    useSessionHistoryMock.mockReturnValue({
      messages: [],
      loading: false,
      loadingOlder: false,
      error: null,
      refresh,
      loadOlder: vi.fn(),
      hasMoreBefore: false,
      userMessageOffset: 0,
      version: 0,
      forkBoundaryMessageCount: null,
      hasPendingToolCalls: false,
    });

    const { unmount } = render(
      <ReaderPage
        state={state()}
        disabled={false}
        persistenceFailed={false}
        onChange={vi.fn()}
        onImportEpub={vi.fn()}
        onSendReading={vi.fn()}
        onBackToChat={vi.fn()}
      />,
    );

    sessionUpdateHandler?.("other-workframe", "thread");
    sessionUpdateHandler?.("11111111-1111-4111-8111-111111111111", "metadata");
    expect(refresh).not.toHaveBeenCalled();

    sessionUpdateHandler?.("11111111-1111-4111-8111-111111111111", "thread");
    expect(refresh).toHaveBeenCalledTimes(1);

    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("surfaces and dismisses stream errors for the active workframe", () => {
    let errorHandler: ((error: { kind: "message_too_big" } | { kind: "workspace_scope_rejected"; chatId: string }) => void) | null = null;
    const unsubscribe = vi.fn();
    useClientMock.mockReturnValue({
      client: {
        onError: vi.fn((handler: (error: { kind: "message_too_big" } | { kind: "workspace_scope_rejected"; chatId: string }) => void) => {
          errorHandler = handler;
          return unsubscribe;
        }),
        onSessionUpdate: vi.fn(() => vi.fn()),
      },
      token: null,
      status: "open",
      modelName: null,
      modelPreset: null,
      setRuntimeModel: vi.fn(),
    });

    const { unmount } = render(
      <ReaderPage
        state={state()}
        disabled={false}
        persistenceFailed={false}
        onChange={vi.fn()}
        onImportEpub={vi.fn()}
        onSendReading={vi.fn()}
        onBackToChat={vi.fn()}
      />,
    );

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    act(() => {
      errorHandler?.({ kind: "workspace_scope_rejected", chatId: "other-workframe" });
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    act(() => {
      errorHandler?.({
        kind: "workspace_scope_rejected",
        chatId: "11111111-1111-4111-8111-111111111111",
      });
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Workspace was not changed");

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    act(() => {
      errorHandler?.({ kind: "message_too_big" });
    });

    const banner = screen.getByRole("alert");
    expect(banner).toHaveTextContent("Message too large");

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
