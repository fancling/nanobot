import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, BookOpen, ChevronRight, FileText, Plus, Trash2, Upload } from "lucide-react";

import { ReaderMode } from "@/components/thread/reader/ReaderMode";
import { Button } from "@/components/ui/button";
import { useSessionHistory } from "@/hooks/useSessions";
import type { StreamError } from "@/lib/nanobot-client";
import {
  getActiveReaderText,
  isReaderSessionState,
  loadReaderStateResult,
  parseReaderParagraphs,
  type ReaderState,
} from "@/lib/reading";
import type { ChatSummary, ReadingSnapshot } from "@/lib/types";
import { useClient } from "@/providers/ClientProvider";

interface ReaderPageProps {
  state: ReaderState | null;
  readerSessions?: ChatSummary[];
  readerMarkerVersion?: number;
  titleOverrides?: Record<string, string>;
  disabled: boolean;
  persistenceFailed: boolean;
  onChange: (patch: Partial<ReaderState>) => void;
  onImportEpub: (file: File) => void;
  onSendReading: (content: string, snapshot: ReadingSnapshot) => void;
  onBackToChat: () => void;
  onOpenSession?: (key: string) => void;
  onCreateSessionFromBook?: (sourceSessionKey: string) => void;
  onRequestDeleteSession?: (key: string, label: string) => void;
}

interface ReaderSessionItem {
  key: string;
  bookId: string;
  bookTitle: string;
  title: string;
  documentId: string;
  documentKind: string;
  sourceFileName: string | null;
  sourceLabel: string;
  updatedLabel: string;
  progressLabel: string;
  sectionLabel: string | null;
  updatedTime: number;
}

interface ReaderBookGroup {
  id: string;
  title: string;
  sourceLabel: string;
  updatedLabel: string;
  progressLabel: string;
  sessionCount: number;
  sessions: ReaderSessionItem[];
}

function fallbackSessionTitle(session: ChatSummary): string {
  const preview = session.preview.trim();
  if (preview) return preview.length > 80 ? `${preview.slice(0, 77).trimEnd()}...` : preview;
  return `Chat ${session.chatId.slice(0, 6)}`;
}

