"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Calendar, Check, AlertCircle, Copy, Loader2, ChevronRight, ScrollText } from "lucide-react";
import {
  saveAssignment,
  saveTarget,
  deleteAssignment,
  deleteTarget,
  copyFromYesterday,
} from "./actions";
import type { SalesmanSummaryRow } from "@/lib/sales-monitor/format";
import { formatKg, pct } from "@/lib/sales-monitor/format";

type Beat = { id: string; name: string; city: string | null };

type Props = {
  viewDate: string;
  yesterdayDate: string;
  isToday: boolean;
  summary: SalesmanSummaryRow[];
  beats: Beat[];
};

export function SalesMonitorClient({
  viewDate,
  yesterdayDate,
  isToday,
  summary,
  beats,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [beatEdits, setBeatEdits] = useState<Record<string, string>>({});
  const [targetEdits, setTargetEdits] = useState<Record<string, string>>({});
  const [flash, setFlash] = useState<Record<string, "saved" | "error">>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  function showFlash(key: string, kind: "saved" | "error", err?: string) {
    setFlash(prev => ({ ...prev, [key]: kind }));
    if (err) setErrors(prev => ({ ...prev, [key]: err }));
    setTimeout(() => {
      setFlash(prev => { const n = { ...prev }; delete n[key]; return n; });
      setErrors(prev => { const n = { ...prev }; delete n[key]; return n; });
    }, 3000);
  }

  function withBusy(key: string, fn: () => Promise<void>) {
    setBusy(prev => ({ ...prev, [key]: true }));
    return fn().finally(() => {
      setBusy(prev => { const n = { ...prev }; delete n[key]; return n; });
    });
  }

  async function handleSaveBeat(salesmanId: string, savedBeatId: string | null) {
    const editedBeat = beatEdits[salesmanId];
    if (editedBeat === undefined) return;
    const key = `beat-${salesmanId}`;
    if (!editedBeat) {
      await withBusy(key, async () => {
        const res = await deleteAssignment(salesmanId, viewDate);
        if (res.ok) {
          showFlash(key, "saved");
          setBeatEdits(prev => { const n = { ...prev }; delete n[salesmanId]; return n; });
          startTransition(() => router.refresh());
        } else {
          showFlash(key, "error", res.error);
        }
      });
      return;
    }
    if (editedBeat === savedBeatId) {
      setBeatEdits(prev => { const n = { ...prev }; delete n[salesmanId]; return n; });
      return;
    }
    await withBusy(key, async () => {
      const res = await saveAssignment(salesmanId, viewDate, editedBeat);
      if (res.ok) {
        showFlash(key, "saved");
        setBeatEdits(prev => { const n = { ...prev }; delete n[salesmanId]; return n; });
        startTransition(() => router.refresh());
      } else {
        showFlash(key, "error", res.error);
      }
    });
  }

  async function handleSaveTarget(salesmanId: string, savedTarget: number | null) {
    const editedTarget = targetEdits[salesmanId];
    if (editedTarget === undefined) return;
    const key = `target-${salesmanId}`;
    if (!editedTarget.trim()) {
      await withBusy(key, async () => {
        const res = await deleteTarget(salesmanId, viewDate);
        if (res.ok) {
          showFlash(key, "saved");
          setTargetEdits(prev => { const n = { ...prev }; delete n[salesmanId]; return n; });
          startTransition(() => router.refresh());
        } else {
          showFlash(key, "error", res.error);
        }
      });
      return;
    }
    const target = parseFloat(editedTarget);
    if (!Number.isFinite(target) || target <= 0) {
      showFlash(key, "error", "Must be > 0");
      return;
    }
    if (target === savedTarget) {
      setTargetEdits(prev => { const n = { ...prev }; delete n[salesmanId]; return n; });
      return;
    }
    await withBusy(key, async () => {
      const res = await saveTarget(salesmanId, viewDate, target);
      if (res.ok) {
        showFlash(key, "saved");
        setTargetEdits(prev => { const n = { ...prev }; delete n[salesmanId]; return n; });
        startTransition(() => router.refresh());
      } else {
        showFlash(key, "error", res.error);
      }
    });
  }

  async function handleCopyFromYesterday() {
    if (!confirm(`Copy yesterday's beats and targets to ${viewDate}? Existing entries will be kept.`)) return;
    await withBusy("copy", async () => {
      const res = await copyFromYesterday(viewDate, yesterdayDate);
      if (res.ok) {
        alert(`Copied: ${res.assignmentsCopied} beat${res.assignmentsCopied === 1 ? "" : "s"}, ${res.targetsCopied} target${res.targetsCopied === 1 ? "" : "s"}.`);
        startTransition(() => router.refresh());
      } else {
        alert(`Copy failed: ${res.error}`);
      }
    });
  }

  const totalAssigned = summary.filter(r => r.beat_id).length;
  const totalTargets  = summary.filter(r => r.target_kg != null).length;
  const totalCheckedIn = summary.filter(r => r.checked_in_at).length;
  const totalCallsDone = summary.reduce((sum, r) => sum + r.calls_done, 0);
  const totalKgDone    = summary.reduce((sum, r) => sum + Number(r.kg_done || 0), 0);
  const totalTargetKg  = summary.reduce((sum, r) => sum + Number(r.target_kg || 0), 0);
  const totalSC        = summary.reduce((sum, r) => sum + r.sc, 0);

  return (
    <div className="max-w-6xl mx-auto p-4 lg:p-6">
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold leading-tight">Sales Monitor</h1>
          <p className="text-sm text-ink-muted mt-0.5">
            Daily beat assignments, kg targets, and progress.{" "}
            {isToday ? <span className="text-accent">Viewing today.</span> : <span>Viewing {viewDate}.</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="flex items-center gap-2 text-sm">
            <Calendar size={14} className="text-ink-subtle" />
            <input
              type="date"
              value={viewDate}
              onChange={(e) => router.push(`/sales-monitor?date=${e.target.value}`)}
              className="border border-paper-line rounded px-2 py-1.5 text-sm bg-paper-card focus:outline-none focus:border-accent"
            />
          </label>
          <Link
            href="/sales-monitor/log"
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 border border-paper-line rounded hover:bg-paper-subtle transition-colors"
          >
            <ScrollText size={14} /> Send log
          </Link>
          <button
            onClick={handleCopyFromYesterday}
            disabled={busy["copy"]}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 border border-paper-line rounded hover:bg-paper-subtle disabled:opacity-50 transition-colors"
          >
            {busy["copy"] ? <Loader2 size={14} className="animate-spin" /> : <Copy size={14} />}
            Copy from yesterday
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Stat label="Beats / Targets set" value={`${totalAssigned} / ${totalTargets}`} sub={`of ${summary.length} salesmen`} />
        <Stat label="Calls done"          value={`${totalCallsDone}`}                 sub={totalSC > 0 ? `of ${totalSC} SC` : undefined} />
        <Stat label="Sales (kg)"          value={formatKg(totalKgDone)}                sub={totalTargetKg > 0 ? `of ${formatKg(totalTargetKg)} target` : undefined} />
        <Stat label="Checked in"          value={isToday ? `${totalCheckedIn} / ${summary.length}` : "—"} muted={!isToday} />
      </div>

      <div className="border border-paper-line rounded overflow-hidden bg-paper-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-paper-subtle text-2xs uppercase tracking-wider text-ink-muted">
              <tr>
                <th className="text-left  px-3 py-2.5 font-semibold">Salesman</th>
                <th className="text-left  px-3 py-2.5 font-semibold">Beat / SC</th>
                <th className="text-left  px-3 py-2.5 font-semibold">Target (kg)</th>
                <th className="text-left  px-3 py-2.5 font-semibold">Calls done</th>
                <th className="text-left  px-3 py-2.5 font-semibold">Kg done</th>
                <th className="text-left  px-3 py-2.5 font-semibold">Check-in</th>
                <th className="text-right px-3 py-2.5 font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {summary.map((r) => {
                const editedBeat = beatEdits[r.salesman_id];
                const beatValue = editedBeat !== undefined ? editedBeat : (r.beat_id ?? "");
                const beatDirty = editedBeat !== undefined && editedBeat !== (r.beat_id ?? "");

                const savedTargetStr = r.target_kg != null ? r.target_kg.toString() : "";
                const editedTarget = targetEdits[r.salesman_id];
                const targetValue = editedTarget !== undefined ? editedTarget : savedTargetStr;
                const targetDirty = editedTarget !== undefined && editedTarget !== savedTargetStr;

                const beatKey   = `beat-${r.salesman_id}`;
                const targetKey = `target-${r.salesman_id}`;

                const callsPctValue = pct(r.calls_done, r.sc);
                const kgPctValue    = pct(r.kg_done, r.target_kg);

                return (
                  <tr key={r.salesman_id} className="border-t border-paper-line hover:bg-paper-subtle/40">
                    <td className="px-3 py-3 align-top">
                      <div className="font-medium">{r.salesman_name}</div>
                      {!r.salesman_phone && (
                        <div className="text-2xs text-amber-600 mt-0.5">
                          No phone — won&apos;t get WhatsApp
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3 align-top">
                      <div className="flex items-center gap-2 flex-wrap">
                        <select
                          value={beatValue}
                          onChange={(e) => setBeatEdits(prev => ({ ...prev, [r.salesman_id]: e.target.value }))}
                          className="border border-paper-line rounded px-2 py-1.5 text-sm bg-paper-card min-w-[180px] focus:outline-none focus:border-accent"
                        >
                          <option value="">— no beat —</option>
                          {beats.map(b => (
                            <option key={b.id} value={b.id}>
                              {b.name}{b.city ? ` · ${b.city}` : ""}
                            </option>
                          ))}
                        </select>
                        {beatDirty && (
                          <button
                            onClick={() => handleSaveBeat(r.salesman_id, r.beat_id)}
                            disabled={busy[beatKey]}
                            className="text-xs px-2.5 py-1.5 bg-accent text-white rounded hover:bg-accent/90 disabled:opacity-50 transition-colors"
                          >
                            {busy[beatKey] ? "..." : "Save"}
                          </button>
                        )}
                        {flash[beatKey] === "saved" && (
                          <span className="inline-flex items-center gap-1 text-xs text-accent">
                            <Check size={12} /> Saved
                          </span>
                        )}
                        {flash[beatKey] === "error" && (
                          <span className="text-xs text-danger" title={errors[beatKey]}>Failed</span>
                        )}
                      </div>
                      {r.beat_id && (
                        <div className="text-2xs text-ink-subtle mt-1">SC: {r.sc} customers</div>
                      )}
                    </td>
                    <td className="px-3 py-3 align-top">
                      <div className="flex items-center gap-2 flex-wrap">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={targetValue}
                          onChange={(e) => setTargetEdits(prev => ({ ...prev, [r.salesman_id]: e.target.value }))}
                          placeholder="0"
                          className="border border-paper-line rounded px-2 py-1.5 text-sm bg-paper-card w-24 focus:outline-none focus:border-accent"
                        />
                        {targetDirty && (
                          <button
                            onClick={() => handleSaveTarget(r.salesman_id, r.target_kg)}
                            disabled={busy[targetKey]}
                            className="text-xs px-2.5 py-1.5 bg-accent text-white rounded hover:bg-accent/90 disabled:opacity-50 transition-colors"
                          >
                            {busy[targetKey] ? "..." : "Save"}
                          </button>
                        )}
                        {flash[targetKey] === "saved" && (
                          <span className="inline-flex items-center gap-1 text-xs text-accent">
                            <Check size={12} /> Saved
                          </span>
                        )}
                        {flash[targetKey] === "error" && (
                          <span className="text-xs text-danger" title={errors[targetKey]}>
                            {errors[targetKey] || "Failed"}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <div className="font-medium tabular-nums">{r.calls_done}{r.sc > 0 && <span className="text-ink-subtle"> / {r.sc}</span>}</div>
                      {callsPctValue !== null && (
                        <div className="text-2xs text-ink-subtle">{callsPctValue}%</div>
                      )}
                    </td>
                    <td className="px-3 py-3 align-top">
                      <div className="font-medium tabular-nums">
                        {formatKg(r.kg_done)}
                        {r.target_kg != null && r.target_kg > 0 && (
                          <span className="text-ink-subtle"> / {formatKg(r.target_kg)}</span>
                        )}
                      </div>
                      {kgPctValue !== null && (
                        <div className="text-2xs text-ink-subtle">{kgPctValue}%</div>
                      )}
                    </td>
                    <td className="px-3 py-3 align-top">
                      {!isToday ? (
                        <span className="text-xs text-ink-subtle">—</span>
                      ) : r.checked_in_at ? (
                        <span className="inline-flex items-center gap-1 text-xs text-accent font-medium">
                          <Check size={12} /> Yes
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-ink-subtle">
                          <AlertCircle size={12} /> Not yet
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 align-top text-right">
                      <Link
                        href={`/sales-monitor/${r.salesman_id}?date=${viewDate}`}
                        className="inline-flex items-center gap-0.5 text-xs text-accent hover:underline"
                      >
                        Detail <ChevronRight size={12} />
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {summary.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-12 text-center text-ink-subtle text-sm">
                    No active salesmen.{" "}
                    <Link href="/salesmen" className="text-accent hover:underline">Manage salesmen →</Link>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-5 p-3 border border-dashed border-paper-line rounded text-2xs text-ink-subtle leading-relaxed">
        <strong className="text-ink-muted">Phase 2 live.</strong>{" "}
        Calls and kg figures are computed from live order data (timezone IST). Click <strong>Detail</strong> on any
        row to see focus customers — same breakdown that&apos;ll go into the daily PDF reports (Phase 3).
        WhatsApp delivery (Phase 4) ships once WATi templates are approved.
      </div>
    </div>
  );
}

function Stat({ label, value, sub, muted = false }: { label: string; value: string; sub?: string; muted?: boolean }) {
  return (
    <div className="border border-paper-line rounded p-3 bg-paper-card">
      <div className="text-2xs uppercase tracking-wider text-ink-subtle">{label}</div>
      <div className={`text-lg font-semibold mt-0.5 tabular-nums ${muted ? "text-ink-subtle" : ""}`}>{value}</div>
      {sub && <div className="text-2xs text-ink-subtle mt-0.5">{sub}</div>}
    </div>
  );
}
