import { useEffect, useMemo, useState } from "react";
import { BookOpen, ChevronDown, ChevronUp, MessageCircle, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  buildReadingSnapshot,
  loadReaderStateResult,
  parseReaderParagraphs,
  saveReaderState,
  type ReaderState,
} from "@/lib/reading";
import type { ReadingSnapshot } from "@/lib/types";
import { cn } from "@/lib/utils";

interface ReaderStripProps {
  chatId: string | null;
  disabled?: boolean;
  onSendReading: (content: string, snapshot: ReadingSnapshot) => void;
}

interface ReaderStripState {
  chatId: string | null;
  persistenceFailed: boolean;
  value: ReaderState;
}

function blankState(): ReaderState {
  return {
    version: 1,
    documentId: crypto.randomUUID(),
    title: "",
    rawText: "",
    selectedText: "",
    note: "",
    question: "",
    focusedParagraphIndex: 0,
    mode: "slow_reading",
    collapsed: true,
  };
}

export function ReaderStrip({
  chatId,
  disabled = false,
  onSendReading,
}: ReaderStripProps) {
  const [reader, setReader] = useState<ReaderStripState>(() => ({
    chatId,
    ...(() => {
      if (!chatId) {
        return { persistenceFailed: false, value: blankState() };
      }
      const loaded = loadReaderStateResult(chatId);
      return {
        persistenceFailed: loaded.storageFailed,
        value: loaded.state ?? blankState(),
      };
    })(),
  }));
  const [inlineError, setInlineError] = useState<string | null>(null);
  const state = reader.value;

  useEffect(() => {
    if (!chatId) {
      setReader({
        chatId: null,
        persistenceFailed: false,
        value: blankState(),
      });
      setInlineError(null);
      return;
    }
    const loaded = loadReaderStateResult(chatId);
    setReader({
      chatId,
      persistenceFailed: loaded.storageFailed,
      value: loaded.state ?? blankState(),
    });
    setInlineError(null);
  }, [chatId]);

  useEffect(() => {
    if (!chatId || reader.chatId !== chatId) return;
    const persisted = saveReaderState(chatId, state);
    if (!persisted && !reader.persistenceFailed) {
      setReader((current) => (
        current.chatId === chatId
          ? { ...current, persistenceFailed: true }
          : current
      ));
    }
  }, [chatId, reader.chatId, reader.persistenceFailed, state]);

  const paragraphs = useMemo(() => parseReaderParagraphs(state.rawText), [state.rawText]);
  const activeParagraphIndex = paragraphs.length > 0
    ? Math.max(0, Math.min(state.focusedParagraphIndex, paragraphs.length - 1))
    : 0;

  if (!chatId) return null;

  const updateState = (patch: Partial<ReaderState>) => {
    setReader((current) => ({
      ...current,
      value: { ...current.value, ...patch },
    }));
  };

  const handleSend = () => {
    if (disabled) return;
    if (paragraphs.length === 0) {
      setInlineError("Add some text before sending.");
      return;
    }

    const focusedParagraph = paragraphs[activeParagraphIndex] ?? paragraphs[0];
    if (!focusedParagraph) {
      setInlineError("Add some text before sending.");
      return;
    }

    const nextState: ReaderState = {
      ...state,
      focusedParagraphIndex: focusedParagraph.index,
    };
    const snapshot = buildReadingSnapshot(nextState);
    const content = state.question.trim() || "聊聊这一段";

    setReader((current) => ({
      ...current,
      value: nextState,
    }));
    setInlineError(null);
    onSendReading(content, snapshot);
  };

  return (
    <div className="border-t border-border/60 bg-background/95 px-4 py-3">
      <Button
        type="button"
        variant="ghost"
        className="flex h-auto w-full items-center justify-between rounded-lg border border-border/70 px-3 py-2 text-left"
        aria-label={state.collapsed ? "Open reader" : "Collapse reader"}
        aria-expanded={!state.collapsed}
        onClick={() => updateState({ collapsed: !state.collapsed })}
      >
        <span className="flex min-w-0 items-center gap-2">
          <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate text-sm font-medium">
            {state.title.trim() || "Reader"}
          </span>
        </span>
        {state.collapsed ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        )}
      </Button>

      {!state.collapsed ? (
        <div className="mt-3 space-y-3 rounded-lg border border-border/70 bg-muted/20 p-3">
          <Input
            aria-label="Reading title"
            placeholder="Title"
            value={state.title}
            onChange={(event) => updateState({ title: event.target.value })}
          />
          <Textarea
            aria-label="Reading text"
            placeholder="Paste reading text"
            className="min-h-[120px] resize-y"
            value={state.rawText}
            onChange={(event) => {
              setInlineError(null);
              updateState({ rawText: event.target.value });
            }}
          />
          {paragraphs.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {paragraphs.map((paragraph, index) => {
                const active = index === activeParagraphIndex;
                return (
                  <button
                    key={paragraph.id}
                    type="button"
                    aria-label={paragraph.text}
                    className={cn(
                      "max-w-full rounded-md border px-2.5 py-1.5 text-left text-sm transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border/70 bg-background hover:bg-accent hover:text-accent-foreground",
                    )}
                    onClick={() => {
                      setInlineError(null);
                      updateState({ focusedParagraphIndex: paragraph.index });
                    }}
                  >
                    <span className="line-clamp-2">{paragraph.text}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled
            >
              <Plus className="h-4 w-4" aria-hidden />
              <span>Add a passage</span>
            </Button>
          )}
          <Textarea
            aria-label="Reading note"
            placeholder="Note"
            className="min-h-[72px] resize-y"
            value={state.note}
            onChange={(event) => updateState({ note: event.target.value })}
          />
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              aria-label="Reading question"
              placeholder="Question"
              value={state.question}
              onChange={(event) => updateState({ question: event.target.value })}
            />
            <Button
              type="button"
              className="gap-1.5 sm:self-start"
              onClick={handleSend}
              disabled={disabled}
            >
              <MessageCircle className="h-4 w-4" aria-hidden />
              <span>Chat about this passage</span>
            </Button>
          </div>
          {inlineError ? (
            <p className="text-xs text-destructive">{inlineError}</p>
          ) : null}
          {reader.persistenceFailed ? (
            <p className="text-xs text-muted-foreground">
              Reader draft persistence is unavailable in this browser context.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
