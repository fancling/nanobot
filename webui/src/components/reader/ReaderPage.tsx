import { useEffect, useMemo, useRef } from "react";
import { ArrowLeft, BookOpen, Upload } from "lucide-react";

import { ReaderMode } from "@/components/thread/reader/ReaderMode";
import { Button } from "@/components/ui/button";
import { useSessionHistory } from "@/hooks/useSessions";
import type { ReaderState } from "@/lib/reading";
import type { ReadingSnapshot } from "@/lib/types";
import { useClient } from "@/providers/ClientProvider";

interface ReaderPageProps {
  state: ReaderState | null;
  sessionKey: string | null;
  disabled: boolean;
  persistenceFailed: boolean;
  onChange: (patch: Partial<ReaderState>) => void;
  onImportEpub: (file: File) => void;
  onSendReading: (content: string, snapshot: ReadingSnapshot) => void;
  onBackToChat: () => void;
}

export function ReaderPage({
  state,
  sessionKey,
  disabled,
  persistenceFailed,
  onChange,
  onImportEpub,
  onSendReading,
  onBackToChat,
}: ReaderPageProps) {
  const { client } = useClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const {
    messages,
    loading: chatLoading,
    refresh: refreshHistory,
    hasPendingToolCalls,
  } = useSessionHistory(sessionKey);
  const activeChatId = useMemo(() => {
    if (!sessionKey) return null;
    const [channel, chatId] = sessionKey.split(":", 2);
    return channel === "websocket" && chatId ? chatId : null;
  }, [sessionKey]);
  const shellClassName = "flex min-h-0 flex-1 flex-col bg-background";

  useEffect(() => {
    if (!activeChatId) return;
    return client.onSessionUpdate((updatedChatId, scope) => {
      if (updatedChatId !== activeChatId) return;
      if (scope === "metadata") return;
      refreshHistory();
    });
  }, [activeChatId, client, refreshHistory]);

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

  return state ? (
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
        onChange={onChange}
        onClose={onBackToChat}
        onSendReading={onSendReading}
      />
    </main>
  ) : (
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

      <section className="flex min-h-0 flex-1 items-center justify-center px-6 py-10">
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
      </section>
    </main>
  );
}
