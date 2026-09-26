import { Archive, Clock3 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";

interface CompactReminderNoticeProps {
  compacting: boolean;
  disabled?: boolean;
  error?: string | null;
  onCompact: () => void;
  onSnooze: () => void;
}

export function CompactReminderNotice({
  compacting,
  disabled = false,
  error = null,
  onCompact,
  onSnooze,
}: CompactReminderNoticeProps) {
  const { t } = useTranslation();

  return (
    <div
      role="status"
      className="mb-2 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] leading-5 text-foreground"
    >
      <Clock3
        className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{t("thread.compactReminder.title")}</p>
        <p className="mt-0.5 text-muted-foreground">
          {t("thread.compactReminder.body")}
        </p>
        {error ? <p className="mt-1 text-destructive">{error}</p> : null}
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={disabled || compacting}
            onClick={onCompact}
            className="h-7 gap-1.5 border-amber-500/35 bg-background px-2.5 text-xs"
          >
            <Archive className="h-3.5 w-3.5" aria-hidden />
            {compacting
              ? t("thread.compactReminder.compacting")
              : t("thread.compactReminder.compactNow")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={compacting}
            onClick={onSnooze}
            className="h-7 px-2.5 text-xs text-muted-foreground"
          >
            {t("thread.compactReminder.snooze")}
          </Button>
        </div>
      </div>
    </div>
  );
}
