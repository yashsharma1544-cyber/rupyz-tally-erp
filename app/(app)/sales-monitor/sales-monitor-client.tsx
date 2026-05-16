"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Calendar, Check, AlertCircle, Copy, Loader2 } from "lucide-react";
import {
  saveAssignment,
  saveTarget,
  deleteAssignment,
  deleteTarget,
  copyFromYesterday,
} from "./actions";

type Salesman = { id: string; name: string; phone: string | null };
type Beat = { id: string; name: string; city: string | null };
type Assignment = { salesman_id: string; beat_id: string };
type Target = { salesman_id: string; target_kg: number };
type Checkin = { salesman_id: string; checked_in_at: string };

type Props = {
  viewDate: string;
  yesterdayDate: string;
  isToday: boolean;
  salesmen: Salesman[];
  beats: Beat[];
  assignments: Assignment[];
  targets: Target[];
  checkins: Checkin[];
};

export function SalesMonitorClient({
  viewDate,
  yesterdayDate,
  isToday,
  salesmen,
  beats,
  assignments,
  targets,
  checkins,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Server-state lookup maps (what's actually saved).
  const savedBeatMap = new Map(assignments.map(a => [a.salesman_id, a.beat_id]));
  const savedTargetMap = new Map(targets.map(t => [t.salesman_id, t.target_kg]));
  const checkinSet = new Set(checkins.map(c => c.salesman_id));

  // Local edit state (per-salesman) — null means "not edited, use saved value".
  const [beatEdits, setBeatEdits] = useState<Record<string, string>>({});
  const [targetEdits, setTargetEdits] = useState<Record<string, string>>({});
  const [flash, setFlash] = useState<Record<string, "saved" | "error">>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  function showFlash(key: string, kind: "saved" | "error", err?: string) {
    setFlash(prev => ({ ...prev, [key]: kind }));
    if (err) setErrors(prev => ({ ...prev, [key]: err }));
    setTimeout(() => {
      setFlash(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setErrors(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }, 3000);
  }

  function withBusy(key: string, fn: () => Promise<void>) {
    setBusy(prev => ({ ...prev, [key]: true }));
    return fn().finally(() => {
      setBusy(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    });
  }

  async function handleSaveBeat(salesmanId: string) {
    const beatId = beatEdits[salesmanId] ?? savedBeatMap.get(salesmanId) ?? "";
    const key = `beat-${salesmanId}`;
    if (!beatId) {
      // Empty selection → delete the assignment.
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
    await withBusy(key, async () => {
      const res = await saveAssignment(salesmanId, viewDate, beatId);
      if (res.ok) {
        showFlash(key, "saved");
        setBeatEdits(prev => { const n = { ...prev }; delete n[salesmanId]; return n; });
        startTransition(() => router.refresh());
      } else {
        showFlash(key, "error", res.error);
      }
    });
  }

  async function handleSaveTarget(salesmanId: string) {
    const raw = targetEdits[salesmanId] ?? savedTargetMap.get(salesmanId)?.toString() ?? "";
    const key = `target-${salesmanId}`;
    if (!raw.trim()) {
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
    const target = parseFloat(raw);
    if (!Number.isFinite(target) || target <= 0) {
      showFlash(key, "error", "Must be > 0");
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

  // Roll-up stats for the header
  const totalAssigned = assignments.length;
  const totalTargets = targets.length;
  const totalCheckedIn = checkins.length;

  return (
    <div className="max-w-5xl mx-auto p-4 lg:p-6">
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold leading-tight">Sales Monitor</h1>
          <p className="text-sm text-ink-muted mt-0.5">
            Daily beat assignments and kg targets.{" "}
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

      <div className="grid grid-cols-3 gap-3 mb-4">
        <Stat label="Beats assigned" value={`${totalAssigned} / ${salesmen.length}`} />
        <Stat label="Targets set" value={`${totalTargets} / ${salesmen.length}`} />
        <Stat label="Checked in today" value={isToday ? `${totalCheckedIn} / ${salesmen.length}` : "—"} muted={!isToday} />
      </div>

      <div className="border border-paper-line rounded overflow-hidden bg-paper-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-paper-subtle text-2xs uppercase tracking-wider text-ink-muted">
              <tr>
                <th className="text-left px-3 py-2.5 font-semibold">Salesman</th>
                <th className="text-left px-3 py-2.5 font-semibold">Beat for {isToday ? "today" : "this day"}</th>
                <th className="text-left px-3 py-2.5 font-semibold">Target (kg)</th>
                <th className="text-left px-3 py-2.5 font-semibold">Check-in</th>
              </tr>
            </thead>
            <tbody>
              {salesmen.map((s) => {
                const savedBeat = savedBeatMap.get(s.id) ?? "";
                const editedBeat = beatEdits[s.id];
                const beatValue = editedBeat !== undefined ? editedBeat : savedBeat;
                const beatDirty = editedBeat !== undefined && editedBeat !== savedBeat;

                const savedTarget = savedTargetMap.get(s.id);
                const savedTargetStr = savedTarget !== undefined ? savedTarget.toString() : "";
                const editedTarget = targetEdits[s.id];
                const targetValue = editedTarget !== undefined ? editedTarget : savedTargetStr;
                const targetDirty = editedTarget !== undefined && editedTarget !== savedTargetStr;

                const checkedIn = checkinSet.has(s.id);
                const beatKey = `beat-${s.id}`;
                const targetKey = `target-${s.id}`;

                return (
                  <tr key={s.id} className="border-t border-paper-line">
                    <td className="px-3 py-3 align-top">
                      <div className="font-medium">{s.name}</div>
                      {!s.phone && (
                        <div className="text-2xs text-amber-600 mt-0.5">
                          No phone — won't receive WhatsApp
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3 align-top">
                      <div className="flex items-center gap-2 flex-wrap">
                        <select
                          value={beatValue}
                          onChange={(e) => setBeatEdits(prev => ({ ...prev, [s.id]: e.target.value }))}
                          className="border border-paper-line rounded px-2 py-1.5 text-sm bg-paper-card min-w-[200px] focus:outline-none focus:border-accent"
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
                            onClick={() => handleSaveBeat(s.id)}
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
                          <span className="text-xs text-danger" title={errors[beatKey]}>
                            Failed
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <div className="flex items-center gap-2 flex-wrap">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={targetValue}
                          onChange={(e) => setTargetEdits(prev => ({ ...prev, [s.id]: e.target.value }))}
                          placeholder="0"
                          className="border border-paper-line rounded px-2 py-1.5 text-sm bg-paper-card w-24 focus:outline-none focus:border-accent"
                        />
                        {targetDirty && (
                          <button
                            onClick={() => handleSaveTarget(s.id)}
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
                      {!isToday ? (
                        <span className="text-xs text-ink-subtle">—</span>
                      ) : checkedIn ? (
                        <span className="inline-flex items-center gap-1 text-xs text-accent font-medium">
                          <Check size={12} /> Checked in
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-ink-subtle">
                          <AlertCircle size={12} /> Not yet
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {salesmen.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-12 text-center text-ink-subtle text-sm">
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
        <strong className="text-ink-muted">Phase 1 — manual config.</strong>{" "}
        WhatsApp delivery (morning briefing, 1 PM mid-day, 7:30 PM evening) ships in Phase 4 once WATi templates are
        approved by WhatsApp. Until then, you can set beats and targets here; reports will start flowing once Phase 4
        is live.
      </div>
    </div>
  );
}

function Stat({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="border border-paper-line rounded p-3 bg-paper-card">
      <div className="text-2xs uppercase tracking-wider text-ink-subtle">{label}</div>
      <div className={`text-lg font-semibold mt-0.5 ${muted ? "text-ink-subtle" : ""}`}>{value}</div>
    </div>
  );
}
