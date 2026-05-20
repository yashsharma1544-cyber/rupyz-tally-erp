"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { Target, Loader2, RotateCcw, Check, AlertCircle, Save } from "lucide-react";
import { loadAllocation, saveAllocation, type AllocationRow } from "./target-actions";

type Cycle = { id: string; jc_number: number; start_date: string; end_date: string };

function fmtKg(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0";
  return n.toLocaleString("en-IN", { maximumFractionDigits: 1 });
}
function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" });
}

export function BeatTargetAllocator({
  beatId,
  beatName,
  cycles,
  windowMonths = 12,
}: {
  beatId: string;
  beatName: string;
  cycles: Cycle[];
  windowMonths?: number;
}) {
  const [cycleId, setCycleId] = useState<string>(cycles[0]?.id ?? "");
  const [targetKg, setTargetKg] = useState<string>("");
  const [rows, setRows] = useState<AllocationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const load = useCallback(async (cid: string) => {
    if (!cid) return;
    setLoading(true);
    setMsg(null);
    try {
      const res = await loadAllocation(cid, beatId, windowMonths);
      if ("error" in res) {
        setMsg({ kind: "err", text: res.error });
        setRows([]);
      } else {
        setRows(res.rows);
        setTargetKg(res.targetKg ? String(res.targetKg) : "");
        setSaved(res.saved);
      }
    } finally {
      setLoading(false);
    }
  }, [beatId, windowMonths]);

  useEffect(() => {
    if (cycleId) load(cycleId);
  }, [cycleId, load]);

  const target = parseFloat(targetKg) || 0;

  const totalSharePct = useMemo(
    () => rows.reduce((s, r) => s + (Number.isFinite(r.share_pct) ? r.share_pct : 0), 0),
    [rows],
  );
  const totalAllocatedKg = useMemo(
    () => rows.reduce((s, r) => s + (target * (r.share_pct || 0)) / 100, 0),
    [rows, target],
  );

  function updateShare(customerId: string, value: string) {
    const pct = value === "" ? 0 : parseFloat(value);
    setRows((prev) =>
      prev.map((r) => (r.customer_id === customerId ? { ...r, share_pct: Number.isFinite(pct) ? pct : 0 } : r)),
    );
  }

  function autoFillFromHistory() {
    const totalHist = rows.reduce((s, r) => s + r.hist_kg, 0);
    setRows((prev) =>
      prev.map((r) => ({
        ...r,
        share_pct: totalHist > 0 ? Math.round((100 * r.hist_kg / totalHist) * 10000) / 10000 : 0,
      })),
    );
    setMsg({ kind: "ok", text: "Re-filled shares from 12-month history" });
  }

  function distributeEvenly() {
    const n = rows.length;
    if (n === 0) return;
    const even = Math.round((100 / n) * 10000) / 10000;
    setRows((prev) => prev.map((r) => ({ ...r, share_pct: even })));
    setMsg({ kind: "ok", text: "Distributed evenly across customers" });
  }

  async function handleSave() {
    if (!cycleId) {
      setMsg({ kind: "err", text: "Pick a journey cycle first" });
      return;
    }
    if (target <= 0) {
      setMsg({ kind: "err", text: "Enter a beat target in kg" });
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const res = await saveAllocation({
        journeyCycleId: cycleId,
        beatId,
        targetKg: target,
        windowMonths,
        allocations: rows.map((r) => ({
          customer_id: r.customer_id,
          share_pct: r.share_pct,
          hist_kg: r.hist_kg,
        })),
      });
      if ("error" in res) {
        setMsg({ kind: "err", text: res.error });
      } else {
        setSaved(true);
        setMsg({ kind: "ok", text: `Saved — ${fmtKg(res.allocatedKg)} kg allocated across ${res.count} customers` });
      }
    } finally {
      setSaving(false);
    }
  }

  const shareWarn = Math.abs(totalSharePct - 100) > 0.5;

  return (
    <div className="bg-paper-card border border-paper-line rounded-md overflow-hidden">
      <div className="px-4 py-3 border-b border-paper-line bg-paper-subtle/40 flex items-center gap-2">
        <Target size={15} className="text-accent" />
        <h3 className="text-sm font-semibold">Cycle target allocation</h3>
        {saved && (
          <span className="ml-auto text-2xs text-ok inline-flex items-center gap-1">
            <Check size={11} /> saved for this cycle
          </span>
        )}
      </div>

      <div className="p-4 space-y-4">
        {/* Controls */}
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-2xs uppercase tracking-wide text-ink-muted mb-1">Journey cycle</label>
            <select
              value={cycleId}
              onChange={(e) => setCycleId(e.target.value)}
              className="border border-paper-line rounded px-2 py-1.5 text-sm bg-paper-card min-w-[200px] focus:outline-none focus:border-accent"
            >
              {cycles.length === 0 && <option value="">No cycles found</option>}
              {cycles.map((c) => (
                <option key={c.id} value={c.id}>
                  JC #{c.jc_number} · {fmtDate(c.start_date)}–{fmtDate(c.end_date)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-2xs uppercase tracking-wide text-ink-muted mb-1">Beat target (kg)</label>
            <input
              type="number"
              min="0"
              step="1"
              value={targetKg}
              onChange={(e) => setTargetKg(e.target.value)}
              placeholder="e.g. 5000"
              className="border border-paper-line rounded px-2 py-1.5 text-sm bg-paper-card w-32 tabular focus:outline-none focus:border-accent"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={autoFillFromHistory}
              disabled={loading || rows.length === 0}
              className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 border border-paper-line rounded hover:bg-paper-subtle disabled:opacity-50"
            >
              <RotateCcw size={12} /> Auto-fill %
            </button>
            <button
              onClick={distributeEvenly}
              disabled={loading || rows.length === 0}
              className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 border border-paper-line rounded hover:bg-paper-subtle disabled:opacity-50"
            >
              Even split
            </button>
          </div>
        </div>

        {/* Running totals */}
        <div className="flex flex-wrap items-center gap-4 text-xs bg-paper-subtle/40 border border-paper-line rounded px-3 py-2">
          <span>
            Allocated:{" "}
            <strong className="tabular text-ink">{fmtKg(totalAllocatedKg)}</strong>
            <span className="text-ink-subtle"> / {fmtKg(target)} kg</span>
          </span>
          <span className={shareWarn ? "text-warn" : "text-ok"}>
            Shares total:{" "}
            <strong className="tabular">{totalSharePct.toLocaleString("en-IN", { maximumFractionDigits: 2 })}%</strong>
            {shareWarn && <span className="ml-1">(should be ~100%)</span>}
          </span>
          <span className="text-ink-subtle ml-auto">{rows.length} customers · 12-month history</span>
        </div>

        {msg && (
          <div className={`flex items-start gap-2 text-xs rounded px-3 py-2 border ${
            msg.kind === "ok" ? "bg-ok-soft/40 border-ok/40 text-ok" : "bg-danger-soft/40 border-danger/40 text-danger"
          }`}>
            {msg.kind === "ok" ? <Check size={13} className="mt-0.5 shrink-0" /> : <AlertCircle size={13} className="mt-0.5 shrink-0" />}
            <span>{msg.text}</span>
          </div>
        )}

        {/* Table */}
        <div className="border border-paper-line rounded overflow-hidden">
          <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead className="bg-paper-subtle/60 border-b border-paper-line sticky top-0">
                <tr className="text-left text-2xs uppercase tracking-wide text-ink-muted">
                  <th className="px-3 py-2 font-medium">Customer</th>
                  <th className="px-3 py-2 font-medium text-right">12-mo kg</th>
                  <th className="px-3 py-2 font-medium text-right">Share %</th>
                  <th className="px-3 py-2 font-medium text-right">Target kg</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-paper-line">
                {loading ? (
                  <tr><td colSpan={4} className="px-3 py-8 text-center text-ink-muted">
                    <Loader2 size={16} className="animate-spin inline" /> Loading…
                  </td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={4} className="px-3 py-8 text-center text-ink-muted">No active customers on this beat.</td></tr>
                ) : (
                  rows.map((r) => {
                    const allocated = (target * (r.share_pct || 0)) / 100;
                    return (
                      <tr key={r.customer_id} className="hover:bg-paper-subtle/40">
                        <td className="px-3 py-2">
                          <div className="font-medium">{r.customer_name}</div>
                          {r.city && <div className="text-2xs text-ink-subtle">{r.city}</div>}
                        </td>
                        <td className="px-3 py-2 text-right tabular text-ink-muted">{fmtKg(r.hist_kg)}</td>
                        <td className="px-3 py-2 text-right">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={r.share_pct === 0 ? "" : r.share_pct}
                            onChange={(e) => updateShare(r.customer_id, e.target.value)}
                            placeholder="0"
                            className="border border-paper-line rounded px-2 py-1 text-sm bg-paper-card w-20 text-right tabular focus:outline-none focus:border-accent"
                          />
                        </td>
                        <td className="px-3 py-2 text-right tabular font-semibold">{fmtKg(allocated)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving || loading || !cycleId || target <= 0}
            className="inline-flex items-center gap-1.5 text-sm px-4 py-2 bg-accent text-white rounded hover:bg-accent/90 disabled:opacity-50 transition-colors"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {saving ? "Saving…" : "Save allocation"}
          </button>
        </div>
      </div>
    </div>
  );
}
