import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BookOpen, ChevronDown, ChevronUp, Upload } from "lucide-react";

import { ReaderMode } from "@/components/thread/reader/ReaderMode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  loadReaderStateResult,
  parseReaderParagraphs,
  saveReaderState,
  type ReaderState,
} from "@/lib/reading";
import { importEpubDocument } from "@/lib/readerEpub";
import type { ReadingSnapshot } from "@/lib/types";

interface ReaderStripProps {
  chatId: string | null;
  disabled?: boolean;
  onReaderModeOpenChange?: (open: boolean) => void;
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
    documentKind: "markdown",
    readerModeOpen: false,
  };
}

function transientReaderState(state: ReaderState): ReaderState {
  return {
    ...state,
    readerModeOpen: false,
  };
}

export function ReaderStrip({
  chatId,
  disabled = false,
  onReaderModeOpenChange,
  onSendReading,
}: ReaderStripProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const latestChatIdRef = useRef<string | null>(chatId);
  const [reader, setReader] = useState<ReaderStripState>(() => ({
    chatId,
    ...(() => {
      if (!chatId) {
        return { persistenceFailed: false, value: blankState() };
      }
      const loaded = loadReaderStateResult(chatId);
      return {
        persistenceFailed: loaded.storageFailed,
        value: loaded.state ? transientReaderState(loaded.state) : blankState(),
      };
    })(),
  }));
  const [inlineError, setInlineError] = useState<string | null>(null);
  const state = reader.value;

  latestChatIdRef.current = chatId;

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
      value: loaded.state ? transientReaderState(loaded.state) : blankState(),
    });
    setInlineError(null);
  }, [chatId]);

  useEffect(() => {
    if (!chatId || reader.chatId !== chatId) return;
    const persisted = saveReaderState(chatId, transientReaderState(state));
    if (!persisted && !reader.persistenceFailed) {
      setReader((current) => (
        current.chatId === chatId
          ? { ...current, persistenceFailed: true }
          : current
      ));
    }
  }, [chatId, reader.chatId, reader.persistenceFailed, state]);

  const paragraphs = useMemo(() => parseReaderParagraphs(state.rawText), [state.rawText]);

  useEffect(() => {
    onReaderModeOpenChange?.(Boolean(state.readerModeOpen));
    return () => onReaderModeOpenChange?.(false);
  }, [onReaderModeOpenChange, state.readerModeOpen]);

  if (!chatId) return null;

  const updateState = (patch: Partial<ReaderState>) => {
    setReader((current) => ({
      ...current,
      value: { ...current.value, ...patch },
    }));
  };

  return (
    <>
      {state.readerModeOpen && typeof document !== "undefined"
        ? createPortal(
          <div
            data-testid="reader-mode-portal"
            className="fixed inset-0 z-50 flex min-h-screen bg-background"
          >
            <ReaderMode
              state={state}
              disabled={disabled}
              persistenceFailed={reader.persistenceFailed}
              onChange={updateState}
              onClose={() => updateState({ readerModeOpen: false })}
              onSendReading={onSendReading}
            />
          </div>,
          document.body,
        )
        : null}
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
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              {paragraphs.length > 0
                ? `${paragraphs.length} passages ready`
                : "Paste text or import an EPUB to begin."}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={disabled}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-4 w-4" aria-hidden />
                <span>Import EPUB</span>
              </Button>
              <input
                ref={fileInputRef}
                aria-label="Import EPUB"
                type="file"
                accept=".epub,application/epub+zip"
                className="sr-only"
                disabled={disabled}
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  const startingChatId = chatId;
                  event.currentTarget.value = "";
                  if (!file || !startingChatId) return;
                  try {
                    const imported = await importEpubDocument(file);
                    if (latestChatIdRef.current !== startingChatId) return;
                    setInlineError(null);
                    setReader((current) => (
                      current.chatId === startingChatId
                        ? {
                          ...current,
                          value: {
                            ...current.value,
                            ...imported,
                            focusedParagraphIndex: 0,
                            selectedText: "",
                            note: "",
                            question: "",
                            collapsed: false,
                          },
                        }
                        : current
                    ));
                  } catch (error) {
                    if (latestChatIdRef.current !== startingChatId) return;
                    setInlineError(
                      error instanceof Error
                        ? error.message
                        : "Unable to import EPUB.",
                    );
                  }
                }}
              />
              <Button
                type="button"
                className="gap-1.5"
                disabled={disabled || paragraphs.length === 0}
                onClick={() => updateState({ readerModeOpen: true, collapsed: false })}
              >
                <BookOpen className="h-4 w-4" aria-hidden />
                <span>Enter reader mode</span>
              </Button>
            </div>
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
    </>
  );
}
