import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReaderStrip } from "@/components/thread/ReaderStrip";
import { READER_STATE_STORAGE_PREFIX, type ReaderState } from "@/lib/reading";
import { importEpubDocument } from "@/lib/readerEpub";

vi.mock("@/lib/readerEpub", () => ({
  importEpubDocument: vi.fn(),
}));

const importEpubDocumentMock = vi.mocked(importEpubDocument);

describe("ReaderStrip", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not overwrite saved reader state before hydration on initial render", async () => {
    const savedState: ReaderState = {
      version: 1,
      documentId: "doc-saved",
      title: "Saved essay",
      rawText: "Saved intro.\n\nSaved focus.",
      focusedParagraphIndex: 1,
      selectedText: "",
      note: "Saved note",
      question: "Saved question",
      mode: "slow_reading",
      collapsed: false,
      documentKind: "markdown",
      readerModeOpen: false,
    };
    const storageKey = `${READER_STATE_STORAGE_PREFIX}chat-reader`;
    window.localStorage.setItem(storageKey, JSON.stringify(savedState));
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");

    render(
      <ReaderStrip
        chatId="chat-reader"
        onSendReading={vi.fn()}
      />,
    );

    await screen.findByDisplayValue("Saved essay");
    expect(screen.getByText("2 passages ready")).toBeInTheDocument();
    expect(setItemSpy).not.toHaveBeenCalledWith(
      storageKey,
      expect.stringContaining("\"title\":\"\""),
    );
    await waitFor(() => {
      expect(window.localStorage.getItem(storageKey)).toContain("\"title\":\"Saved essay\"");
      expect(window.localStorage.getItem(storageKey)).toContain("\"note\":\"Saved note\"");
    });
  });

  it("does not persist stale state to a new chat before that chat hydrates", async () => {
    const chatBKey = `${READER_STATE_STORAGE_PREFIX}chat-b`;
    const chatBState: ReaderState = {
      version: 1,
      documentId: "doc-b",
      title: "Chat B essay",
      rawText: "B intro.\n\nB focus.",
      focusedParagraphIndex: 1,
      selectedText: "",
      note: "B note",
      question: "",
      mode: "slow_reading",
      collapsed: true,
      documentKind: "markdown",
      readerModeOpen: false,
    };
    window.localStorage.setItem(chatBKey, JSON.stringify(chatBState));
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");

    const { rerender } = render(
      <ReaderStrip
        chatId="chat-a"
        onSendReading={vi.fn()}
      />,
    );

    rerender(
      <ReaderStrip
        chatId="chat-b"
        onSendReading={vi.fn()}
      />,
    );

    await screen.findByText("Chat B essay");
    expect(setItemSpy).not.toHaveBeenCalledWith(
      chatBKey,
      expect.stringContaining("\"title\":\"Chat A"),
    );
    await waitFor(() => {
      expect(window.localStorage.getItem(chatBKey)).toContain("\"title\":\"Chat B essay\"");
    });
  });

  it("shows a non-blocking warning when draft persistence fails", async () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("storage blocked");
    });

    render(
      <ReaderStrip
        chatId="chat-reader"
        onSendReading={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /open reader/i }));

    expect(
      await screen.findByText(/reader draft persistence is unavailable/i),
    ).toBeInTheDocument();
  });

  it("shows a non-blocking warning when saving the draft fails", async () => {
    const fakeStorage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => {
        throw new Error("storage blocked");
      }),
    } as unknown as Storage;
    vi.spyOn(window, "localStorage", "get").mockReturnValue(fakeStorage);

    render(
      <ReaderStrip
        chatId="chat-reader"
        onSendReading={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /open reader/i }));

    expect(
      await screen.findByText(/reader draft persistence is unavailable/i),
    ).toBeInTheDocument();
  });

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
      collapsed: true,
      documentKind: "markdown",
      readerModeOpen: false,
    };
    window.localStorage.setItem(
      `${READER_STATE_STORAGE_PREFIX}chat-reader`,
      JSON.stringify(savedState),
    );

    render(<ReaderStrip chatId="chat-reader" onSendReading={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: /open reader/i }));
    fireEvent.click(screen.getByRole("button", { name: /enter reader mode/i }));

    expect(screen.getByRole("main", { name: /reader document/i })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: /reader companion/i })).toBeInTheDocument();
  });

  it("renders reader mode in a fixed portal layer", async () => {
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
      collapsed: true,
      documentKind: "markdown",
      readerModeOpen: false,
    };
    window.localStorage.setItem(
      `${READER_STATE_STORAGE_PREFIX}chat-reader`,
      JSON.stringify(savedState),
    );
    const host = document.createElement("section");
    document.body.append(host);

    render(<ReaderStrip chatId="chat-reader" onSendReading={vi.fn()} />, {
      container: host,
    });

    fireEvent.click(await screen.findByRole("button", { name: /open reader/i }));
    fireEvent.click(screen.getByRole("button", { name: /enter reader mode/i }));

    const portal = screen.getByTestId("reader-mode-portal");
    expect(portal).toBeInTheDocument();
    expect(portal).toHaveClass("fixed");
    expect(portal).toContainElement(screen.getByRole("main", { name: /reader document/i }));
    expect(host).not.toContainElement(portal);
  });

  it("ignores deferred EPUB import results after switching chats", async () => {
    let resolveImport:
      | ((value: Awaited<ReturnType<typeof importEpubDocument>>) => void)
      | null = null;
    importEpubDocumentMock.mockReturnValue(new Promise((resolve) => {
      resolveImport = resolve;
    }));

    const { rerender } = render(
      <ReaderStrip
        chatId="chat-a"
        onSendReading={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /open reader/i }));
    const importButton = screen.getByRole("button", { name: /import epub/i });
    expect(importButton).toBeInTheDocument();
    const fileInput = screen.getByLabelText(/import epub/i);
    fireEvent.change(fileInput, {
      target: { files: [new File(["epub"], "book.epub", { type: "application/epub+zip" })] },
    });

    rerender(
      <ReaderStrip
        chatId="chat-b"
        onSendReading={vi.fn()}
      />,
    );

    resolveImport?.({
      documentId: "epub-doc",
      title: "Chat A EPUB",
      rawText: "Imported for A.",
      documentKind: "epub",
    });

    await waitFor(() => expect(importEpubDocumentMock).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: /open reader/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /open reader/i }));
    expect(screen.getByLabelText(/reading title/i)).toHaveValue("");
    expect(screen.getByLabelText(/reading text/i)).toHaveValue("");
    expect(screen.queryByText("Chat A EPUB")).not.toBeInTheDocument();
    expect(screen.queryByText(/unable to import epub/i)).not.toBeInTheDocument();
  });

  it("uses a real import button and disables it with the strip", () => {
    render(
      <ReaderStrip
        chatId="chat-reader"
        disabled
        onSendReading={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /open reader/i }));

    expect(screen.getByRole("button", { name: /import epub/i })).toBeDisabled();
    expect(screen.getByLabelText(/import epub/i)).toBeDisabled();
  });
});
