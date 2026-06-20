import { useRef } from "react";
import { ArrowLeft, BookOpen, Upload } from "lucide-react";

import { ReaderMode } from "@/components/thread/reader/ReaderMode";
import { Button } from "@/components/ui/button";
import type { ReaderState } from "@/lib/reading";
import type { ReadingSnapshot } from "@/lib/types";

interface ReaderPageProps {
  state: ReaderState | null;
  disabled: boolean;
  persistenceFailed: boolean;
  onChange: (patch: Partial<ReaderState>) => void;
  onImportEpub: (file: File) => void;
  onSendReading: (content: string, snapshot: ReadingSnapshot) => void;
  onBackToChat: () => void;
}

export function ReaderPage({
  state,
  disabled,
  persistenceFailed,
  onChange,
  onImportEpub,
  onSendReading,
  onBackToChat,
}: ReaderPageProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <main aria-label="Reader page" className="flex min-h-0 flex-1 flex-col bg-background">
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

        {state ? (
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
          </div>
        ) : (
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
        )}
      </header>

      {state ? (
        <ReaderMode
          state={state}
          disabled={disabled}
          persistenceFailed={persistenceFailed}
          onChange={onChange}
          onClose={onBackToChat}
          onSendReading={onSendReading}
        />
      ) : (
        <section className="flex min-h-0 flex-1 items-center justify-center px-6 py-10">
          <div className="flex max-w-md flex-col items-center gap-4 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full border border-border bg-muted/30">
              <BookOpen className="h-6 w-6 text-muted-foreground" aria-hidden />
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold text-foreground">
                Import a book to start a reader session
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
          </div>
        </section>
      )}
    </main>
  );
}
