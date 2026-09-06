import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  ChevronLeft,
  CloudSun,
  Compass,
  HeartHandshake,
  Loader2,
  MessageCircleMore,
  RefreshCw,
  Shield,
  Smile,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { fetchAffectiveState } from "@/lib/api";
import type {
  AffectiveDimensionName,
  AffectiveStatePayload,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { useClient } from "@/providers/ClientProvider";

const DIMENSIONS: Array<{
  key: AffectiveDimensionName;
  icon: typeof Smile;
}> = [
  { key: "valence", icon: Smile },
  { key: "arousal", icon: Activity },
  { key: "dominance", icon: Shield },
  { key: "affiliation", icon: HeartHandshake },
  { key: "curiosity", icon: Compass },
  { key: "expressiveness", icon: MessageCircleMore },
];

function formatTime(value: string | undefined, locale: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function AffectiveStatePage({ active, hostChromeInset, onBackToChat }: {
  active: boolean;
  hostChromeInset?: boolean;
  onBackToChat: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { token } = useClient();
  const [payload, setPayload] = useState<AffectiveStatePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const loadVersion = useRef(0);

  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    setLoading(true);
    setError(false);
    try {
      const next = await fetchAffectiveState(token);
      if (version === loadVersion.current) setPayload(next);
    } catch {
      if (version === loadVersion.current) setError(true);
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (active) void load();
    return () => { loadVersion.current += 1; };
  }, [active, load]);

  const weather = payload?.environment?.weather;
  const locale = i18n.resolvedLanguage ?? "en";

  return (
    <div className="h-full min-w-0 overflow-y-auto bg-background [scrollbar-gutter:stable]">
      <div className={cn(
        "mx-auto w-full max-w-[920px] px-4 py-6 sm:px-8 sm:py-8 lg:py-12",
        hostChromeInset && "pt-[4.25rem] sm:pt-[4.25rem] lg:pt-[4.75rem]",
      )}>
        <button type="button" onClick={onBackToChat}
          className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground lg:hidden">
          <ChevronLeft className="h-3.5 w-3.5" />{t("settings.backToChat")}
        </button>
        <header className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[24px] font-normal leading-tight text-foreground sm:text-[28px]">
              {t("affectiveState.title")}
            </h1>
            <p className="mt-2 text-[13px] leading-5 text-muted-foreground">
              {t("affectiveState.description")}
            </p>
          </div>
          <Button variant="ghost" size="icon" aria-label={t("affectiveState.refresh")}
            disabled={loading} onClick={() => void load()} className="shrink-0 rounded-full">
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
        </header>

        {error && <div role="alert" className="mb-6 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {t("affectiveState.loadError")}
          <Button variant="ghost" size="sm" onClick={() => void load()} className="ml-2 rounded-full">
            {t("affectiveState.retry")}
          </Button>
        </div>}

        {loading && !payload && <div role="status" className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />{t("affectiveState.loading")}
        </div>}

        {payload && !payload.enabled && <div className="rounded-2xl border border-dashed border-border/60 px-6 py-14 text-center">
          <p className="text-sm font-medium">{t("affectiveState.disabledTitle")}</p>
          <p className="mt-2 text-[13px] text-muted-foreground">{t("affectiveState.disabledDescription")}</p>
        </div>}

        {payload?.enabled && !payload.available && <div className="rounded-2xl border border-dashed border-border/60 px-6 py-14 text-center">
          <p className="text-sm font-medium">{t("affectiveState.emptyTitle")}</p>
          <p className="mt-2 text-[13px] text-muted-foreground">{t("affectiveState.emptyDescription")}</p>
        </div>}

        {payload?.available && payload.dimensions && <>
          <section aria-label={t("affectiveState.dimensions")} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {DIMENSIONS.map(({ key, icon: Icon }) => {
              const dimension = payload.dimensions?.[key];
              if (!dimension) return null;
              return <article key={key} className="rounded-2xl border border-border/55 bg-card/50 p-4">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Icon className="h-3.5 w-3.5" />
                  <span>{t(`affectiveState.dimension.${key}`)}</span>
                </div>
                <p className="mt-3 text-lg font-medium text-foreground">
                  {t(`affectiveState.value.${dimension.value}`, { defaultValue: dimension.value })}
                </p>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">{dimension.description}</p>
              </article>;
            })}
          </section>

          <section className="mt-8 rounded-2xl border border-border/55 p-5">
            <div className="flex items-center gap-2">
              <CloudSun className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-medium">{t("affectiveState.environment")}</h2>
            </div>
            <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div><dt className="text-xs text-muted-foreground">{t("affectiveState.season")}</dt>
                <dd className="mt-1">{t(`affectiveState.value.${payload.environment?.season}`, { defaultValue: payload.environment?.season ?? "—" })}</dd></div>
              <div><dt className="text-xs text-muted-foreground">{t("affectiveState.weather")}</dt>
                <dd className="mt-1">{weather ? t(`affectiveState.value.${weather.condition}`, { defaultValue: weather.condition }) : t("affectiveState.noWeather")}</dd></div>
              <div><dt className="text-xs text-muted-foreground">{t("affectiveState.updated")}</dt>
                <dd className="mt-1 tabular-nums">{formatTime(payload.period, locale)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">{t("affectiveState.nextUpdate")}</dt>
                <dd className="mt-1 tabular-nums">{formatTime(payload.valid_until, locale)}</dd></div>
            </dl>
            {weather?.stale && <p className="mt-4 text-xs text-amber-600 dark:text-amber-400">{t("affectiveState.staleWeather")}</p>}
            {weather?.provider === "open-meteo" && <p className="mt-4 text-[11px] text-muted-foreground">
              <a href="https://open-meteo.com/" target="_blank" rel="noreferrer" className="hover:underline">Weather data by Open-Meteo</a>
            </p>}
          </section>

          <section className="mt-8">
            <h2 className="text-sm font-medium">{t("affectiveState.context")}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{t("affectiveState.contextDescription")}</p>
            <pre data-testid="affective-context" className="mt-3 whitespace-pre-wrap rounded-2xl border border-border/55 bg-muted/30 p-4 font-sans text-[13px] leading-6 text-foreground/85">
              {payload.context_text}
            </pre>
          </section>
        </>}
      </div>
    </div>
  );
}
