"use client";

import { useState, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Save, Copy, PlayCircle, Loader2, AlertCircle, Check, AlertTriangle,
} from "lucide-react";
import {
  savePlanForSalesman,
  copyFromOtherJc,
  applyPlanToSchedule,
} from "./actions";

type JourneyCycle = {
  id: string;
  jc_number: number;
  start_date: string;
  end_date: string;
  days_count: number;
  fy_label: string;
};
type PlanEntry = {
  id: string;
  jc_id: string;
  jc_day: number;
  salesman_id: string;
  beat_id: string;
};
type Salesman = { id: string; full_name: string };
type Beat     = { id: string; name: string };

type Props = {
  jc: JourneyCycle;
  planEntries: PlanEntry[];
  salesmen: Salesman[];
  beats: Beat[];
  allCycles: JourneyCycle[];
};

export function JcPlanClient({
  jc, planEntries, salesmen, beats, allCycles,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [currentSalesmanId, setCurrentSalesmanId] = useState(
    salesmen[0]?.id || "",
  );

  // planMap[salesmanId][jcDay] = beatId | null
  const [planMap, setPlanMap] = useState<Record<string, Record<number, string | null>>>(() =>
    buildPlanMap(salesmen, planEntries, jc.days_count),
  );
  const [dirtySalesmen, setDirtySalesmen] = useState<Set<string>>(new Set());

  const [savingState, setSavingState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState("");

  const [copySourceJcId, setCopySourceJcId] = useState<string>(
    allCycles.find((c) => c.jc_number === jc.jc_number - 1)?.id || "",
  );
  const [copyState, setCopyState] = useState<"idle" | "copying" | "error">("idle");
  const [copyError, setCopyError] = useState("");

  const [applyState, setApplyState] = useState<"idle" | "applying" | "error">("idle");
  const [applyResult, setApplyResult] = useState<{ inserted: number; skipped: number } | null>(null);
  const [applyError, setApplyError] = useState("");

  const beatNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of beats) m.set(b.id, b.name);
    return m;
  }, [beats]);

  // Summary of filled days per salesman for the sidebar pill counts
  const filledDaysBySalesman = useMemo(() => {
    const r: Record<string, number> = {};
    for (const s of salesmen) {
      r[s.id] = Object.values(planMap[s.id] || {}).filter((b) => b !== null && b !== "").length;
    }
    return r;
  }, [planMap, salesmen]);

  function setBeatForDay(day: number, beatId: string | null) {
    setPlanMap((prev) => ({
      ...prev,
      [currentSalesmanId]: {
        ...prev[currentSalesmanId],
        [day]: beatId,
      },
    }));
    setDirtySalesmen((prev) => new Set(prev).add(currentSalesmanId));
    setSavingState("idle");
  }

  async function handleSave() {
    setSavingState("saving");
    setSaveError("");
    try {
      const entries = Array.from({ length: jc.days_count }, (_, i) => {
        const day = i + 1;
        return {
          jc_day: day,
          beat_id: planMap[currentSalesmanId]?.[day] ?? null,
        };
      });
      const result = await savePlanForSalesman(jc.id, currentSalesmanId, entries);
      if (result.ok) {
        setDirtySalesmen((prev) => {
          const next = new Set(prev);
          next.delete(currentSalesmanId);
          return next;
        });
        setSavingState("saved");
        setTimeout(() => setSavingState("idle"), 2500);
      } else {
        setSavingState("error");
        setSaveError(result.error || "Save failed");
      }
    } catch (e) {
      setSavingState("error");
      setSaveError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleCopyFromOther() {
    if (!copySourceJcId) return;
    const sourceJc = allCycles.find((c) => c.id === copySourceJcId);
    if (!sourceJc) return;
    if (
      !confirm(
        `Copy the entire plan from JC ${sourceJc.jc_number} into JC ${jc.jc_number}? This overwrites every salesman's current plan in JC ${jc.jc_number}.`,
      )
    ) return;
    setCopyState("copying");
    setCopyError("");
    try {
      const result = await copyFromOtherJc(jc.id, copySourceJcId);
      if (result.ok) {
        startTransition(() => router.refresh());
      } else {
        setCopyState("error");
        setCopyError(result.error || "Copy failed");
      }
    } catch (e) {
      setCopyState("error");
      setCopyError(e instanceof Error ? e.message : String(e));
    } finally {
      if (copyState !== "error") setCopyState("idle");
    }
  }

  async function handleApply(mode: "skip-existing" | "force") {
    if (dirtySalesmen.size > 0) {
      if (
        !confirm(
          "There are unsaved changes for one or more salesmen. Save them first?\n\nOK = continue applying anyway (unsaved changes won't be applied).\nCancel = go back and save first.",
        )
      ) {
        return;
      }
    }
    const msg =
      mode === "force"
        ? `Apply JC ${jc.jc_number} plan to the daily schedule (${jc.days_count} days, ${fmtDate(jc.start_date)} → ${fmtDate(jc.end_date)})?\n\nFORCE mode will OVERWRITE any existing daily assignments — including manual edits — in this date range.\n\nProceed only if you want a clean slate from the plan.`
        : `Apply JC ${jc.jc_number} plan to the daily schedule (${jc.days_count} days, ${fmtDate(jc.start_date)} → ${fmtDate(jc.end_date)})?\n\nDates that already have assignments will be SKIPPED to preserve any manual edits.`;
    if (!confirm(msg)) return;

    setApplyState("applying");
    setApplyError("");
    setApplyResult(null);
    try {
      const result = await applyPlanToSchedule(jc.id, mode);
      if (result.ok) {
        setApplyResult({ inserted: result.inserted, skipped: result.skipped });
        setApplyState("idle");
      } else {
        setApplyState("error");
        setApplyError(result.error || "Apply failed");
      }
    } catch (e) {
      setApplyState("error");
      setApplyError(e instanceof Error ? e.message : String(e));
    }
  }

  const startDate = jc.start_date;

  function dayCalendarLabel(day: number): { weekday: string; dom: string; isSunday: boolean } {
    const [y, m, d] = startDate.split("-").map(Number);
    const base = new Date(Date.UTC(y, m - 1, d));
    base.setUTCDate(base.getUTCDate() + (day - 1));
    const weekday = base.toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" });
    const dom = base.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
    return { weekday, dom, isSunday: base.getUTCDay() === 0 };
  }

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-3">
      <Link
        href="/sales-monitor/journey-cycles"
        className="inline-flex items-center gap-1 text-xs text-ink-muted hover:underline"
      >
        <ArrowLeft size={12} /> All Journey Cycles
      </Link>

      {/* Header */}
      <div className="border border-paper-line rounded bg-paper-card overflow-hidden">
        <div className="px-3 py-2.5 border-b border-paper-line bg-paper-subtle/40">
          <div className="text-lg font-semibold">
            JC {jc.jc_number} <span className="text-sm font-normal text-ink-muted">· {jc.fy_label}</span>
          </div>
          <div className="text-sm text-ink-muted">
            {fmtDate(jc.start_date)} → {fmtDate(jc.end_date)} · {jc.days_count} days
          </div>
        </div>

        {/* Top action bar */}
        <div className="px-3 py-2 border-b border-paper-line bg-paper-subtle/20 flex flex-wrap items-center gap-2">
          <label className="text-2xs uppercase text-ink-muted font-medium">Copy plan from:</label>
          <select
            value={copySourceJcId}
            onChange={(e) => setCopySourceJcId(e.target.value)}
            className="text-xs border border-paper-line rounded px-2 py-1 bg-white"
          >
            <option value="">— pick a JC —</option>
            {allCycles
              .filter((c) => c.id !== jc.id)
              .map((c) => (
                <option key={c.id} value={c.id}>JC {c.jc_number}</option>
              ))}
          </select>
          <button
            onClick={handleCopyFromOther}
            disabled={!copySourceJcId || copyState === "copying"}
            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-paper-line rounded hover:bg-paper-subtle disabled:opacity-50"
          >
            {copyState === "copying" ? <Loader2 size={12} className="animate-spin" /> : <Copy size={12} />}
            Copy
          </button>

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => handleApply("skip-existing")}
              disabled={applyState === "applying"}
              className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 bg-accent text-white rounded hover:bg-accent/90 disabled:opacity-50"
            >
              {applyState === "applying" ? <Loader2 size={12} className="animate-spin" /> : <PlayCircle size={12} />}
              Apply to schedule
            </button>
            <button
              onClick={() => handleApply("force")}
              disabled={applyState === "applying"}
              className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-danger text-danger rounded hover:bg-danger/10 disabled:opacity-50"
              title="Overwrites existing daily assignments — including manual edits"
            >
              <AlertTriangle size={12} /> Force re-apply
            </button>
          </div>
        </div>

        {(copyError || applyError) && (
          <div className="px-3 py-2 text-2xs text-danger border-b border-paper-line bg-danger/5">
            <AlertCircle size={11} className="inline mr-1" />
            {copyError || applyError}
          </div>
        )}
        {applyResult && (
          <div className="px-3 py-2 text-2xs text-accent border-b border-paper-line bg-accent/5">
            <Check size={11} className="inline mr-1" />
            Applied — {applyResult.inserted} inserted, {applyResult.skipped} skipped.
          </div>
        )}

        {/* Salesman picker + filled-days hint */}
        <div className="px-3 py-2 border-b border-paper-line flex items-center gap-2 flex-wrap">
          <label className="text-2xs uppercase text-ink-muted font-medium">Salesman:</label>
          <select
            value={currentSalesmanId}
            onChange={(e) => {
              setCurrentSalesmanId(e.target.value);
              setSavingState("idle");
            }}
            className="text-xs border border-paper-line rounded px-2 py-1 bg-white"
          >
            {salesmen.map((s) => {
              const filled = filledDaysBySalesman[s.id] || 0;
              const dirtyTag = dirtySalesmen.has(s.id) ? " •" : "";
              return (
                <option key={s.id} value={s.id}>
                  {s.full_name} ({filled}/{jc.days_count}){dirtyTag}
                </option>
              );
            })}
          </select>
          <div className="ml-auto flex items-center gap-2">
            {savingState === "saving" && (
              <span className="text-2xs text-ink-muted flex items-center gap-1">
                <Loader2 size={11} className="animate-spin" /> Saving…
              </span>
            )}
            {savingState === "saved" && (
              <span className="text-2xs text-accent flex items-center gap-1">
                <Check size={11} /> Saved
              </span>
            )}
            {savingState === "error" && (
              <span className="text-2xs text-danger flex items-center gap-1" title={saveError}>
                <AlertCircle size={11} /> {saveError}
              </span>
            )}
            <button
              onClick={handleSave}
              disabled={savingState === "saving" || !dirtySalesmen.has(currentSalesmanId)}
              className="inline-flex items-center gap-1 text-xs px-2.5 py-1 bg-accent text-white rounded hover:bg-accent/90 disabled:opacity-50"
            >
              <Save size={11} /> Save{dirtySalesmen.has(currentSalesmanId) ? " changes" : "d"}
            </button>
          </div>
        </div>

        {/* Day grid */}
        <div className="divide-y divide-paper-line">
          {Array.from({ length: jc.days_count }, (_, i) => i + 1).map((day) => {
            const { weekday, dom, isSunday } = dayCalendarLabel(day);
            const beatId = planMap[currentSalesmanId]?.[day] ?? "";
            return (
              <div
                key={day}
                className={`px-3 py-2 flex items-center gap-2 sm:gap-3 ${isSunday ? "bg-paper-subtle/30" : ""}`}
              >
                <div className="w-10 sm:w-14 text-center shrink-0">
                  <div className="text-sm font-semibold leading-none">Day {day}</div>
                  <div className="text-2xs text-ink-subtle mt-0.5">{weekday}</div>
                </div>
                <div className="text-xs text-ink-muted w-16 sm:w-24 shrink-0">{dom}</div>
                <select
                  value={beatId || ""}
                  onChange={(e) => setBeatForDay(day, e.target.value || null)}
                  className={`flex-1 text-xs border border-paper-line rounded px-2 py-1 bg-white ${beatId ? "" : "text-ink-subtle"}`}
                >
                  <option value="">— No beat (off) —</option>
                  {beats.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      </div>

      <p className="text-2xs text-ink-subtle">
        Tip — copy from a previous JC to seed this one, tweak the rows that differ,
        save each salesman, then <em>Apply to schedule</em> when you're happy.
        Day overrides for specific dates can still be made in the regular Sales
        Monitor daily view.
      </p>
    </div>
  );
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

function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
