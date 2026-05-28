"use client";

import { useState } from "react";
import { previewAreaTargets, saveAreaTargets, type AreaPreview, type BeatNode } from "./targets-actions";

type JC = { id: string; jc_number: number; start_date: string; end_date: string };
type Area = { id: string; name: string };

function fmtKg(n: number): string {
  return (Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 1 });
}

export function TargetsTab({
  jcs,
  areas,
  currentJcId,
}: {
  jcs: JC[];
  areas: Area[];
  currentJcId: string | null;
}) {
  const [jcId, setJcId] = useState<string>(currentJcId ?? jcs[0]?.id ?? "");
  const [areaId, setAreaId] = useState<string>(areas[0]?.id ?? "");
  const [areaKg, setAreaKg] = useState<string>("");
  const [preview, setPreview] = useState<AreaPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const jcLabel = (j: JC) => `JC ${j.jc_number} (${j.start_date.slice(5)} → ${j.end_date.slice(5)})`;

  async function runPreview() {
    setMsg(null);
    const kg = parseFloat(areaKg);
    if (!jcId || !areaId || !(kg >= 0)) {
      setMsg({ kind: "err", text: "Pick a JC + Area and enter a target (kg)." });
      return;
    }
    setLoading(true);
    const res = await previewAreaTargets(jcId, areaId, kg);
    setLoading(false);
    if ("error" in res) {
      setMsg({ kind: "err", text: res.error });
      setPreview(null);
    } else {
      setPreview(res);
      setOpen(new Set());
    }
  }

  function setBeatKg(beatId: string, value: string) {
    if (!preview) return;
    const v = parseFloat(value);
    setPreview({
      ...preview,
      beats: preview.beats.map((b) => {
        if (b.beat_id !== beatId) return b;
        const newBeatKg = isNaN(v) ? 0 : v;
        // Re-split this beat's customers by their share (no manual cust overrides kept on beat edit)
        const customers = b.customers.map((c) => ({
          ...c,
          target_kg: Math.round((c.share_pct / 100) * newBeatKg * 100) / 100,
          is_manual: false,
        }));
        return { ...b, target_kg: newBeatKg, is_manual: true, customers };
      }),
    });
  }

  function setCustKg(beatId: string, custId: string, value: string) {
    if (!preview) return;
    const v = parseFloat(value);
    setPreview({
      ...preview,
      beats: preview.beats.map((b) => {
        if (b.beat_id !== beatId) return b;
        return {
          ...b,
          customers: b.customers.map((c) =>
            c.customer_id === custId ? { ...c, target_kg: isNaN(v) ? 0 : v, is_manual: true } : c,
          ),
        };
      }),
    });
  }

  function toggle(beatId: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(beatId)) next.delete(beatId);
      else next.add(beatId);
      return next;
    });
  }

  async function runSave() {
    if (!preview) return;
    setSaving(true);
    setMsg(null);
    const res = await saveAreaTargets({
      jcId: preview.jc_id,
      areaId: preview.area_id,
      areaKg: preview.area_kg,
      beats: preview.beats.map((b) => ({
        beat_id: b.beat_id,
        share_pct: b.share_pct,
        target_kg: b.target_kg,
        is_manual: b.is_manual,
      })),
      customers: preview.beats.flatMap((b) =>
        b.customers.map((c) => ({
          beat_id: b.beat_id,
          customer_id: c.customer_id,
          target_kg: c.target_kg,
          is_manual: c.is_manual,
        })),
      ),
    });
    setSaving(false);
    if ("error" in res) setMsg({ kind: "err", text: res.error });
    else setMsg({ kind: "ok", text: "Targets saved." });
  }

  const beatTotal = preview ? preview.beats.reduce((a, b) => a + (Number(b.target_kg) || 0), 0) : 0;

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="bg-paper-card border border-paper-line rounded-md p-4">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <label className="block">
            <span className="text-2xs uppercase tracking-wide text-ink-muted font-medium">Journey Cycle</span>
            <select
              value={jcId}
              onChange={(e) => setJcId(e.target.value)}
              className="mt-1 w-full h-9 px-2 rounded border border-paper-line bg-paper text-sm"
            >
              {jcs.map((j) => (
                <option key={j.id} value={j.id}>{jcLabel(j)}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-2xs uppercase tracking-wide text-ink-muted font-medium">Area</span>
            <select
              value={areaId}
              onChange={(e) => setAreaId(e.target.value)}
              className="mt-1 w-full h-9 px-2 rounded border border-paper-line bg-paper text-sm"
            >
              {areas.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-2xs uppercase tracking-wide text-ink-muted font-medium">Area target (kg)</span>
            <input
              type="number"
              inputMode="decimal"
              value={areaKg}
              onChange={(e) => setAreaKg(e.target.value)}
              placeholder="e.g. 100000"
              className="mt-1 w-full h-9 px-2 rounded border border-paper-line bg-paper text-sm tabular"
            />
          </label>
          <button
            onClick={runPreview}
            disabled={loading}
            className="h-9 px-4 rounded bg-accent text-white text-sm font-medium hover:bg-accent/90 disabled:opacity-50"
          >
            {loading ? "Calculating…" : "Preview cascade"}
          </button>
        </div>
        {msg && (
          <div className={`mt-3 text-sm ${msg.kind === "ok" ? "text-ok" : "text-danger"}`}>{msg.text}</div>
        )}
      </div>

      {/* Preview */}
      {preview && (
        <div className="bg-paper-card border border-paper-line rounded-md overflow-hidden">
          <div className="px-4 py-3 border-b border-paper-line flex items-center justify-between flex-wrap gap-2">
            <div>
              <div className="font-semibold text-sm">{preview.area_name}</div>
              <div className="text-2xs text-ink-muted">
                Area target {fmtKg(preview.area_kg)} kg · historical {fmtKg(preview.area_hist_kg)} kg ·
                beats sum {fmtKg(beatTotal)} kg
              </div>
            </div>
            <button
              onClick={runSave}
              disabled={saving}
              className="h-9 px-4 rounded bg-ok text-white text-sm font-medium hover:bg-ok/90 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save targets"}
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="bg-paper-subtle/60 border-b border-paper-line">
                <tr className="text-left text-2xs uppercase tracking-wide text-ink-muted">
                  <th className="px-3 py-2.5 font-medium">Beat</th>
                  <th className="px-3 py-2.5 font-medium text-right">Hist kg</th>
                  <th className="px-3 py-2.5 font-medium text-right">Share %</th>
                  <th className="px-3 py-2.5 font-medium text-right w-40">Target kg</th>
                  <th className="px-3 py-2.5 font-medium w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-paper-line">
                {preview.beats.map((b) => (
                  <BeatRows
                    key={b.beat_id}
                    beat={b}
                    isOpen={open.has(b.beat_id)}
                    onToggle={() => toggle(b.beat_id)}
                    onBeatKg={(v) => setBeatKg(b.beat_id, v)}
                    onCustKg={(cid, v) => setCustKg(b.beat_id, cid, v)}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2.5 text-2xs text-ink-subtle border-t border-paper-line">
            Edit a beat&apos;s kg to override it (re-splits its customers by share). Edit a customer&apos;s kg to set it directly. Manual edits are flagged. Beat totals float — they don&apos;t force the area total.
          </div>
        </div>
      )}
    </div>
  );
}

function BeatRows({
  beat,
  isOpen,
  onToggle,
  onBeatKg,
  onCustKg,
}: {
  beat: BeatNode;
  isOpen: boolean;
  onToggle: () => void;
  onBeatKg: (v: string) => void;
  onCustKg: (custId: string, v: string) => void;
}) {
  return (
    <>
      <tr className="hover:bg-paper-subtle/40">
        <td className="px-3 py-2.5">
          <button onClick={onToggle} className="inline-flex items-center gap-1.5 font-medium hover:text-accent">
            <span className={`transition-transform ${isOpen ? "rotate-90" : ""}`}>›</span>
            {beat.beat_name}
          </button>
          {beat.is_manual && <span className="ml-2 text-2xs text-warn font-medium">manual</span>}
          {beat.hist_kg === 0 && <span className="ml-2 text-2xs text-ink-subtle">no history</span>}
        </td>
        <td className="px-3 py-2.5 text-right tabular text-ink-muted">{fmtKg(beat.hist_kg)}</td>
        <td className="px-3 py-2.5 text-right tabular text-ink-muted">{beat.share_pct.toFixed(1)}%</td>
        <td className="px-3 py-2.5 text-right">
          <input
            type="number"
            inputMode="decimal"
            value={beat.target_kg}
            onChange={(e) => onBeatKg(e.target.value)}
            className="w-32 h-8 px-2 rounded border border-paper-line bg-paper text-sm text-right tabular"
          />
        </td>
        <td className="px-3 py-2.5 text-center text-ink-subtle">{beat.customers.length}</td>
      </tr>
      {isOpen &&
        beat.customers.map((c) => (
          <tr key={c.customer_id} className="bg-paper-subtle/20">
            <td className="px-3 py-2 pl-9 text-ink-muted">
              {c.customer_name}
              {c.is_manual && <span className="ml-2 text-2xs text-warn">manual</span>}
            </td>
            <td className="px-3 py-2 text-right tabular text-ink-subtle text-xs">{fmtKg(c.hist_kg)}</td>
            <td className="px-3 py-2 text-right tabular text-ink-subtle text-xs">{c.share_pct.toFixed(1)}%</td>
            <td className="px-3 py-2 text-right">
              <input
                type="number"
                inputMode="decimal"
                value={c.target_kg}
                onChange={(e) => onCustKg(c.customer_id, e.target.value)}
                className="w-28 h-7 px-2 rounded border border-paper-line bg-paper text-xs text-right tabular"
              />
            </td>
            <td></td>
          </tr>
        ))}
    </>
  );
}
