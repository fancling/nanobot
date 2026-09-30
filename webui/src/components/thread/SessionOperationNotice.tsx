import { CheckCircle2, CircleAlert, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SessionOperationNoticeProps {
  dismissLabel: string;
  message: string;
  onDismiss: () => void;
  tone?: "success" | "error";
  variant?: "hero" | "thread";
}

export function SessionOperationNotice({
  dismissLabel,
  message,
  onDismiss,
  tone = "success",
  variant = "thread",
}: SessionOperationNoticeProps) {
  const isError = tone === "error";
  const Icon = isError ? CircleAlert : CheckCircle2;

  return (
    <div
      role={isError ? "alert" : "status"}
      className={cn(
        "mx-auto mb-2 flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-[12px] leading-5 text-foreground",
        variant === "hero" ? "max-w-[58rem]" : "max-w-[49.5rem]",
        isError
          ? "border-destructive/30 bg-destructive/10"
          : "border-emerald-500/30 bg-emerald-500/10",
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 h-4 w-4 shrink-0",
          isError
            ? "text-destructive"
            : "text-emerald-600 dark:text-emerald-400",
        )}
        aria-hidden
      />
      <p className="min-w-0 flex-1">{message}</p>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0 text-muted-foreground"
        aria-label={dismissLabel}
        onClick={onDismiss}
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </Button>
    </div>
  );
}
