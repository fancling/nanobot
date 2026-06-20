import { useCallback } from "react";

import { parseReaderParagraphs, type ReaderParagraph } from "@/lib/reading";
import { cn } from "@/lib/utils";

interface ReaderDocumentProps {
  title: string;
  rawText: string;
  focusedParagraphIndex: number;
  onFocusParagraph: (index: number) => void;
  onSelectedText: (text: string, paragraphIndex: number | null) => void;
}

function selectedText(): string {
  if (typeof window === "undefined") return "";
  return window.getSelection()?.toString().trim() ?? "";
}

export function ReaderDocument({
  title,
  rawText,
  focusedParagraphIndex,
  onFocusParagraph,
  onSelectedText,
}: ReaderDocumentProps) {
  const paragraphs = parseReaderParagraphs(rawText);

  const handleMouseUp = useCallback(
    (paragraph: ReaderParagraph) => {
      const text = selectedText();
      if (text) onSelectedText(text, paragraph.index);
    },
    [onSelectedText],
  );

  return (
    <main
      aria-label="Reader document"
      className="min-h-0 flex-1 overflow-y-auto bg-background"
    >
      <article className="mx-auto max-w-3xl px-6 py-8 sm:px-10 lg:px-12">
        <div className="mb-8">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Reader
          </p>
          <h1 className="mt-2 text-2xl font-semibold leading-tight text-foreground">
            {title.trim() || "Untitled"}
          </h1>
        </div>
        <div className="space-y-5 text-base leading-8 text-foreground">
          {paragraphs.map((paragraph) => {
            const active = paragraph.index === focusedParagraphIndex;
            return (
              <button
                key={paragraph.id}
                type="button"
                aria-label={`Focus paragraph ${paragraph.index + 1}`}
                aria-pressed={active}
                className={cn(
                  "block w-full rounded-md border px-4 py-3 text-left transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "border-primary/40 bg-primary/10"
                    : "border-transparent hover:border-border hover:bg-muted/40",
                )}
                onClick={() => onFocusParagraph(paragraph.index)}
                onMouseUp={() => handleMouseUp(paragraph)}
              >
                <span className="whitespace-pre-wrap">{paragraph.text}</span>
              </button>
            );
          })}
        </div>
      </article>
    </main>
  );
}
