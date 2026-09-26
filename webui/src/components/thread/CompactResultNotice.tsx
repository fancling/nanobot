import { CheckCircle2, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";

interface CompactResultNoticeProps {
  consolidatedMessages: number;
  historyWritten: boolean;
  summaryCreated: boolean;
  onDismiss: () => void;
}

export function CompactResultNotice({
  consolidatedMessages,
  historyWritten,
  summaryCreated,
  onDismiss,
}: CompactResultNoticeProps) {
  const { t } = useTranslation();
  const message = historyWritten
    ? t(
      summaryCreated
        ? "thread.compactReminder.success"
        : "thread.compactReminder.rawSuccess",
      { count: consolidatedMessages },
    )
    : t("thread.compactReminder.noChanges");

  return (
    <div
      role="status"
      className="mb-2 flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[12px] leading-5 text-foreground"
    >
      <CheckCircle2
        className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
        aria-hidden
      />
      <p className="min-w-0 flex-1">{message}</p>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0 text-muted-foreground"
        aria-label={t("thread.compactReminder.dismissResult")}
        onClick={onDismiss}
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </Button>
    </div>
  );
}
