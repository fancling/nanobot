import {
  type FormEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ArrowUp, Bot, X } from "lucide-react";

import { StreamErrorNotice } from "@/components/thread/StreamErrorNotice";
import { ThreadMessages } from "@/components/thread/ThreadMessages";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { StreamError } from "@/lib/nanobot-client";
import {
  buildReadingSnapshot,
  parseReaderParagraphs,
  type ReaderState,
} from "@/lib/reading";
import type { ReadingSnapshot, UIMessage } from "@/lib/types";

type PendingReaderPrompt = UIMessage & {
  baselineMessageCount: number;
};

const READER_CHAT_SCROLL_STORAGE_PREFIX = "nanobot-webui.reader-chat.scroll.v1:";
const READER_CHAT_NEAR_BOTTOM_PX = 32;

interface ReaderChatScrollMetrics {
  top: number;
  height: number;
  viewportHeight: number;
}

function readStoredScrollTop(key: string): number | null {
  try {
    const stored = window.sessionStorage.getItem(key);
    if (stored === null) return null;
    const value = Number(stored);
    return Number.isFinite(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

function storeScrollTop(key: string, top: number): void {
  try {
    window.sessionStorage.setItem(key, String(Math.max(0, Math.round(top))));
  } catch {
    // Reader chat still works when session storage is unavailable.
  }
}

interface ReaderChatPanelProps {
  state: ReaderState;
  messages: UIMessage[];
  loading: boolean;
  isStreaming: boolean;
  streamError: StreamError | null;
  disabled: boolean;
  persistenceFailed: boolean;
  onDismissStreamError: () => void;
  onChange: (patch: Partial<ReaderState>) => void;
  onClose: () => void;
  onSendReading: (content: string, snapshot: ReadingSnapshot) => void;
}

export function ReaderChatPanel({
  state,
  messages,
  loading,
  isStreaming,
  streamError,
  disabled,
  persistenceFailed,
  onDismissStreamError,
  onChange,
  onClose,
  onSendReading,
}: ReaderChatPanelProps) {
  const [draft, setDraft] = useState("");
  const [pendingPrompt, setPendingPrompt] = useState<PendingReaderPrompt | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrollMetricsRef = useRef<ReaderChatScrollMetrics | null>(null);
  const restoredScrollKeyRef = useRef<string | null>(null);
  const paragraphs = useMemo(() => parseReaderParagraphs(state.rawText), [state.rawText]);
  const activeParagraphIndex = state.focusedParagraphIndex === null
    ? null
    : paragraphs.length > 0
      ? Math.max(0, Math.min(state.focusedParagraphIndex, paragraphs.length - 1))
      : 0;
  const focused = activeParagraphIndex === null ? undefined : paragraphs[activeParagraphIndex];
  const canSend = paragraphs.length > 0 && !disabled && !isStreaming;
  const displayMessages = pendingPrompt
    ? [
        ...messages.slice(0, pendingPrompt.baselineMessageCount),
        pendingPrompt,
        ...messages.slice(pendingPrompt.baselineMessageCount),
      ]
    : messages;
  const scrollStorageKey = `${READER_CHAT_SCROLL_STORAGE_PREFIX}${
    state.workframeId?.trim() || state.documentId
  }`;

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const previous = scrollMetricsRef.current;
    const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
    if (restoredScrollKeyRef.current !== scrollStorageKey) {
      if (loading) return;
      const storedTop = readStoredScrollTop(scrollStorageKey);
      element.scrollTop = storedTop === null
        ? 0
        : Math.min(storedTop, maxScrollTop);
      restoredScrollKeyRef.current = scrollStorageKey;
    } else if (previous) {
      const wasNearBottom =
        previous.height - previous.top - previous.viewportHeight <= READER_CHAT_NEAR_BOTTOM_PX;
      element.scrollTop = wasNearBottom
        ? maxScrollTop
        : Math.min(previous.top, maxScrollTop);
    }

    scrollMetricsRef.current = {
      top: element.scrollTop,
      height: element.scrollHeight,
      viewportHeight: element.clientHeight,
    };
    storeScrollTop(scrollStorageKey, element.scrollTop);
  }, [displayMessages, loading, scrollStorageKey]);

  useEffect(() => {
    if (!pendingPrompt) return;
    const promptInHistory = messages
      .slice(pendingPrompt.baselineMessageCount)
      .some(
      (message) => message.role === "user" && message.content === pendingPrompt.content,
    );
    if (promptInHistory) {
      setPendingPrompt(null);
    }
  }, [messages, pendingPrompt]);

  useEffect(() => {
    if (streamError) setPendingPrompt(null);
  }, [streamError]);

  const send = (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (!canSend) return;
    const question = draft.trim() || (focused ? "聊聊这一段" : "聊聊这本书");
    const nextState: ReaderState = {
      ...state,
      focusedParagraphIndex: activeParagraphIndex,
      question,
    };
    onChange({
      focusedParagraphIndex: activeParagraphIndex,
      selectedText: state.selectedText,
      note: state.note,
      question,
    });
    setPendingPrompt({
      id: `reader-pending-${Date.now()}`,
      role: "user",
      content: question,
      createdAt: Date.now(),
      baselineMessageCount: messages.length,
    });
    onSendReading(question, buildReadingSnapshot(nextState));
    setDraft("");
  };

  return (
    <aside
      aria-label="Reader chat"
      className="flex max-h-[45vh] min-h-0 w-full shrink-0 flex-col border-t border-border bg-muted/20 lg:max-h-none lg:w-[clamp(24rem,34%,34rem)] lg:border-l lg:border-t-0"
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Bot className="h-4 w-4" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">Reader chat</p>
          </div>
        </div>
        <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close reader">
          <X className="h-4 w-4" aria-hidden />
        </Button>
      </div>

      <div className="space-y-1 border-b border-border px-3 py-2">
        {focused ? (
          <p
            className="truncate text-xs text-muted-foreground"
            aria-label={`Focus: ${focused.text}`}
          >
            <span className="font-medium text-foreground/75">Focus</span>
            <span className="px-1 text-muted-foreground/60" aria-hidden>
              ·
            </span>
            <span>{focused.text}</span>
          </p>
        ) : (
          <p className="truncate text-xs text-muted-foreground">
            {paragraphs.length > 0 ? "Select a paragraph to focus." : "Add reading text to begin."}
          </p>
        )}
        {state.selectedText ? (
          <p
            className="truncate text-xs text-muted-foreground"
            aria-label={`Selection: ${state.selectedText}`}
          >
            <span className="font-medium text-foreground/75">Selection</span>
            <span className="px-1 text-muted-foreground/60" aria-hidden>
              ·
            </span>
            <span>{state.selectedText}</span>
          </p>
        ) : null}
      </div>

      <div
        ref={scrollRef}
        data-testid="reader-chat-scroll"
        className="min-h-0 flex-1 overflow-y-auto px-3 py-2"
        onScroll={(event) => {
          const element = event.currentTarget;
          scrollMetricsRef.current = {
            top: element.scrollTop,
            height: element.scrollHeight,
            viewportHeight: element.clientHeight,
          };
          storeScrollTop(scrollStorageKey, element.scrollTop);
        }}
      >
        {loading && displayMessages.length === 0 ? (
          <p className="text-sm text-muted-foreground">Loading book conversation...</p>
        ) : displayMessages.length > 0 ? (
          <>
            {pendingPrompt ? (
              <p className="mb-3 text-xs text-muted-foreground">Waiting for response...</p>
            ) : null}
            <ThreadMessages messages={displayMessages} isStreaming={isStreaming} />
          </>
        ) : null}
      </div>

      {persistenceFailed ? (
        <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
          Reader draft persistence is unavailable in this browser context.
        </p>
      ) : null}

      {streamError ? (
        <div className="border-t border-border bg-background px-2.5 pt-2">
          <StreamErrorNotice
            error={streamError}
            onDismiss={onDismissStreamError}
          />
        </div>
      ) : null}

      <form className="border-t border-border bg-background p-2.5" onSubmit={send}>
        <label className="sr-only" htmlFor="reader-chat-message">
          Reader chat message
        </label>
        <div className="relative">
          <Textarea
            id="reader-chat-message"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="min-h-14 resize-none pb-10 pr-12"
            placeholder={
              focused
                ? state.selectedText
                  ? "Ask about the selected text"
                  : "Ask about the focused paragraph"
                : paragraphs.length > 0
                  ? "Ask about this book"
                  : "Select a paragraph first"
            }
            disabled={!canSend}
          />
          <Button
            type="submit"
            size="icon"
            aria-label="Send message"
            className="absolute bottom-2 right-2 h-8 w-8 rounded-full border border-foreground bg-foreground text-background shadow-[0_3px_10px_rgba(15,23,42,0.18)] transition-transform hover:scale-[1.03] hover:bg-foreground/90 active:scale-95 disabled:border-foreground disabled:bg-foreground disabled:text-background"
            disabled={!canSend}
          >
            <ArrowUp className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </form>
    </aside>
  );
}
