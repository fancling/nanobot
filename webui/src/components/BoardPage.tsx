import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Check, ChevronLeft, Loader2, Pencil, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { MarkdownText } from "@/components/MarkdownText";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ApiError, fetchBoard } from "@/lib/api";
import { parseBoard, type BoardEntry } from "@/lib/board";
import type { BoardPayload } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useClient } from "@/providers/ClientProvider";

const TYPE_COLORS = ["bg-sky-500", "bg-violet-500", "bg-amber-500", "bg-emerald-500", "bg-rose-500"];

export function BoardPage({ active, hostChromeInset, onBackToChat }: {
  active: boolean;
  hostChromeInset?: boolean;
  onBackToChat: () => void;
}) {
  const { t } = useTranslation();
  const { client, token } = useClient();
  const [board, setBoard] = useState<BoardPayload | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<"load" | "save" | "conflict" | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [selected, setSelected] = useState<BoardEntry | null>(null);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const loadVersion = useRef(0);
  const dirty = board !== null && draft !== board.content;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const entries = useMemo(() => parseBoard(board?.content ?? ""), [board?.content]);
  const types = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of entries) counts.set(entry.type, (counts.get(entry.type) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]);
  }, [entries]);
  const visibleEntries = typeFilter === null ? entries : entries.filter((entry) => entry.type === typeFilter);

  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    setLoading(true);
    setError(null);
    setSaved(false);
    try {
      const payload = await fetchBoard(token);
      if (version !== loadVersion.current || dirtyRef.current) return;
      setBoard(payload);
      setDraft(payload.content);
      setTypeFilter(null);
    } catch {
      if (version === loadVersion.current) setError("load");
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (active && !dirtyRef.current) void load();
    return () => { loadVersion.current += 1; };
  }, [active, load]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const save = async () => {
    if (!board || saving) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const payload = await client.saveBoard(draft, board.revision, token);
      setBoard(payload);
      setDraft(payload.content);
      setEditing(false);
      setTypeFilter(null);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 409 ? "conflict" : "save");
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    setDraft(board?.content ?? "");
    dirtyRef.current = false;
    setEditing(false);
    setDiscardOpen(false);
    void load();
  };

  return (
    <div className="h-full min-w-0 overflow-y-auto bg-background [scrollbar-gutter:stable]">
      <div className={cn(
        "mx-auto w-full max-w-[920px] px-4 py-6 sm:px-8 sm:py-8 lg:py-12",
        hostChromeInset && "pt-[4.25rem] sm:pt-[4.25rem] lg:pt-[4.75rem]",
      )}>
        <button type="button" onClick={onBackToChat} className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground lg:hidden">
          <ChevronLeft className="h-3.5 w-3.5" />{t("settings.backToChat")}
        </button>
        <header className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[24px] font-normal leading-tight text-foreground sm:text-[28px]">{t("board.title")}</h1>
            <p className="mt-2 text-[13px] leading-5 text-muted-foreground">{t("board.description")}</p>
          </div>
          <Button variant="ghost" size="icon" aria-label={t("board.refresh")} title={dirty ? t("board.unsaved") : t("board.refresh")}
            disabled={loading || saving || dirty} onClick={() => void load()} className="shrink-0 rounded-full">
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
        </header>

        {error === "load" && <div role="alert" className="mb-6 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {t(`board.errors.${error}`)}
          {error === "load" && <Button variant="ghost" size="sm" onClick={() => void load()} className="ml-2 rounded-full">{t("board.retry")}</Button>}
        </div>}
        {loading && !board && <div role="status" className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />{t("board.loading")}
        </div>}

        {board && <>
          <section aria-label={t("board.overview")} className="mb-9">
            <p className="text-[12px] font-medium text-muted-foreground">{t("board.total")}</p>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-5xl font-light tracking-tight tabular-nums" data-testid="board-total">{entries.length}</span>
              <span className="text-[13px] text-muted-foreground">{t("board.entries")}</span>
            </div>
          </section>

          {types.length > 0 && <section aria-label={t("board.distribution")} className="mb-9">
            <h2 className="mb-3 text-[13px] font-semibold text-foreground/85">{t("board.distribution")}</h2>
            <div className="mb-4 flex h-2 gap-1 overflow-hidden rounded-full" aria-hidden>
              {types.map(([type, count], index) => <div key={type} className={cn("rounded-full", TYPE_COLORS[index % TYPE_COLORS.length])} style={{ flex: count }} />)}
            </div>
            <div className="flex flex-wrap gap-2">
              {types.map(([type, count], index) => <button key={type} type="button"
                aria-pressed={typeFilter === type} onClick={() => setTypeFilter(typeFilter === type ? null : type)}
                className={cn("inline-flex items-center gap-2 rounded-full border border-border/50 px-3 py-1.5 text-xs transition-colors hover:bg-muted/60", typeFilter === type && "bg-muted border-border")}>
                <span className={cn("h-1.5 w-1.5 rounded-full", TYPE_COLORS[index % TYPE_COLORS.length])} />
                {type || t("board.uncategorized")}<span className="font-medium tabular-nums text-muted-foreground">{count}</span>
              </button>)}
              {typeFilter !== null && <button type="button" onClick={() => setTypeFilter(null)} className="px-2 text-xs text-muted-foreground hover:text-foreground">{t("board.showAll")}</button>}
            </div>
          </section>}

          <section aria-label={t("board.items")}>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-[13px] font-semibold text-foreground/85">{t("board.items")}</h2>
              <span className="text-xs text-muted-foreground">{t("board.openHint")}</span>
            </div>
            {entries.length ? <div className="overflow-x-auto">
              <table className="w-full min-w-[570px] table-fixed text-left text-[13px]">
                <thead className="border-b border-border/60 text-xs font-normal text-muted-foreground">
                  <tr>
                    <th className="w-[24%] py-3 pr-4 font-normal">{t("board.type")}</th>
                    <th className="w-[40%] py-3 pr-4 font-normal">{t("board.content")}</th>
                    <th className="w-[16%] py-3 pr-4 font-normal">{t("board.author")}</th>
                    <th className="w-[20%] py-3 font-normal">{t("board.updatedAt")}</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleEntries.map((entry) => (
                    <tr key={entry.id} onClick={() => setSelected(entry)}
                      className="group cursor-pointer border-b border-border/35 transition-colors hover:bg-muted/35">
                      <td className="py-4 pr-4">
                        <span className="inline-block max-w-full break-words rounded-md bg-muted/70 px-2 py-1 text-xs text-muted-foreground">
                          {entry.type || t("board.uncategorized")}
                        </span>
                      </td>
                      <td className="py-4 pr-4">
                        <button type="button" onClick={() => setSelected(entry)}
                          className="text-left font-medium leading-6 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          {entry.title}
                          <ArrowUpRight className="ml-1 inline h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100" />
                        </button>
                      </td>
                      <td className="break-words py-4 pr-4 text-muted-foreground">{entry.author || "—"}</td>
                      <td className="break-words py-4 text-xs tabular-nums text-muted-foreground">{entry.updatedAt || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div> : <div className="rounded-2xl border border-dashed border-border/60 px-6 py-14 text-center">
              <p className="text-sm font-medium">{t("board.emptyTitle")}</p>
              <p className="mt-2 text-[13px] text-muted-foreground">{board.content.trim() ? t("board.noEntries") : t("board.emptyDescription")}</p>
            </div>}
          </section>

          <footer className="mt-8 border-t border-border/50 pt-5">
            {(error === "save" || error === "conflict") && (
              <p role="alert" className="mb-4 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                {t(`board.errors.${error}`)}
              </p>
            )}
            {!editing ? <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">memory/board.md</p>
              <div className="flex items-center gap-3">
                {saved && <span role="status" className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Check className="h-3.5 w-3.5" />{t("board.saved")}</span>}
                <Button variant="outline" size="sm" className="gap-2 rounded-full" disabled={loading} onClick={() => { setEditing(true); setSaved(false); }}><Pencil className="h-3.5 w-3.5" />{t("board.edit")}</Button>
              </div>
            </div> : <div className="space-y-4">
              <div><h2 className="text-sm font-medium">{t("board.edit")}</h2><p className="mt-1 text-xs text-muted-foreground">{t("board.editHint")}</p></div>
              <Textarea aria-label={t("board.editorLabel")} value={draft} onChange={(event) => { setDraft(event.target.value); setSaved(false); }} disabled={saving || loading}
                className="min-h-[360px] resize-y rounded-xl p-4 font-mono text-[13px] leading-6" spellCheck={false}
                onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); if (dirty) void save(); } }} />
              <div className="flex items-center justify-between gap-3">
                <span role="status" className="text-xs text-muted-foreground">{dirty ? t("board.unsaved") : t("board.upToDate")}</span>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" className="rounded-full" disabled={saving} onClick={() => dirty ? setDiscardOpen(true) : setEditing(false)}>{t("board.cancel")}</Button>
                  <Button size="sm" className="gap-2 rounded-full" disabled={saving || loading || !dirty} onClick={() => void save()}>{saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{t(saving ? "board.saving" : "board.save")}</Button>
                </div>
              </div>
            </div>}
          </footer>
        </>}
      </div>

      <Sheet open={active && selected !== null} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <SheetContent className="w-[min(38rem,100vw)] max-w-none overflow-y-auto px-6 py-8 sm:max-w-none">
          {selected && <>
            <SheetTitle className="pr-7 text-xl font-medium leading-8">{selected.title}</SheetTitle>
            <SheetDescription>
              {[selected.type, selected.author, selected.updatedAt].filter(Boolean).join(" · ")}
            </SheetDescription>
            <div className="mt-3 border-t border-border/50 pt-5">
              <MarkdownText>{selected.content}</MarkdownText>
            </div>
          </>}
        </SheetContent>
      </Sheet>
      <AlertDialog open={active && discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogTitle>{t("board.discardTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("board.discardDescription")}</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("board.keepEditing")}</AlertDialogCancel>
            <AlertDialogAction onClick={discard}>{t("board.discard")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
