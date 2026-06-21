import { Bot } from "lucide-react";

import { cn } from "@/lib/utils";

interface ReaderAgentPresenceProps {
  active?: boolean;
}

export function ReaderAgentPresence({ active = false }: ReaderAgentPresenceProps) {
  return (
    <div
      aria-label="Agent presence"
      className={cn(
        "pointer-events-none absolute bottom-5 right-[calc(clamp(24rem,34%,34rem)+1.25rem)] hidden h-16 w-16 items-center justify-center rounded-full border border-background bg-primary text-primary-foreground shadow-xl lg:flex",
        active ? "opacity-100" : "opacity-80",
      )}
    >
      <Bot className="h-8 w-8" aria-hidden />
    </div>
  );
}
