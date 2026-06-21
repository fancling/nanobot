import { useEffect, useMemo, useState } from "react";
import { Bot, MessageCircle, StickyNote, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  buildReadingSnapshot,
  parseReaderParagraphs,
  type ReaderState,
} from "@/lib/reading";

interface ReaderCompanionRailProps {
  state: ReaderState;
  disabled: boolean;
  persistenceFailed: boolean;
  onChange: (patch: Partial<ReaderState>) => void;
  onClose: () => void;
  onSendReading: (content: string, snapshot: ReturnType<typeof buildReadingSnapshot>) => void;
}

export function ReaderCompanionRail({
  state,
  disabled,
  persistenceFailed,
  onChange,
  onClose,
  onSendReading,
}: ReaderCompanionRailProps) {
  const [paragraphQuestion, setParagraphQuestion] = useState("");
  const [selectionQuestion, setSelectionQuestion] = useState("");
  const [noteDraft, setNoteDraft] = useState(state.note);
  const paragraphs = useMemo(() => parseReaderParagraphs(state.rawText), [state.rawText]);
  const activeParagraphIndex = state.focusedParagraphIndex === null
    ? null
    : paragraphs.length > 0
      ? Math.max(0, Math.min(state.focusedParagraphIndex, paragraphs.length - 1))
      : 0;
  const focused = activeParagraphIndex === null ? undefined : paragraphs[activeParagraphIndex];

  useEffect(() => {
    setParagraphQuestion("");
    setSelectionQuestion("");
    setNoteDraft(state.note);
  }, [state.documentId, state.note]);

  useEffect(() => {
    setSelectionQuestion("");
  }, [state.selectedText]);

  const send = (question: string, selectedText = state.selectedText, note = noteDraft) => {
    if (!focused || disabled) return;
    const nextState: ReaderState = {
      ...state,
      focusedParagraphIndex: activeParagraphIndex,
      selectedText,
      note,
      question,
    };
    onChange({
      focusedParagraphIndex: activeParagraphIndex,
      selectedText,
      note,
      question,
    });
    onSendReading(question.trim() || "聊聊这一段", buildReadingSnapshot(nextState));
  };

  return (
    <aside
      aria-label="Reader companion"
      className="flex max-h-[45vh] min-h-0 w-full shrink-0 flex-col border-t border-border bg-muted/20 lg:max-h-none lg:w-80 lg:border-l lg:border-t-0"
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Bot className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">Reading companion</p>
            <p className="truncate text-xs text-muted-foreground">Reading with you</p>
          </div>
        </div>
        <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close reader">
          <X className="h-4 w-4" aria-hidden />
        </Button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <section>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Current focus
          </p>
          <p className="mt-2 line-clamp-5 rounded-md border border-border bg-background p-3 text-sm leading-6">
            {focused?.text || "Add reading text to begin."}
          </p>
        </section>

        <section className="space-y-2">
          <label
            className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
            htmlFor="reader-paragraph-question"
          >
            Question about focused paragraph
          </label>
          <Textarea
            id="reader-paragraph-question"
            value={paragraphQuestion}
            onChange={(event) => setParagraphQuestion(event.target.value)}
            className="min-h-20 resize-none"
            placeholder="Ask about this paragraph"
          />
          <Button
            type="button"
            className="w-full gap-2"
            disabled={disabled || !focused}
            onClick={() => send(paragraphQuestion)}
          >
            <MessageCircle className="h-4 w-4" aria-hidden />
            <span>Ask about paragraph</span>
          </Button>
        </section>

        <section className="space-y-2">
          <label
            className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
            htmlFor="reader-note"
          >
            Note for this paragraph
          </label>
          <Textarea
            id="reader-note"
            value={noteDraft}
            onChange={(event) => setNoteDraft(event.target.value)}
            className="min-h-16 resize-none"
            placeholder="Add a brief note"
          />
          <Button
            type="button"
            variant="outline"
            className="w-full gap-2"
            disabled={disabled || !focused || !noteDraft.trim()}
            onClick={() => send("聊聊这一段", state.selectedText, noteDraft)}
          >
            <StickyNote className="h-4 w-4" aria-hidden />
            <span>Send note with paragraph</span>
          </Button>
        </section>

        {state.selectedText ? (
          <section className="space-y-2 rounded-md border border-primary/30 bg-primary/10 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Selected text
            </p>
            <p className="line-clamp-4 text-sm leading-6">{state.selectedText}</p>
            <label
              className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
              htmlFor="reader-selection-question"
            >
              Question about selection
            </label>
            <Textarea
              id="reader-selection-question"
              value={selectionQuestion}
              onChange={(event) => setSelectionQuestion(event.target.value)}
              className="min-h-16 resize-none bg-background"
              placeholder="Ask about the selected text"
            />
            <Button
              type="button"
              className="w-full gap-2"
              disabled={disabled}
              onClick={() => send(selectionQuestion || "解释我选中的这段")}
            >
              <MessageCircle className="h-4 w-4" aria-hidden />
              <span>Ask about selection</span>
            </Button>
          </section>
        ) : null}

        {persistenceFailed ? (
          <p className="text-xs text-muted-foreground">
            Reader draft persistence is unavailable in this browser context.
          </p>
        ) : null}
      </div>
    </aside>
  );
}
