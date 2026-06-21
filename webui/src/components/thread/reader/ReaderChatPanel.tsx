import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Bot, Send, X } from "lucide-react";

import { ThreadMessages } from "@/components/thread/ThreadMessages";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  buildReadingSnapshot,
  parseReaderParagraphs,
  type ReaderState,
} from "@/lib/reading";
import type { ReadingSnapshot, UIMessage } from "@/lib/types";

interface ReaderChatPanelProps {
  state: ReaderState;
  messages: UIMessage[];
  loading: boolean;
  isStreaming: boolean;
  disabled: boolean;
  persistenceFailed: boolean;
  onChange: (patch: Partial<ReaderState>) => void;
  onClose: () => void;
  onSendReading: (content: string, snapshot: ReadingSnapshot) => void;
}

export function ReaderChatPanel({
  state,
  messages,
  loading,
  isStreaming,
  disabled,
  persistenceFailed,
  onChange,
  onClose,
  onSendReading,
}: ReaderChatPanelProps) {
  const [draft, setDraft] = useState("");
  const [pendingPrompt, setPendingPrompt] = useState<UIMessage | null>(null);
  const paragraphs = useMemo(() => parseReaderParagraphs(state.rawText), [state.rawText]);
  const activeParagraphIndex = paragraphs.length > 0
    ? Math.max(0, Math.min(state.focusedParagraphIndex, paragraphs.length - 1))
    : 0;
  const focused = paragraphs[activeParagraphIndex];
  const canSend = Boolean(focused) && !disabled;
  const hasDraft = draft.trim().length > 0;
  const displayMessages = pendingPrompt ? [...messages, pendingPrompt] : messages;

  useEffect(() => {
    if (!pendingPrompt) return;
    const promptInHistory = messages.some(
      (message) => message.role === "user" && message.content === pendingPrompt.content,
    );
    if (promptInHistory) {
      setPendingPrompt(null);
    }
  }, [messages, pendingPrompt]);

  const send = (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (!focused || disabled) return;
    const question = draft.trim() || "聊聊这一段";
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
    });
    onSendReading(question, buildReadingSnapshot(nextState));
    setDraft("");
  };

  return (
    <aside
      aria-label="Reader chat"
      className="flex max-h-[45vh] min-h-0 w-full shrink-0 flex-col border-t border-border bg-muted/20 lg:max-h-none lg:w-96 lg:border-l lg:border-t-0"
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Bot className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">Reader chat</p>
            <p className="truncate text-xs text-muted-foreground">Book session</p>
          </div>
        </div>
        <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close reader">
          <X className="h-4 w-4" aria-hidden />
        </Button>
      </div>

      <div className="border-b border-border px-4 py-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Current focus
        </p>
        <p className="mt-2 line-clamp-3 rounded-md border border-border bg-background p-3 text-sm leading-6">
          {focused?.text || "Add reading text to begin."}
        </p>
        {state.selectedText ? (
          <div className="mt-3 rounded-md border border-primary/30 bg-primary/10 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Selected text
            </p>
            <p className="mt-1 line-clamp-3 text-sm leading-6">{state.selectedText}</p>
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {loading ? (
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

      <form className="border-t border-border bg-background p-3" onSubmit={send}>
        <label className="sr-only" htmlFor="reader-chat-message">
          Reader chat message
        </label>
        <Textarea
          id="reader-chat-message"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className="min-h-20 resize-none"
          placeholder={state.selectedText ? "Ask about the selected text" : "Ask about the focused paragraph"}
          disabled={disabled}
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="min-w-0 truncate text-xs text-muted-foreground">
            Sends with the active reading context.
          </p>
          <Button type="submit" className="shrink-0 gap-2" disabled={!canSend}>
            <Send className="h-4 w-4" aria-hidden />
            <span>{hasDraft ? "Send reader message" : "聊聊这一段"}</span>
          </Button>
        </div>
      </form>
    </aside>
  );
}