function formatDateLabel(value: string | null | undefined): string {
  if (!value) return "No activity";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No activity";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function timeValue(value: string | null | undefined): number {
  if (!value) return 0;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function readerDocumentId(state: ReaderState | null, session: ChatSummary): string {
  return state?.documentId?.trim() || session.reader?.document_id?.trim() || "";
}

function readerBookTitle(state: ReaderState | null, session: ChatSummary): string {
  return (
    state?.title?.trim()
    || session.reader?.title?.trim()
    || session.title?.trim()
    || fallbackSessionTitle(session)
  );
}

function readerBookId(state: ReaderState | null, session: ChatSummary): string {
  const title = readerBookTitle(state, session).trim().toLowerCase();
  const source = state?.sourceFileName?.trim() || session.reader?.source_file_name?.trim() || "";
  if (title && source) {
    return `source:${title}:${source.toLowerCase()}`;
  }
  const documentId = readerDocumentId(state, session);
  if (documentId) return `document:${documentId}`;
  return `fallback:${title}:${source.toLowerCase()}`;
}

function readerProgressLabel(state: ReaderState | null, session: ChatSummary): string {
  const focusedIndex = state?.focusedParagraphIndex ?? session.reader?.focused_paragraph_index ?? null;
  if (state) {
    const paragraphCount = parseReaderParagraphs(getActiveReaderText(state)).length;
    if (paragraphCount > 0 && focusedIndex !== null) {
      const current = Math.max(1, Math.min(focusedIndex + 1, paragraphCount));
      return `${current} / ${paragraphCount} paragraphs`;
    }
  }

  const activeSectionIndex = state?.activeSectionIndex ?? session.reader?.active_section_index ?? null;
  const sectionCount = state?.sections?.length ?? 0;
  if (sectionCount > 1 && activeSectionIndex !== null) {
    const current = Math.max(1, Math.min(activeSectionIndex + 1, sectionCount));
    return `${current} / ${sectionCount} sections`;
  }
  return "Progress saved";
}

function readerSectionLabel(state: ReaderState | null, session: ChatSummary): string | null {
  const sectionCount = state?.sections?.length ?? 0;
  if (sectionCount <= 0) return null;
  const activeSectionIndex = Math.max(
    0,
    Math.min(state?.activeSectionIndex ?? session.reader?.active_section_index ?? 0, sectionCount - 1),
  );
  const section = state?.sections?.[activeSectionIndex];
  return section?.title?.trim() || `Section ${activeSectionIndex + 1}`;
}

function readerLibraryGroups(
  sessions: ChatSummary[],
  titleOverrides: Record<string, string>,
  markerVersion: number,
): ReaderBookGroup[] {
  void markerVersion;
  const items = sessions.flatMap((session): ReaderSessionItem[] => {
    const localState = loadReaderStateResult(session.chatId).state;
    if (session.reader?.reader_session !== true && !isReaderSessionState(localState)) {
      return [];
    }
    const bookTitle = readerBookTitle(localState, session);
    const documentKind = (localState?.documentKind || session.reader?.document_kind || "reader").toUpperCase();
    const sourceFileName = localState?.sourceFileName?.trim() || session.reader?.source_file_name?.trim() || null;
    const title =
      titleOverrides[session.key]?.trim()
      || session.title?.trim()
      || bookTitle
      || session.reader?.title?.trim()
      || session.title?.trim()
      || fallbackSessionTitle(session);
    return [{
      key: session.key,
      bookId: readerBookId(localState, session),
      bookTitle,
      title,
      documentId: readerDocumentId(localState, session),
      documentKind,
      sourceFileName,
      sourceLabel: sourceFileName ? `${sourceFileName} · ${documentKind}` : documentKind,
      updatedLabel: formatDateLabel(session.updatedAt ?? session.createdAt),
      progressLabel: readerProgressLabel(localState, session),
      sectionLabel: readerSectionLabel(localState, session),
      updatedTime: timeValue(session.updatedAt ?? session.createdAt),
    }];
  });

  const groups = new Map<string, ReaderBookGroup>();
  for (const item of items) {
    const existing = groups.get(item.bookId);
    if (existing) {
      existing.sessions.push(item);
      if (item.updatedTime > existing.sessions[0].updatedTime) {
        existing.title = item.bookTitle;
        existing.sourceLabel = item.sourceLabel;
        existing.updatedLabel = item.updatedLabel;
        existing.progressLabel = item.progressLabel;
      }
      continue;
    }
    groups.set(item.bookId, {
      id: item.bookId,
      title: item.bookTitle,
      sourceLabel: item.sourceLabel,
      updatedLabel: item.updatedLabel,
      progressLabel: item.progressLabel,
      sessionCount: 1,
      sessions: [item],
    });
  }

  return Array.from(groups.values())
    .map((group) => {
      const sortedSessions = [...group.sessions].sort((a, b) => b.updatedTime - a.updatedTime);
      const latest = sortedSessions[0];
      return {
        ...group,
        title: latest.bookTitle,
        sourceLabel: latest.sourceLabel,
        updatedLabel: latest.updatedLabel,
        progressLabel: latest.progressLabel,
        sessionCount: sortedSessions.length,
        sessions: sortedSessions,
      };
    })
    .sort((a, b) => b.sessions[0].updatedTime - a.sessions[0].updatedTime);
}

export function ReaderPage({
  state,
  readerSessions = [],
  readerMarkerVersion = 0,
  titleOverrides = {},
  disabled,
  persistenceFailed,
  onChange,
  onImportEpub,
  onSendReading,
  onBackToChat,
  onOpenSession,
  onCreateSessionFromBook,
  onRequestDeleteSession,
}: ReaderPageProps) {
  const { client } = useClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [streamError, setStreamError] = useState<StreamError | null>(null);
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const workframeId = state?.workframeId?.trim() || null;
  const historyKey = workframeId ? `websocket:${workframeId}` : null;
  const {
    messages,
    loading: chatLoading,
    refresh: refreshHistory,
    hasPendingToolCalls,
  } = useSessionHistory(historyKey);
  const activeWorkframeId = workframeId;
  const shellClassName = "flex min-h-0 flex-1 flex-col bg-background";
  const bookGroups = useMemo(
    () => readerLibraryGroups(readerSessions, titleOverrides, readerMarkerVersion),
    [readerMarkerVersion, readerSessions, titleOverrides],
  );
  const selectedBook = useMemo(
    () => bookGroups.find((book) => book.id === selectedBookId) ?? null,
    [bookGroups, selectedBookId],
  );

  useEffect(() => {
    if (!activeWorkframeId) return;
    return client.onSessionUpdate((updatedChatId, scope) => {
      if (updatedChatId !== activeWorkframeId) return;
      if (scope === "metadata") return;
      refreshHistory();
    });
  }, [activeWorkframeId, client, refreshHistory]);

  useEffect(() => {
    setStreamError(null);
  }, [activeWorkframeId]);

  useEffect(() => {
    return client.onError((error) => {
      if ("chatId" in error && error.chatId && error.chatId !== activeWorkframeId) return;
      setStreamError(error);
    });
  }, [activeWorkframeId, client]);

  useEffect(() => {
    if (selectedBookId && !selectedBook) {
      setSelectedBookId(null);
    }
  }, [selectedBook, selectedBookId]);

  const importInput = (
    <input
      ref={fileInputRef}
      aria-label="Import EPUB"
      type="file"
      accept=".epub,application/epub+zip"
      className="sr-only"
      disabled={disabled}
      onChange={(event) => {
        const file = event.target.files?.[0];
        event.currentTarget.value = "";
        if (!file) return;
        onImportEpub(file);
      }}
    />
  );

  if (state) {
    return (
    <main aria-label="Reader page" className={shellClassName}>
      <header className="flex items-center justify-between gap-3 border-b border-border bg-muted/20 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onBackToChat}
            aria-label="Back to chat"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </Button>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">
              Reader
            </p>
            <p className="truncate text-xs text-muted-foreground">
              Standalone reading view
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="gap-2"
            disabled={disabled}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-4 w-4" aria-hidden />
            <span>Import EPUB</span>
          </Button>
          {importInput}
        </div>
      </header>
      {persistenceFailed ? (
        <p className="px-4 py-2 text-xs text-muted-foreground">
          Reader draft persistence is unavailable in this browser context.
        </p>
      ) : null}
      <ReaderMode
        state={state}
        messages={messages}
        chatLoading={chatLoading}
        isStreaming={hasPendingToolCalls || messages.some((message) => message.isStreaming)}
        disabled={disabled}
        persistenceFailed={persistenceFailed}
        streamError={streamError}
        onDismissStreamError={() => setStreamError(null)}
        onChange={onChange}
        onClose={onBackToChat}
        onSendReading={onSendReading}
      />
    </main>
    );
  }

  return (
    <main aria-label="Reader page" className={shellClassName}>
      <header className="flex items-center justify-between gap-3 border-b border-border bg-muted/20 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onBackToChat}
            aria-label="Back to chat"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </Button>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">
              Reader
            </p>
            <p className="truncate text-xs text-muted-foreground">
              Reading sessions
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="gap-2"
            disabled={disabled}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-4 w-4" aria-hidden />
            <span>Import EPUB</span>
          </Button>
          {importInput}
        </div>
      </header>

      <section className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        {bookGroups.length > 0 ? (
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h1 className="text-xl font-semibold text-foreground">
                  {selectedBook ? selectedBook.title : "Reader library"}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {selectedBook
                    ? `${selectedBook.sessionCount} associated ${selectedBook.sessionCount === 1 ? "session" : "sessions"}`
                    : `${bookGroups.length} saved ${bookGroups.length === 1 ? "book" : "books"}`}
                </p>
              </div>
              {selectedBook ? (
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="gap-2"
                    disabled={disabled || !selectedBook.sessions[0]}
                    onClick={() => {
                      const latestSession = selectedBook.sessions[0];
                      if (!latestSession) return;
                      onCreateSessionFromBook?.(latestSession.key);
                    }}
                    aria-label={`Create Reader session for book: ${selectedBook.title}`}
                  >
                    <Plus className="h-4 w-4" aria-hidden />
                    <span>New session</span>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="gap-2"
                    onClick={() => setSelectedBookId(null)}
                  >
                    <ArrowLeft className="h-4 w-4" aria-hidden />
                    <span>Books</span>
                  </Button>
                </div>
              ) : null}
            </div>
            <div className="grid gap-2">
              {selectedBook
                ? selectedBook.sessions.map((item) => (
                    <article
                      key={item.key}
                      className="flex min-w-0 items-center gap-3 rounded-lg border border-border bg-background px-3 py-3 shadow-sm"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-muted/35">
                        <BookOpen className="h-5 w-5 text-muted-foreground" aria-hidden />
                      </div>
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => onOpenSession?.(item.key)}
                        aria-label={`Open Reader session: ${item.title}`}
                      >
                        <span className="block truncate text-sm font-medium text-foreground">
                          {item.title}
                        </span>
                        <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                          {item.sectionLabel ? (
                            <span className="truncate">{item.sectionLabel}</span>
                          ) : null}
                          <span className="truncate">{item.progressLabel}</span>
                          <span className="truncate">{item.updatedLabel}</span>
                        </span>
                      </button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Delete Reader session: ${item.title}`}
                        onClick={() => onRequestDeleteSession?.(item.key, item.title)}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </Button>
                    </article>
                  ))
                : bookGroups.map((item) => (
                    <article
                      key={item.id}
                      className="flex min-w-0 items-center gap-3 rounded-lg border border-border bg-background px-3 py-3 shadow-sm"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-muted/35">
                        <BookOpen className="h-5 w-5 text-muted-foreground" aria-hidden />
                      </div>
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      onClick={() => setSelectedBookId(item.id)}
                      aria-label={`Open Reader book: ${item.title}`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">
                          {item.title}
                        </span>
                        <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                          <span className="inline-flex min-w-0 items-center gap-1">
                            <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />
                            <span className="truncate">{item.sourceLabel}</span>
                          </span>
                          <span className="truncate">
                            {item.sessionCount} {item.sessionCount === 1 ? "session" : "sessions"}
                          </span>
                          <span className="truncate">{item.progressLabel}</span>
                          <span className="truncate">{item.updatedLabel}</span>
                        </span>
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    </button>
                    </article>
                  ))}
            </div>
            {persistenceFailed ? (
              <p className="text-xs text-muted-foreground">
                Reader draft persistence is unavailable in this browser context.
              </p>
            ) : null}
          </div>
        ) : (
          <div className="flex min-h-full items-center justify-center py-10">
            <div className="flex max-w-md flex-col items-center gap-4 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full border border-border bg-muted/30">
                <BookOpen className="h-6 w-6 text-muted-foreground" aria-hidden />
              </div>
              <div className="space-y-2">
                <h1 className="text-2xl font-semibold text-foreground">
                  Import a book to start a reader session.
                </h1>
                <p className="text-sm leading-6 text-muted-foreground">
                  Open an EPUB to review sections, focus passages, and send questions from a standalone reader page.
                </p>
              </div>
              <Button
                type="button"
                className="gap-2"
                disabled={disabled}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-4 w-4" aria-hidden />
                <span>Import EPUB</span>
              </Button>
              {persistenceFailed ? (
                <p className="text-xs text-muted-foreground">
                  Reader draft persistence is unavailable in this browser context.
                </p>
              ) : null}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
