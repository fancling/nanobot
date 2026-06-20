import { ReaderAgentPresence } from "@/components/thread/reader/ReaderAgentPresence";
import { ReaderCompanionRail } from "@/components/thread/reader/ReaderCompanionRail";
import { ReaderDocument } from "@/components/thread/reader/ReaderDocument";
import type { ReaderState } from "@/lib/reading";
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
  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background lg:flex-row">
      <ReaderDocument
        title={state.title}
        rawText={state.rawText}
        focusedParagraphIndex={state.focusedParagraphIndex}
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
      <ReaderCompanionRail
        state={state}
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
