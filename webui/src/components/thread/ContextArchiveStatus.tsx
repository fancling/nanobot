import { Archive, Database, Gauge } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import type { SessionCompactionStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

function formatCount(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

export function ContextArchiveStatus({
  archiving,
  disabled = false,
  extractingMemory = false,
  actionError,
  actionMessage,
  onArchive,
  onExtractMemory,
  status,
  variant = "thread",
}: {
  archiving: boolean;
  disabled?: boolean;
  extractingMemory?: boolean;
  actionError?: string | null;
  actionMessage?: string | null;
  onArchive: () => void;
  onExtractMemory?: () => void;
  status: SessionCompactionStatus;
  variant?: "hero" | "thread";
}) {
  const { i18n, t } = useTranslation();
  const locale = i18n.resolvedLanguage ?? "en";
  const replayMessages = status.replay_message_count ?? Math.min(
    status.message_count,
    status.max_messages ?? status.message_count,
  );
  const replayTokens = status.replay_estimated_tokens ?? status.estimated_tokens;
  const messageRatio = status.max_messages
    ? replayMessages / status.max_messages
    : 0;
  const tokenRatio = replayTokens !== null && status.token_budget
    ? replayTokens / status.token_budget
    : 0;
  const percent = Math.max(0, Math.min(100, Math.round(Math.max(messageRatio, tokenRatio) * 100)));
  const canArchive = status.message_count > (status.keep_recent_messages ?? 0);

  return (
    <section
      aria-label={t("thread.contextUsage.label")}
      className={cn(
        "mx-auto mb-2 w-full rounded-lg border border-border/55 bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground",
        variant === "hero" ? "max-w-[58rem]" : "max-w-[49.5rem]",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Gauge className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="font-medium text-foreground">{t("thread.contextUsage.label")}</span>
        <span>
          {t("thread.contextUsage.messages", {
            used: formatCount(replayMessages, locale),
            limit: status.max_messages === null ? "∞" : formatCount(status.max_messages, locale),
          })}
        </span>
        {replayTokens !== null && status.token_budget ? <span>
          {t("thread.contextUsage.tokens", {
            used: formatCount(replayTokens, locale),
            limit: formatCount(status.token_budget, locale),
          })}
        </span> : null}
        <div className="ml-auto flex items-center gap-2">
          <span className="tabular-nums">{percent}%</span>
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled || archiving || extractingMemory || !canArchive}
            onClick={onArchive}
            className="h-6 gap-1 px-2 text-[11px]"
          >
            <Archive className="h-3 w-3" aria-hidden />
            {archiving
              ? t("thread.contextUsage.archiving")
              : t("thread.contextUsage.archive")}
          </Button>
          {status.memory_extraction_available && onExtractMemory ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={
                disabled
                || archiving
                || extractingMemory
                || (status.session_message_count ?? status.message_count) <= 0
              }
              onClick={onExtractMemory}
              className="h-6 gap-1 px-2 text-[11px]"
            >
              <Database className="h-3 w-3" aria-hidden />
              {extractingMemory
                ? t("thread.contextUsage.extractingMemory")
                : t("thread.contextUsage.extractMemory")}
            </Button>
          ) : null}
        </div>
      </div>
      <div
        role="progressbar"
        aria-label={t("thread.contextUsage.label")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="mt-1.5 h-1 overflow-hidden rounded-full bg-border/55"
      >
        <div
          className="h-full rounded-full bg-primary/65 transition-[width]"
          style={{ width: `${percent}%` }}
        />
      </div>
      {actionMessage ? <p role="status" className="mt-1.5 text-emerald-600 dark:text-emerald-400">
        {actionMessage}
      </p> : null}
      {actionError ? <p role="alert" className="mt-1.5 text-destructive">
        {actionError}
      </p> : null}
    </section>
  );
}
