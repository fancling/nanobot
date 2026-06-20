import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ReaderStrip } from "@/components/thread/ReaderStrip";
import { READER_STATE_STORAGE_PREFIX, type ReaderState } from "@/lib/reading";

describe("ReaderStrip", () => {
  beforeEach(() => {
    window.localStorage.clear();
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
    expect(screen.getByDisplayValue("Saved note")).toBeInTheDocument();
    expect(setItemSpy).not.toHaveBeenCalledWith(
      storageKey,
      expect.stringContaining("\"title\":\"\""),
    );
    await waitFor(() => {
      expect(window.localStorage.getItem(storageKey)).toContain("\"title\":\"Saved essay\"");
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
      collapsed: false,
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

    await screen.findByDisplayValue("Chat B essay");
    expect(setItemSpy).not.toHaveBeenCalledWith(
      chatBKey,
      expect.stringContaining("\"title\":\"Chat A"),
    );
    await waitFor(() => {
      expect(window.localStorage.getItem(chatBKey)).toContain("\"title\":\"Chat B essay\"");
    });
  });
});
