"use client";

import { useState, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Save, Loader2, Check, AlertCircle, RotateCcw, ChevronDown,
  ChevronRight, MapPin, Hash, Lock, PlayCircle, AlertTriangle,
} from "lucide-react";
import {
  computeDefaultShares,
  type BeatHist,
  type SavedBeatTarget,
  type SavedCustomerTarget,
} from "@/lib/sales-monitor/distribution";
import { saveDistribution, applyTargetsToSchedule } from "./actions";

type JC = {
  id: string;
  jc_number: number;
  start_date: string;
  end_date: string;
  days_count: number;
  fy_label: string;
};
type Area = { id: string; name: string };

type Props = {
  jc: JC;
  areas: Area[];
  selectedAreaId: string;
  beats: BeatHist[];
  areaTarget: number | null;
  beatTargetsRec: Record<string, SavedBeatTarget>;
  customerTargetsRec: Record<string, SavedCustomerTarget>;
};

export function DistributeClient({
  jc, areas, selectedAreaId, beats,
  areaTarget, beatTargetsRec, customerTargetsRec,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  // ---- Area target state ----
  const [areaTargetKg, setAreaTargetKg] = useState<string>(
    areaTarget != null ? String(areaTarget) : "",
  );

  // ---- Beat shares ----
  const defaultBeatShares = useMemo(
    () => computeDefaultShares(beats.map((b) => ({ id: b.id, kg_365d: b.kg_365d }))),
    [beats],
  );
  const [beatShares, setBeatShares] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    for (const b of beats) {
      const saved = beatTargetsRec[b.id];
      init[b.id] = saved ? saved.share_pct : defaultBeatShares.get(b.id) ?? 0;
    }
    return init;
  });
  const [beatManual, setBeatManual] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const b of beats) {
      init[b.id] = beatTargetsRec[b.id]?.is_manual ?? false;
    }
    return init;
  });

  // ---- Customer shares ----
  const defaultCustomerSharesByBeat = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    for (const b of beats) {
      map.set(
        b.id,
        computeDefaultShares(
          b.customers.map((c) => ({ id: c.id, kg_365d: c.kg_365d })),
        ),
      );
    }
    return map;
  }, [beats]);

  const [customerShares, setCustomerShares] = useState<Record<string, number>>(
    () => {
      const init: Record<string, number> = {};
      for (const b of beats) {
        const def = defaultCustomerSharesByBeat.get(b.id);
        for (const c of b.customers) {
          const saved = customerTargetsRec[c.id];
          init[c.id] = saved ? saved.share_pct : def?.get(c.id) ?? 0;
        }
      }
      return init;
    },
  );
  const [customerManual, setCustomerManual] = useState<Record<string, boolean>>(
    () => {
      const init: Record<string, boolean> = {};
      for (const b of beats) {
        for (const c of b.customers) {
          init[c.id] = customerTargetsRec[c.id]?.is_manual ?? false;
        }
      }
      return init;
    },
  );

  // ---- UI state ----
  const [expandedBeats, setExpandedBeats] = useState<Set<string>>(new Set());
  const [savingState, setSavingState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState("");

  const [applyState, setApplyState] = useState<"idle" | "applying" | "error">("idle");
  const [applyResult, setApplyResult] = useState<{ inserted: number; skipped: number; noTarget: number } | null>(null);
  const [applyError, setApplyError] = useState("");

  // ---- Computed values ----
  const areaTargetNum = parseFloat(areaTargetKg) || 0;
  const totalBeatShare = useMemo(
    () => beats.reduce((s, b) => s + (beatShares[b.id] ?? 0), 0),
    [beats, beatShares],
  );
  const beatShareOk = Math.abs(totalBeatShare - 100) < 0.01;

  function beatTargetKg(beatId: string): number {
    return (areaTargetNum * (beatShares[beatId] ?? 0)) / 100;
  }
  function customerTargetKg(beatId: string, customerId: string): number {
    return (beatTargetKg(beatId) * (customerShares[customerId] ?? 0)) / 100;
  }
  function beatCustomerShareTotal(beatId: string): number {
    const beat = beats.find((b) => b.id === beatId);
    if (!beat) return 0;
    return beat.customers.reduce(
      (s, c) => s + (customerShares[c.id] ?? 0),
      0,
    );
  }

  // ---- Handlers ----

  function setBeatShare(beatId: string, valueStr: string) {
    const v = parseFloat(valueStr);
    setBeatShares((prev) => ({ ...prev, [beatId]: Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 0 }));
    setBeatManual((prev) => ({ ...prev, [beatId]: true }));
    setSavingState("idle");
  }

  function setCustomerShare(customerId: string, valueStr: string) {
    const v = parseFloat(valueStr);
    setCustomerShares((prev) => ({ ...prev, [customerId]: Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 0 }));
    setCustomerManual((prev) => ({ ...prev, [customerId]: true }));
    setSavingState("idle");
  }

  function toggleBeatExpand(beatId: string) {
    setExpandedBeats((prev) => {
      const next = new Set(prev);
      if (next.has(beatId)) next.delete(beatId);
      else next.add(beatId);
      return next;
    });
  }

  function resetBeatsToDefault() {
    if (!confirm("Reset all beat shares to historical defaults? Manual overrides will be lost.")) return;
    const reset: Record<string, number> = {};
    const manualReset: Record<string, boolean> = {};
    for (const b of beats) {
      reset[b.id] = defaultBeatShares.get(b.id) ?? 0;
      manualReset[b.id] = false;
    }
    setBeatShares(reset);
    setBeatManual(manualReset);
    setSavingState("idle");
  }

  function resetCustomersToDefault(beatId: string) {
    const beat = beats.find((b) => b.id === beatId);
    if (!beat) return;
    if (!confirm(`Reset customer shares in "${beat.name}" to historical defaults?`)) return;
    const def = defaultCustomerSharesByBeat.get(beatId);
    setCustomerShares((prev) => {
      const next = { ...prev };
      for (const c of beat.customers) next[c.id] = def?.get(c.id) ?? 0;
      return next;
    });
    setCustomerManual((prev) => {
      const next = { ...prev };
      for (const c of beat.customers) next[c.id] = false;
      return next;
    });
    setSavingState("idle");
  }

  function autoBalanceBeats() {
    if (!confirm("Auto-balance: scale all beat shares proportionally so they sum to exactly 100%.")) return;
    const total = totalBeatShare;
    if (total <= 0) return;
    setBeatShares((prev) => {
      const next: Record<string, number> = {};
      for (const k of Object.keys(prev)) {
        next[k] = (prev[k] / total) * 100;
      }
      return next;
    });
  }

  function autoBalanceCustomers(beatId: string) {
    const beat = beats.find((b) => b.id === beatId);
    if (!beat) return;
    const total = beatCustomerShareTotal(beatId);
    if (total <= 0) return;
    setCustomerShares((prev) => {
      const next = { ...prev };
      for (const c of beat.customers) {
        next[c.id] = ((prev[c.id] ?? 0) / total) * 100;
      }
      return next;
    });
  }

  async function handleSave() {
    if (areaTargetNum < 0) {
      setSavingState("error");
      setSaveError("Area target must be non-negative");
      return;
    }
    if (!beatShareOk) {
      setSavingState("error");
      setSaveError(`Beat shares total ${totalBeatShare.toFixed(2)}% (must be 100%). Use Auto-balance.`);
      return;
    }
    setSavingState("saving");
    setSaveError("");
    try {
      const beatTargetsPayload: SavedBeatTarget[] = beats.map((b) => ({
        beat_id: b.id,
        share_pct: beatShares[b.id] ?? 0,
        target_kg: beatTargetKg(b.id),
        is_manual: beatManual[b.id] ?? false,
      }));
      const customerTargetsPayload: SavedCustomerTarget[] = [];
      for (const b of beats) {
        for (const c of b.customers) {
          customerTargetsPayload.push({
            customer_id: c.id,
            share_pct: customerShares[c.id] ?? 0,
            target_kg: customerTargetKg(b.id, c.id),
            is_manual: customerManual[c.id] ?? false,
          });
        }
      }
      const res = await saveDistribution({
        jcId: jc.id,
        areaId: selectedAreaId,
        areaTargetKg: areaTargetNum,
        beatTargets: beatTargetsPayload,
        customerTargets: customerTargetsPayload,
      });
      if (res.ok) {
        setSavingState("saved");
        startTransition(() => router.refresh());
        setTimeout(() => setSavingState("idle"), 2500);
      } else {
        setSavingState("error");
        setSaveError(res.error || "Save failed");
      }
    } catch (e) {
      setSavingState("error");
      setSaveError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleApply(mode: "skip-existing" | "force") {
    const msg = mode === "force"
      ? `Apply JC ${jc.jc_number} targets to the daily schedule (${fmtDate(jc.start_date)} → ${fmtDate(jc.end_date)})?\n\nFORCE mode OVERWRITES existing daily target_kg values — including manual edits — in this date range.\n\nProceed only if you want a clean slate from JC targets.`
      : `Apply JC ${jc.jc_number} targets to the daily schedule (${fmtDate(jc.start_date)} → ${fmtDate(jc.end_date)})?\n\nFor each date a salesman is assigned to a beat, their daily target_kg = that beat's JC target.\n\nExisting daily targets will be SKIPPED (manual overrides preserved).`;
    if (!confirm(msg)) return;

    setApplyState("applying");
    setApplyError("");
    setApplyResult(null);
    try {
      const r = await applyTargetsToSchedule(jc.id, mode);
      if (r.ok) {
        setApplyResult({ inserted: r.inserted, skipped: r.skipped, noTarget: r.noTarget });
        setApplyState("idle");
      } else {
        setApplyState("error");
        setApplyError(r.error || "Apply failed");
      }
    } catch (e) {
      setApplyState("error");
      setApplyError(e instanceof Error ? e.message : String(e));
    }
  }

  function changeArea(newAreaId: string) {
    router.push(`/sales-monitor/journey-cycles/${jc.id}/distribute?area=${newAreaId}`);
  }

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-3">
      <Link href={`/sales-monitor/journey-cycles/${jc.id}`}
        className="inline-flex items-center gap-1 text-xs text-ink-muted hover:underline">
        <ArrowLeft size={12}/> Back to JC {jc.jc_number} plan
      </Link>

      <div className="border border-paper-line rounded bg-paper-card overflow-hidden">
        <div className="px-3 py-2.5 border-b border-paper-line bg-paper-subtle/40">
          <div className="text-lg font-semibold">
            Distribute Targets — JC {jc.jc_number}
          </div>
          <div className="text-sm text-ink-muted">
            {fmtDate(jc.start_date)} → {fmtDate(jc.end_date)} · {jc.days_count} days
          </div>
        </div>

        {/* Area picker + target input */}
        <div className="px-3 py-3 border-b border-paper-line flex flex-wrap items-end gap-3">
          <div>
            <label className="text-2xs uppercase text-ink-muted font-medium block mb-1">Area</label>
            <select
              value={selectedAreaId}
              onChange={(e) => changeArea(e.target.value)}
              className="text-sm border border-paper-line rounded px-2 py-1.5 bg-white min-w-[160px]"
            >
              {areas.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-[140px]">
            <label className="text-2xs uppercase text-ink-muted font-medium block mb-1">
              Area target (kg for JC {jc.jc_number})
            </label>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={areaTargetKg}
              onChange={(e) => { setAreaTargetKg(e.target.value); setSavingState("idle"); }}
              placeholder="e.g. 25000"
              className="text-sm border border-paper-line rounded px-2 py-1.5 bg-white w-full"
            />
          </div>
          <div className="flex items-center gap-2">
            {savingState === "saved" && (
              <span className="text-2xs text-accent flex items-center gap-1">
                <Check size={11}/> Saved
              </span>
            )}
            <button
              onClick={handleSave}
              disabled={savingState === "saving"}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 bg-accent text-white rounded hover:bg-accent/90 disabled:opacity-50"
            >
              {savingState === "saving" ? (
                <><Loader2 size={12} className="animate-spin"/> Saving…</>
              ) : (
                <><Save size={12}/> Save distribution</>
              )}
            </button>
          </div>
        </div>

        {/* Apply-to-schedule bar */}
        <div className="px-3 py-2 border-b border-paper-line bg-paper-subtle/30 flex flex-wrap items-center gap-2">
          <div className="text-2xs text-ink-muted">
            <span className="uppercase font-medium">Apply targets to daily schedule</span>
            <span className="ml-1">— sets target_kg for every (salesman, date) in this JC where a beat is assigned</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => handleApply("skip-existing")}
              disabled={applyState === "applying"}
              className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 bg-accent text-white rounded hover:bg-accent/90 disabled:opacity-50"
            >
              {applyState === "applying" ? (
                <Loader2 size={12} className="animate-spin"/>
              ) : (
                <PlayCircle size={12}/>
              )}
              Apply to schedule
            </button>
            <button
              onClick={() => handleApply("force")}
              disabled={applyState === "applying"}
              className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-danger text-danger rounded hover:bg-danger/10 disabled:opacity-50"
              title="Overwrites existing daily targets — including manual edits"
            >
              <AlertTriangle size={12}/> Force re-apply
            </button>
          </div>
        </div>

        {savingState === "error" && (
          <div className="px-3 py-2 text-2xs text-danger bg-danger/5 border-b border-paper-line">
            <AlertCircle size={11} className="inline mr-1"/> {saveError}
          </div>
        )}
        {applyState === "error" && (
          <div className="px-3 py-2 text-2xs text-danger bg-danger/5 border-b border-paper-line">
            <AlertCircle size={11} className="inline mr-1"/> {applyError}
          </div>
        )}
        {applyResult && (
          <div className="px-3 py-2 text-2xs text-accent bg-accent/5 border-b border-paper-line">
            <Check size={11} className="inline mr-1"/>
            Applied — {applyResult.inserted} inserted, {applyResult.skipped} skipped
            {applyResult.noTarget > 0 && `, ${applyResult.noTarget} skipped due to missing beat target`}.
          </div>
        )}

        {/* Beat shares header */}
        <div className="px-3 py-2 border-b border-paper-line bg-paper-subtle/20 flex flex-wrap items-center gap-2 text-2xs">
          <span className="font-medium text-ink-muted uppercase">Beats ({beats.length})</span>
          <span className={beatShareOk ? "text-accent font-medium" : "text-danger font-medium"}>
            Total share: {totalBeatShare.toFixed(2)}%
            {!beatShareOk && " (must = 100%)"}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={resetBeatsToDefault}
              className="inline-flex items-center gap-1 px-2 py-1 border border-paper-line rounded hover:bg-paper-subtle"
              title="Reset all beat shares to historical defaults"
            >
              <RotateCcw size={10}/> Reset to historical
            </button>
            <button
              onClick={autoBalanceBeats}
              disabled={beatShareOk}
              className="inline-flex items-center gap-1 px-2 py-1 border border-paper-line rounded hover:bg-paper-subtle disabled:opacity-40"
              title="Scale all shares proportionally so total = 100%"
            >
              <Hash size={10}/> Auto-balance
            </button>
          </div>
        </div>

        {/* Beat list */}
        {beats.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-ink-muted">
            This area has no beats. Assign beats to it via{" "}
            <Link href="/beats/manage-areas" className="underline">Manage areas</Link>.
          </div>
        ) : (
          <div className="divide-y divide-paper-line">
            {beats.map((b) => {
              const expanded = expandedBeats.has(b.id);
              const share = beatShares[b.id] ?? 0;
              const target = beatTargetKg(b.id);
              const isManual = beatManual[b.id];
              const custTotal = beatCustomerShareTotal(b.id);
              const custOk = Math.abs(custTotal - 100) < 0.01;

              return (
                <div key={b.id} className="bg-paper-card">
                  <div className="px-3 py-2 flex items-center gap-2 flex-wrap">
                    <button
                      onClick={() => toggleBeatExpand(b.id)}
                      className="p-0.5 text-ink-subtle hover:text-ink"
                      aria-label={expanded ? "Collapse" : "Expand"}
                    >
                      {expanded ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
                    </button>
                    <div className="flex-1 min-w-[120px]">
                      <div className="text-sm font-medium flex items-center gap-1">
                        <MapPin size={11} className="text-ink-subtle"/>
                        {b.name}
                        {isManual && (
                          <span title="Manually overridden share">
                            <Lock size={9} className="text-warn"/>
                          </span>
                        )}
                      </div>
                      <div className="text-2xs text-ink-subtle">
                        Hist: {b.kg_365d.toLocaleString("en-IN")} kg / 365d · {b.customers.length} customer{b.customers.length === 1 ? "" : "s"}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0" max="100" step="any"
                        value={share.toFixed(2)}
                        onChange={(e) => setBeatShare(b.id, e.target.value)}
                        className="text-xs border border-paper-line rounded px-1.5 py-1 bg-white w-20 text-right tabular"
                      />
                      <span className="text-2xs text-ink-subtle">%</span>
                    </div>
                    <div className="text-right min-w-[80px]">
                      <div className="text-sm font-semibold tabular">
                        {target.toLocaleString("en-IN", { maximumFractionDigits: 1 })} <span className="text-2xs font-normal text-ink-subtle">kg</span>
                      </div>
                      <div className="text-2xs text-ink-subtle">target</div>
                    </div>
                  </div>

                  {expanded && b.customers.length > 0 && (
                    <div className="px-3 pb-3 pt-1 border-t border-paper-line/60 bg-paper-subtle/20">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-2xs text-ink-muted uppercase">
                          Customers in beat — total share: {" "}
                          <span className={custOk ? "text-accent font-medium" : "text-warn font-medium"}>
                            {custTotal.toFixed(2)}%
                          </span>
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => resetCustomersToDefault(b.id)}
                            className="inline-flex items-center gap-1 text-2xs px-2 py-0.5 border border-paper-line rounded hover:bg-paper-card"
                          >
                            <RotateCcw size={9}/> Reset
                          </button>
                          <button
                            onClick={() => autoBalanceCustomers(b.id)}
                            disabled={custOk}
                            className="inline-flex items-center gap-1 text-2xs px-2 py-0.5 border border-paper-line rounded hover:bg-paper-card disabled:opacity-40"
                          >
                            <Hash size={9}/> Balance
                          </button>
                        </div>
                      </div>
                      <div className="divide-y divide-paper-line/40 border border-paper-line/60 rounded bg-paper-card">
                        {b.customers.map((c) => {
                          const cShare = customerShares[c.id] ?? 0;
                          const cTarget = customerTargetKg(b.id, c.id);
                          const cManual = customerManual[c.id];
                          return (
                            <div key={c.id} className="px-2 py-1.5 flex items-center gap-2 text-xs">
                              <div className="flex-1 min-w-0">
                                <div className="font-medium truncate flex items-center gap-1">
                                  {c.name}
                                  {cManual && (
                                    <span title="Manually overridden share">
                                      <Lock size={8} className="text-warn"/>
                                    </span>
                                  )}
                                </div>
                                <div className="text-2xs text-ink-subtle">
                                  Hist: {c.kg_365d.toLocaleString("en-IN")} kg / 365d
                                </div>
                              </div>
                              <div className="flex items-center gap-1">
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  min="0" max="100" step="any"
                                  value={cShare.toFixed(2)}
                                  onChange={(e) => setCustomerShare(c.id, e.target.value)}
                                  className="text-2xs border border-paper-line rounded px-1.5 py-0.5 bg-white w-16 text-right tabular"
                                />
                                <span className="text-2xs text-ink-subtle">%</span>
                              </div>
                              <div className="text-right min-w-[60px] tabular text-2xs">
                                {cTarget.toLocaleString("en-IN", { maximumFractionDigits: 1 })} kg
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <p className="text-2xs text-ink-subtle">
        Defaults computed from last 365 days. Beats/customers with zero history
        get an equal share (treated as average-performing). Edit any cell to
        override; manual overrides are flagged with a lock icon and preserved
        on save. <strong>Apply to schedule</strong> uses the saved beat targets
        — save your distribution before applying.
      </p>
    </div>
  );
}

function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });
}
