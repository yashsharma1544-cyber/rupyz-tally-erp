"use client";

import { useState, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Save, Copy, PlayCircle, Loader2, AlertCircle, Check, AlertTriangle, Target,
} from "lucide-react";
import Link from "next/link";
import { savePlanForSalesman, copyFromOtherJc, applyPlanToSchedule } from "./pjp-actions";
import { TargetSheetButton } from "./target-sheet-button";

type JourneyCycle = {
  id: string; jc_number: number; start_date: string; end_date: string; days_count: number; fy_label: string;
};
type PlanEntry = {
  id: string;
  jc_id: string;
  jc_day: number;
  salesman_id: string;
  beat_id: string;
  visit_type?: "order" | "collection" | null;
};
type VisitType = "order" | "collection";
type Salesman = { id: string; full_name: string };
type Beat = { id: string; name: string };

type Props = {
  jc: JourneyCycle;
  allCycles: JourneyCycle[];
  planEntries: PlanEntry[];
  salesmen: Salesman[];
  beats: Beat[];
  today: string;
};

export function PjpGridClient({ jc, allCycles, planEntries, salesmen, beats, today }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // planMap[salesmanId][jcDay] = beatId | null
  const [planMap, setPlanMap] = useState<Record<string, Record<number, string | null>>>(() =>
    buildPlanMap(salesmen, planEntries, jc.days_count),
  );
  // visitMap[salesmanId][jcDay] = "order" | "collection"
  const [visitMap, setVisitMap] = useState<Record<string, Record<number, VisitType>>>(() =>
    buildVisitMap(salesmen, planEntries, jc.days_count),
  );
  const [dirty, setDirty] = useState<Set<string>>(new Set());

  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState("");

  const [copySource, setCopySource] = useState<string>(
    allCycles.find((c) => c.jc_number === jc.jc_number - 1)?.id || "",
  );
  const [copyState, setCopyState] = useState<"idle" | "copying" | "error">("idle");
  const [copyError, setCopyError] = useState("");

  const [applyState, setApplyState] = useState<"idle" | "applying" | "error">("idle");
  const [applyResult, setApplyResult] = useState<{ inserted: number; skipped: number } | null>(null);
  const [applyError, setApplyError] = useState("");

  function switchJc(id: string) {
    startTransition(() => router.push(`/sales-monitor/journey-cycles?jc=${id}`));
  }

  function setBeat(salesmanId: string, day: number, beatId: string | null) {
    setPlanMap((prev) => ({
      ...prev,
      [salesmanId]: { ...prev[salesmanId], [day]: beatId },
    }));
    if (!beatId) {
      setVisitMap((prev) => ({
        ...prev,
        [salesmanId]: { ...prev[salesmanId], [day]: "order" },
      }));
    }
    setDirty((prev) => new Set(prev).add(salesmanId));
    setSaveState("idle");
  }

  function toggleVisit(salesmanId: string, day: number) {
    setVisitMap((prev) => {
      const cur = prev[salesmanId]?.[day] ?? "order";
      return {
        ...prev,
        [salesmanId]: { ...prev[salesmanId], [day]: cur === "order" ? "collection" : "order" },
      };
    });
    setDirty((prev) => new Set(prev).add(salesmanId));
    setSaveState("idle");
  }

  const filledBySalesman = useMemo(() => {
    const r: Record<string, number> = {};
    for (const s of salesmen) r[s.id] = Object.values(planMap[s.id] || {}).filter((b) => b !== null && b !== "").length;
    return r;
  }, [planMap, salesmen]);

  async function handleSaveAll() {
    if (dirty.size === 0) return;
    setSaveState("saving");
    setSaveError("");
    try {
      for (const sid of Array.from(dirty)) {
        const entries = Array.from({ length: jc.days_count }, (_, i) => ({
          jc_day: i + 1,
          beat_id: planMap[sid]?.[i + 1] ?? null,
          visit_type: visitMap[sid]?.[i + 1] ?? "order",
        }));
        const res = await savePlanForSalesman(jc.id, sid, entries);
        if (!res.ok) {
          setSaveState("error");
          setSaveError(res.error || "Save failed");
          return;
        }
      }
      setDirty(new Set());
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 2500);
    } catch (e) {
      setSaveState("error");
      setSaveError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleCopy() {
    if (!copySource) return;
    const src = allCycles.find((c) => c.id === copySource);
    if (!src) return;
    if (!confirm(`Copy the entire plan from JC ${src.jc_number} into JC ${jc.jc_number}? This overwrites every salesman's current plan in JC ${jc.jc_number}.`)) return;
    setCopyState("copying");
    setCopyError("");
    try {
      const res = await copyFromOtherJc(jc.id, copySource);
      if (res.ok) startTransition(() => router.refresh());
      else {
        setCopyState("error");
        setCopyError(res.error || "Copy failed");
      }
    } catch (e) {
      setCopyState("error");
      setCopyError(e instanceof Error ? e.message : String(e));
    } finally {
      if (copyState !== "error") setCopyState("idle");
    }
  }

  async function handleApply(mode: "skip-existing" | "force") {
    if (dirty.size > 0 && !confirm("There are unsaved changes. Apply anyway? Unsaved changes won't be applied — Save first to include them.")) return;
    const msg =
      mode === "force"
        ? `Apply JC ${jc.jc_number} to the daily schedule? FORCE overwrites existing daily assignments (including manual edits) across ${fmtDate(jc.start_date)} → ${fmtDate(jc.end_date)}.`
        : `Apply JC ${jc.jc_number} to the daily schedule? Dates that already have assignments will be skipped to preserve manual edits.`;
    if (!confirm(msg)) return;
    setApplyState("applying");
    setApplyError("");
    setApplyResult(null);
    try {
      const res = await applyPlanToSchedule(jc.id, mode);
      if (res.ok) {
        setApplyResult({ inserted: res.inserted, skipped: res.skipped });
        setApplyState("idle");
      } else {
        setApplyState("error");
        setApplyError(res.error || "Apply failed");
      }
    } catch (e) {
      setApplyState("error");
      setApplyError(e instanceof Error ? e.message : String(e));
    }
  }

  const days = Array.from({ length: jc.days_count }, (_, i) => i + 1);
  const isCurrent = jc.start_date <= today && jc.end_date >= today;

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="border border-paper-line rounded bg-paper-card">
        <div className="px-3 py-2.5 border-b border-paper-line bg-paper-subtle/40 flex flex-wrap items-center gap-2">
          <label className="text-2xs uppercase text-ink-muted font-medium">Journey Cycle</label>
          <select
            value={jc.id}
            onChange={(e) => switchJc(e.target.value)}
            disabled={isPending}
            className="text-sm border border-paper-line rounded px-2 py-1 bg-white font-medium disabled:opacity-50"
          >
            {allCycles.map((c) => {
              const cur = c.start_date <= today && c.end_date >= today;
              return (
                <option key={c.id} value={c.id}>
                  JC {c.jc_number} ({c.start_date.slice(5)}→{c.end_date.slice(5)}){cur ? " • current" : ""}
                </option>
              );
            })}
          </select>
          {isPending && <Loader2 size={13} className="animate-spin text-ink-muted" />}
          <span className="text-2xs text-ink-muted">
            {fmtDate(jc.start_date)} → {fmtDate(jc.end_date)} · {jc.days_count} days{isCurrent ? " · current" : ""}
          </span>
          <Link
            href="/sales-monitor?tab=targets"
            className="inline-flex items-center gap-1 text-2xs text-accent hover:underline"
            title="Set area / beat / customer targets for this JC"
          >
            <Target size={11} /> Set targets
          </Link>

          <div className="ml-auto flex items-center gap-2">
            {saveState === "saving" && <span className="text-2xs text-ink-muted flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> Saving…</span>}
            {saveState === "saved" && <span className="text-2xs text-ok flex items-center gap-1"><Check size={11} /> Saved</span>}
            {saveState === "error" && <span className="text-2xs text-danger flex items-center gap-1" title={saveError}><AlertCircle size={11} /> {saveError}</span>}
            <button
              onClick={handleSaveAll}
              disabled={saveState === "saving" || dirty.size === 0}
              className="inline-flex items-center gap-1 text-xs px-3 py-1.5 bg-accent text-white rounded hover:bg-accent/90 disabled:opacity-50"
            >
              <Save size={12} /> Save{dirty.size > 0 ? ` (${dirty.size})` : "d"}
            </button>
          </div>
        </div>

        <div className="px-3 py-2 border-b border-paper-line bg-paper-subtle/20 flex flex-wrap items-center gap-2">
          <label className="text-2xs uppercase text-ink-muted font-medium">Copy from</label>
          <select
            value={copySource}
            onChange={(e) => setCopySource(e.target.value)}
            className="text-xs border border-paper-line rounded px-2 py-1 bg-white"
          >
            <option value="">— pick a JC —</option>
            {allCycles.filter((c) => c.id !== jc.id).map((c) => (
              <option key={c.id} value={c.id}>JC {c.jc_number}</option>
            ))}
          </select>
          <button
            onClick={handleCopy}
            disabled={!copySource || copyState === "copying"}
            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-paper-line rounded hover:bg-paper-subtle disabled:opacity-50"
          >
            {copyState === "copying" ? <Loader2 size={12} className="animate-spin" /> : <Copy size={12} />} Copy
          </button>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => handleApply("skip-existing")}
              disabled={applyState === "applying"}
              className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 bg-accent text-white rounded hover:bg-accent/90 disabled:opacity-50"
            >
              {applyState === "applying" ? <Loader2 size={12} className="animate-spin" /> : <PlayCircle size={12} />} Apply to schedule
            </button>
            <button
              onClick={() => handleApply("force")}
              disabled={applyState === "applying"}
              className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-danger text-danger rounded hover:bg-danger/10 disabled:opacity-50"
              title="Overwrites existing daily assignments including manual edits"
            >
              <AlertTriangle size={12} /> Force
            </button>
          </div>
        </div>

        {(copyError || applyError) && (
          <div className="px-3 py-2 text-2xs text-danger border-b border-paper-line bg-danger/5">
            <AlertCircle size={11} className="inline mr-1" /> {copyError || applyError}
          </div>
        )}
        {applyResult && (
          <div className="px-3 py-2 text-2xs text-ok border-b border-paper-line bg-ok-soft/30">
            <Check size={11} className="inline mr-1" /> Applied — {applyResult.inserted} inserted, {applyResult.skipped} skipped.
          </div>
        )}
      </div>

      {/* Grid: days down the rows, salesmen across the columns */}
      <TargetSheetButton
        jc={jc}
        salesmen={salesmen}
        beats={beats}
        planMap={planMap}
        visitMap={visitMap}
      />

      <div className="border border-paper-line rounded bg-paper-card overflow-x-auto">
        <table className="w-full text-xs border-collapse min-w-[640px]">
          <thead>
            <tr className="bg-paper-subtle/70 border-b border-paper-line">
              <th className="sticky left-0 z-10 bg-paper-subtle/90 px-2 py-2 text-left font-medium text-2xs uppercase tracking-wide text-ink-muted w-28 border-r border-paper-line">
                Day
              </th>
              {salesmen.map((s) => (
                <th key={s.id} className="px-2 py-2 text-left font-medium min-w-[150px]">
                  <div className="truncate">{s.full_name}</div>
                  <div className="text-2xs text-ink-subtle font-normal">
                    {filledBySalesman[s.id] || 0}/{jc.days_count}
                    {dirty.has(s.id) ? " · unsaved" : ""}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-paper-line">
            {days.map((day) => {
              const { weekday, dom, isSunday } = dayCalendarLabel(jc.start_date, day);
              return (
                <tr key={day} className={isSunday ? "bg-paper-subtle/30" : ""}>
                  <td className="sticky left-0 z-10 bg-paper-card px-2 py-1.5 align-top w-24 min-w-24 whitespace-nowrap border-r border-paper-line">
                    <div className="text-2xs text-ink-subtle leading-none">Day {day}</div>
                    <div className="font-semibold text-sm leading-tight mt-0.5">{weekday} &middot; {dom}</div>
                  </td>
                  {salesmen.map((s) => {
                    const beatId = planMap[s.id]?.[day] ?? "";
                    const isCollection = (visitMap[s.id]?.[day] ?? "order") === "collection";
                    return (
                      <td key={s.id} className="px-1.5 py-1 align-top">
                        <div className="flex items-center gap-1">
                          <select
                            value={beatId || ""}
                            onChange={(e) => setBeat(s.id, day, e.target.value || null)}
                            className={`min-w-0 flex-1 text-xs border rounded px-1.5 py-1 bg-white ${
                              isCollection ? "border-amber-400" : "border-paper-line"
                            } ${beatId ? "" : "text-ink-subtle"}`}
                          >
                            <option value="">— off —</option>
                            {beats.map((b) => (
                              <option key={b.id} value={b.id}>{b.name}</option>
                            ))}
                          </select>
                          {beatId && (
                            <button
                              type="button"
                              onClick={() => toggleVisit(s.id, day)}
                              title={isCollection ? "Collection day \u2014 tap for order day" : "Order day \u2014 tap for collection day"}
                              className={`shrink-0 w-6 h-6 rounded border text-xs font-semibold transition-colors ${
                                isCollection
                                  ? "bg-amber-100 border-amber-400 text-amber-800"
                                  : "bg-white border-paper-line text-ink-subtle"
                              }`}
                            >
                              {isCollection ? "\u20b9" : "\u2022"}
                            </button>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-2xs text-ink-subtle">
        Pick a JC, set each salesman&apos;s beat per day for the whole cycle, Save, then <em>Apply to schedule</em> to push it into the daily plan.
        Copy from a previous JC to seed a new one. Sundays are shaded; leave a cell on &ldquo;off&rdquo; for a non-working day.
        Day-specific overrides can still be made in the regular daily Sales Monitor view.
        Tap the dot beside a beat to mark that day as a &#8377; collection visit.
      </p>
    </div>
  );
}

function buildVisitMap(
  salesmen: Salesman[],
  entries: PlanEntry[],
  daysCount: number,
): Record<string, Record<number, VisitType>> {
  const map: Record<string, Record<number, VisitType>> = {};
  for (const s of salesmen) {
    map[s.id] = {};
    for (let d = 1; d <= daysCount; d++) map[s.id][d] = "order";
  }
  for (const e of entries) {
    if (!map[e.salesman_id]) map[e.salesman_id] = {};
    map[e.salesman_id][e.jc_day] = e.visit_type === "collection" ? "collection" : "order";
  }
  return map;
}

function buildPlanMap(
  salesmen: Salesman[],
  entries: PlanEntry[],
  daysCount: number,
): Record<string, Record<number, string | null>> {
  const map: Record<string, Record<number, string | null>> = {};
  for (const s of salesmen) {
    map[s.id] = {};
    for (let d = 1; d <= daysCount; d++) map[s.id][d] = null;
  }
  for (const e of entries) {
    if (!map[e.salesman_id]) map[e.salesman_id] = {};
    map[e.salesman_id][e.jc_day] = e.beat_id;
  }
  return map;
}

function dayCalendarLabel(startDate: string, day: number): { weekday: string; dom: string; isSunday: boolean } {
  const [y, m, d] = startDate.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  base.setUTCDate(base.getUTCDate() + (day - 1));
  return {
    weekday: base.toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" }),
    dom: base.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }),
    isSunday: base.getUTCDay() === 0,
  };
}

function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
