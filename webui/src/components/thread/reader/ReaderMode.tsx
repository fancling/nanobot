import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo } from "react";

import { ReaderAgentPresence } from "@/components/thread/reader/ReaderAgentPresence";
import { ReaderCompanionRail } from "@/components/thread/reader/ReaderCompanionRail";
import { ReaderDocument } from "@/components/thread/reader/ReaderDocument";
import { Button } from "@/components/ui/button";
import { parseReaderParagraphs, type ReaderState } from "@/lib/reading";
import type { ReadingSnapshot } from "@/lib/types";

interface ReaderModeProps {
  state: ReaderState;
  disabled: boolean;
  persistenceFailed: boolean;
  onChange: (patch: Partial<ReaderState>) => void;
  onClose: () => void;
  onSendReading: (content: string, snapshot: ReadingSnapshot) => void;
}

export function ReaderMode({
  state,
  disabled,
  persistenceFailed,
  onChange,
  onClose,
  onSendReading,
}: ReaderModeProps) {
  const sections = state.sections ?? [];
  const activeSectionIndex = Math.max(
    0,
    Math.min(state.activeSectionIndex ?? 0, Math.max(0, sections.length - 1)),
  );
  const activeSection = sections[activeSectionIndex] ?? null;
  const activeRawText = activeSection?.rawText ?? state.rawText;
  const activeState = activeSection
    ? { ...state, rawText: activeRawText, activeSectionIndex }
    : state;
  const paragraphCount = useMemo(() => parseReaderParagraphs(activeRawText).length, [activeRawText]);
  const focusedParagraphIndex = paragraphCount > 0
    ? Math.max(0, Math.min(state.focusedParagraphIndex, paragraphCount - 1))
    : 0;
  const canNavigateSections = sections.length > 1;

  const handleSectionChange = (nextIndex: number) => {
    const nextSection = sections[nextIndex];
    if (!nextSection) return;
    onChange({
      activeSectionIndex: nextIndex,
      rawText: nextSection.rawText,
      focusedParagraphIndex: 0,
      selectedText: "",
    });
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background lg:flex-row">
      <div className="flex min-h-0 flex-1 flex-col">
        {canNavigateSections ? (
          <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/20 px-4 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">
                {activeSection?.title ?? "Untitled section"}
              </p>
              <p className="text-xs text-muted-foreground">
                {activeSectionIndex + 1} / {sections.length}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Previous section"
                disabled={activeSectionIndex <= 0}
                onClick={() => handleSectionChange(activeSectionIndex - 1)}
              >
                <ChevronLeft className="h-4 w-4" aria-hidden />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Next section"
                disabled={activeSectionIndex >= sections.length - 1}
                onClick={() => handleSectionChange(activeSectionIndex + 1)}
              >
                <ChevronRight className="h-4 w-4" aria-hidden />
              </Button>
            </div>
          </div>
        ) : null}
        <ReaderDocument
          title={state.title}
          rawText={activeRawText}
          focusedParagraphIndex={focusedParagraphIndex}
          onFocusParagraph={(focusedParagraphIndex) => {
            onChange({ focusedParagraphIndex, selectedText: "" });
          }}
          onSelectedText={(selectedText, paragraphIndex) => {
            onChange({
              selectedText,
              ...(paragraphIndex === null ? {} : { focusedParagraphIndex: paragraphIndex }),
            });
          }}
        />
      </div>
      <ReaderCompanionRail
        state={activeState}
        disabled={disabled}
        persistenceFailed={persistenceFailed}
        onChange={onChange}
        onClose={onClose}
        onSendReading={onSendReading}
      />
      <ReaderAgentPresence active={Boolean(state.selectedText || state.question)} />
    </div>
  );
}
