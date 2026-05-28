"use client";

import { useState } from "react";
import {
  previewAreaTargets,
  saveAreaTargets,
  previewOrgTargets,
  saveOrgTargets,
  type AreaPreview,
  type OrgPreview,
  type OrgAreaNode,
  type BeatNode,
} from "./targets-actions";

type JC = { id: string; jc_number: number; start_date: string; end_date: string };
type Area = { id: string; name: string };
type Mode = "org" | "area";

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
  const [mode, setMode] = useState<Mode>("org");
  const [jcId, setJcId] = useState<string>(currentJcId ?? jcs[0]?.id ?? "");

  // Area mode state
  const [areaId, setAreaId] = useState<string>(areas[0]?.id ?? "");
  const [areaKg, setAreaKg] = useState<string>("");
  const [preview, setPreview] = useState<AreaPreview | null>(null);

  // Org mode state
  const [orgKg, setOrgKg] = useState<string>("");
  const [orgPreview, setOrgPreview] = useState<OrgPreview | null>(null);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [openAreas, setOpenAreas] = useState<Set<string>>(new Set());

  const jcLabel = (j: JC) => `JC ${j.jc_number} (${j.start_date.slice(5)} \u2192 ${j.end_date.slice(5)})`;

  function switchMode(m: Mode) {
    setMode(m);
    setMsg(null);
    setPreview(null);
    setOrgPreview(null);
  }

  // ---- Area mode --------------------------------------------------------
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
    setPreview({ ...preview, beats: applyBeatKg(preview.beats, beatId, value) });
  }
  function setCustKg(beatId: string, custId: string, value: string) {
    if (!preview) return;
    setPreview({ ...preview, beats: applyCustKg(preview.beats, beatId, custId, value) });
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

  // ---- Org mode ---------------------------------------------------------
  async function runOrgPreview() {
    setMsg(null);
    const kg = parseFloat(orgKg);
    if (!jcId || !(kg >= 0)) {
      setMsg({ kind: "err", text: "Pick a JC and enter an organisation target (kg)." });
      return;
    }
    setLoading(true);
    const res = await previewOrgTargets(jcId, kg);
    setLoading(false);
    if ("error" in res) {
      setMsg({ kind: "err", text: res.error });
      setOrgPreview(null);
    } else {
      setOrgPreview(res);
      setOpenAreas(new Set());
      setOpen(new Set());
    }
  }

  function setAreaTarget(areaId2: string, value: string) {
    if (!orgPreview) return;
    const v = parseFloat(value);
    const newAreaKg = isNaN(v) ? 0 : v;
    setOrgPreview({
      ...orgPreview,
      areas: orgPreview.areas.map((a) => {
        if (a.area_id !== areaId2) return a;
        const beats = a.beats.map((b) => {
          const newBeatKg = round2((b.share_pct / 100) * newAreaKg);
          const customers = b.customers.map((c) => ({
            ...c,
            target_kg: round2((c.share_pct / 100) * newBeatKg),
            is_manual: false,
          }));
          return { ...b, target_kg: newBeatKg, is_manual: false, customers };
        });
        return { ...a, target_kg: newAreaKg, is_manual: true, beats };
      }),
    });
  }

  function setOrgBeatKg(areaId2: string, beatId: string, value: string) {
    if (!orgPreview) return;
    setOrgPreview({
      ...orgPreview,
      areas: orgPreview.areas.map((a) =>
        a.area_id === areaId2 ? { ...a, beats: applyBeatKg(a.beats, beatId, value) } : a,
      ),
    });
  }
  function setOrgCustKg(areaId2: string, beatId: string, custId: string, value: string) {
    if (!orgPreview) return;
    setOrgPreview({
      ...orgPreview,
      areas: orgPreview.areas.map((a) =>
        a.area_id === areaId2 ? { ...a, beats: applyCustKg(a.beats, beatId, custId, value) } : a,
      ),
    });
  }

  async function runOrgSave() {
    if (!orgPreview) return;
    setSaving(true);
    setMsg(null);
    const res = await saveOrgTargets({
      jcId: orgPreview.jc_id,
      areas: orgPreview.areas.map((a) => ({
        areaId: a.area_id,
        areaKg: a.target_kg,
        beats: a.beats.map((b) => ({
          beat_id: b.beat_id,
          share_pct: b.share_pct,
          target_kg: b.target_kg,
          is_manual: b.is_manual,
        })),
        customers: a.beats.flatMap((b) =>
          b.customers.map((c) => ({
            beat_id: b.beat_id,
            customer_id: c.customer_id,
            target_kg: c.target_kg,
            is_manual: c.is_manual,
          })),
        ),
      })),
    });
    setSaving(false);
    if ("error" in res) setMsg({ kind: "err", text: res.error });
    else setMsg({ kind: "ok", text: `Targets saved (${res.savedAreas} areas).` });
  }

  // ---- shared toggles ---------------------------------------------------
  function toggle(beatId: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(beatId)) next.delete(beatId);
      else next.add(beatId);
      return next;
    });
  }
  function toggleArea(areaId2: string) {
    setOpenAreas((prev) => {
      const next = new Set(prev);
      if (next.has(areaId2)) next.delete(areaId2);
      else next.add(areaId2);
      return next;
    });
  }

  const beatTotal = preview ? preview.beats.reduce((a, b) => a + (Number(b.target_kg) || 0), 0) : 0;
  const orgAreaTotal = orgPreview ? orgPreview.areas.reduce((a, x) => a + (Number(x.target_kg) || 0), 0) : 0;

  return (
    <div className="space-y-5">
      {/* Mode toggle */}
      <div className="inline-flex rounded-md border border-paper-line overflow-hidden text-sm">
        <button
          onClick={() => switchMode("org")}
          className={`px-4 h-9 font-medium ${mode === "org" ? "bg-accent text-white" : "bg-paper-card text-ink-muted hover:bg-paper-subtle"}`}
        >
          By Organisation
        </button>
        <button
          onClick={() => switchMode("area")}
          className={`px-4 h-9 font-medium border-l border-paper-line ${mode === "area" ? "bg-accent text-white" : "bg-paper-card text-ink-muted hover:bg-paper-subtle"}`}
        >
          By Area
        </button>
      </div>

      {/* Controls */}
      <div className="bg-paper-card border border-paper-line rounded-md p-4">
        {mode === "area" ? (
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
            <label className="block">
              <span className="text-2xs uppercase tracking-wide text-ink-muted font-medium">Journey Cycle</span>
              <select value={jcId} onChange={(e) => setJcId(e.target.value)} className="mt-1 w-full h-9 px-2 rounded border border-paper-line bg-paper text-sm">
                {jcs.map((j) => <option key={j.id} value={j.id}>{jcLabel(j)}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-2xs uppercase tracking-wide text-ink-muted font-medium">Area</span>
              <select value={areaId} onChange={(e) => setAreaId(e.target.value)} className="mt-1 w-full h-9 px-2 rounded border border-paper-line bg-paper text-sm">
                {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-2xs uppercase tracking-wide text-ink-muted font-medium">Area target (kg)</span>
              <input type="number" inputMode="decimal" value={areaKg} onChange={(e) => setAreaKg(e.target.value)} placeholder="e.g. 100000" className="mt-1 w-full h-9 px-2 rounded border border-paper-line bg-paper text-sm tabular" />
            </label>
            <button onClick={runPreview} disabled={loading} className="h-9 px-4 rounded bg-accent text-white text-sm font-medium hover:bg-accent/90 disabled:opacity-50">
              {loading ? "Calculating\u2026" : "Preview cascade"}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
            <label className="block">
              <span className="text-2xs uppercase tracking-wide text-ink-muted font-medium">Journey Cycle</span>
              <select value={jcId} onChange={(e) => setJcId(e.target.value)} className="mt-1 w-full h-9 px-2 rounded border border-paper-line bg-paper text-sm">
                {jcs.map((j) => <option key={j.id} value={j.id}>{jcLabel(j)}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-2xs uppercase tracking-wide text-ink-muted font-medium">Organisation target (kg)</span>
              <input type="number" inputMode="decimal" value={orgKg} onChange={(e) => setOrgKg(e.target.value)} placeholder="e.g. 250000" className="mt-1 w-full h-9 px-2 rounded border border-paper-line bg-paper text-sm tabular" />
            </label>
            <button onClick={runOrgPreview} disabled={loading} className="h-9 px-4 rounded bg-accent text-white text-sm font-medium hover:bg-accent/90 disabled:opacity-50">
              {loading ? "Calculating\u2026" : "Preview cascade"}
            </button>
          </div>
        )}
        {msg && <div className={`mt-3 text-sm ${msg.kind === "ok" ? "text-ok" : "text-danger"}`}>{msg.text}</div>}
      </div>

      {/* Area-mode preview */}
      {mode === "area" && preview && (
        <div className="bg-paper-card border border-paper-line rounded-md overflow-hidden">
          <div className="px-4 py-3 border-b border-paper-line flex items-center justify-between flex-wrap gap-2">
            <div>
              <div className="font-semibold text-sm">{preview.area_name}</div>
              <div className="text-2xs text-ink-muted">
                Area target {fmtKg(preview.area_kg)} kg \u00b7 historical {fmtKg(preview.area_hist_kg)} kg \u00b7 beats sum {fmtKg(beatTotal)} kg
              </div>
            </div>
            <button onClick={runSave} disabled={saving} className="h-9 px-4 rounded bg-ok text-white text-sm font-medium hover:bg-ok/90 disabled:opacity-50">
              {saving ? "Saving\u2026" : "Save targets"}
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
                  <BeatRows key={b.beat_id} beat={b} isOpen={open.has(b.beat_id)} onToggle={() => toggle(b.beat_id)} onBeatKg={(v) => setBeatKg(b.beat_id, v)} onCustKg={(cid, v) => setCustKg(b.beat_id, cid, v)} />
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2.5 text-2xs text-ink-subtle border-t border-paper-line">
            Edit a beat&apos;s kg to override it (re-splits its customers by share). Edit a customer&apos;s kg to set it directly. Manual edits are flagged. Beat totals float \u2014 they don&apos;t force the area total.
          </div>
        </div>
      )}

      {/* Org-mode preview */}
      {mode === "org" && orgPreview && (
        <div className="bg-paper-card border border-paper-line rounded-md overflow-hidden">
          <div className="px-4 py-3 border-b border-paper-line flex items-center justify-between flex-wrap gap-2">
            <div>
              <div className="font-semibold text-sm">Sushil Agencies \u2014 organisation target</div>
              <div className="text-2xs text-ink-muted">
                Org target {fmtKg(orgPreview.org_kg)} kg \u00b7 historical {fmtKg(orgPreview.org_hist_kg)} kg \u00b7 areas sum {fmtKg(orgAreaTotal)} kg
              </div>
            </div>
            <button onClick={runOrgSave} disabled={saving} className="h-9 px-4 rounded bg-ok text-white text-sm font-medium hover:bg-ok/90 disabled:opacity-50">
              {saving ? "Saving\u2026" : "Save all targets"}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="bg-paper-subtle/60 border-b border-paper-line">
                <tr className="text-left text-2xs uppercase tracking-wide text-ink-muted">
                  <th className="px-3 py-2.5 font-medium">Area / Beat / Customer</th>
                  <th className="px-3 py-2.5 font-medium text-right">Hist kg</th>
                  <th className="px-3 py-2.5 font-medium text-right">Share %</th>
                  <th className="px-3 py-2.5 font-medium text-right w-40">Target kg</th>
                  <th className="px-3 py-2.5 font-medium w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-paper-line">
                {orgPreview.areas.map((a) => (
                  <AreaRows
                    key={a.area_id}
                    area={a}
                    isOpen={openAreas.has(a.area_id)}
                    onToggle={() => toggleArea(a.area_id)}
                    onAreaKg={(v) => setAreaTarget(a.area_id, v)}
                    openBeats={open}
                    onToggleBeat={toggle}
                    onBeatKg={(beatId, v) => setOrgBeatKg(a.area_id, beatId, v)}
                    onCustKg={(beatId, cid, v) => setOrgCustKg(a.area_id, beatId, cid, v)}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2.5 text-2xs text-ink-subtle border-t border-paper-line">
            Org target splits into areas by each area&apos;s share of total sales; each area then splits into beats and customers.
            Edit an area&apos;s kg to override it (re-splits its beats/customers). Manual edits are flagged. Totals float \u2014 overrides don&apos;t force the parent total.
          </div>
        </div>
      )}
    </div>
  );
}

// ---- pure helpers reused by both modes -------------------------------------

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function applyBeatKg(beats: BeatNode[], beatId: string, value: string): BeatNode[] {
  const v = parseFloat(value);
  const newBeatKg = isNaN(v) ? 0 : v;
  return beats.map((b) => {
    if (b.beat_id !== beatId) return b;
    const customers = b.customers.map((c) => ({
      ...c,
      target_kg: round2((c.share_pct / 100) * newBeatKg),
      is_manual: false,
    }));
    return { ...b, target_kg: newBeatKg, is_manual: true, customers };
  });
}

function applyCustKg(beats: BeatNode[], beatId: string, custId: string, value: string): BeatNode[] {
  const v = parseFloat(value);
  return beats.map((b) => {
    if (b.beat_id !== beatId) return b;
    return {
      ...b,
      customers: b.customers.map((c) =>
        c.customer_id === custId ? { ...c, target_kg: isNaN(v) ? 0 : v, is_manual: true } : c,
      ),
    };
  });
}

// ---- row components --------------------------------------------------------

function AreaRows({
  area,
  isOpen,
  onToggle,
  onAreaKg,
  openBeats,
  onToggleBeat,
  onBeatKg,
  onCustKg,
}: {
  area: OrgAreaNode;
  isOpen: boolean;
  onToggle: () => void;
  onAreaKg: (v: string) => void;
  openBeats: Set<string>;
  onToggleBeat: (beatId: string) => void;
  onBeatKg: (beatId: string, v: string) => void;
  onCustKg: (beatId: string, custId: string, v: string) => void;
}) {
  return (
    <>
      <tr className="bg-paper-subtle/30 hover:bg-paper-subtle/50 font-semibold">
        <td className="px-3 py-2.5">
          <button onClick={onToggle} className="inline-flex items-center gap-1.5 hover:text-accent">
            <span className={`transition-transform ${isOpen ? "rotate-90" : ""}`}>\u203a</span>
            {area.area_name}
          </button>
          {area.is_manual && <span className="ml-2 text-2xs text-warn font-medium">manual</span>}
          {area.hist_kg === 0 && <span className="ml-2 text-2xs text-ink-subtle">no history</span>}
        </td>
        <td className="px-3 py-2.5 text-right tabular text-ink-muted">{fmtKg(area.hist_kg)}</td>
        <td className="px-3 py-2.5 text-right tabular text-ink-muted">{area.share_pct.toFixed(1)}%</td>
        <td className="px-3 py-2.5 text-right">
          <input type="number" inputMode="decimal" value={area.target_kg} onChange={(e) => onAreaKg(e.target.value)} className="w-32 h-8 px-2 rounded border border-paper-line bg-paper text-sm text-right tabular font-semibold" />
        </td>
        <td className="px-3 py-2.5 text-center text-ink-subtle">{area.beats.length}</td>
      </tr>
      {isOpen &&
        area.beats.map((b) => (
          <BeatRows
            key={b.beat_id}
            beat={b}
            nested
            isOpen={openBeats.has(b.beat_id)}
            onToggle={() => onToggleBeat(b.beat_id)}
            onBeatKg={(v) => onBeatKg(b.beat_id, v)}
            onCustKg={(cid, v) => onCustKg(b.beat_id, cid, v)}
          />
        ))}
    </>
  );
}

function BeatRows({
  beat,
  isOpen,
  onToggle,
  onBeatKg,
  onCustKg,
  nested,
}: {
  beat: BeatNode;
  isOpen: boolean;
  onToggle: () => void;
  onBeatKg: (v: string) => void;
  onCustKg: (custId: string, v: string) => void;
  nested?: boolean;
}) {
  return (
    <>
      <tr className="hover:bg-paper-subtle/40">
        <td className={`px-3 py-2.5 ${nested ? "pl-8" : ""}`}>
          <button onClick={onToggle} className="inline-flex items-center gap-1.5 font-medium hover:text-accent">
            <span className={`transition-transform ${isOpen ? "rotate-90" : ""}`}>\u203a</span>
            {beat.beat_name}
          </button>
          {beat.is_manual && <span className="ml-2 text-2xs text-warn font-medium">manual</span>}
          {beat.hist_kg === 0 && <span className="ml-2 text-2xs text-ink-subtle">no history</span>}
        </td>
        <td className="px-3 py-2.5 text-right tabular text-ink-muted">{fmtKg(beat.hist_kg)}</td>
        <td className="px-3 py-2.5 text-right tabular text-ink-muted">{beat.share_pct.toFixed(1)}%</td>
        <td className="px-3 py-2.5 text-right">
          <input type="number" inputMode="decimal" value={beat.target_kg} onChange={(e) => onBeatKg(e.target.value)} className="w-32 h-8 px-2 rounded border border-paper-line bg-paper text-sm text-right tabular" />
        </td>
        <td className="px-3 py-2.5 text-center text-ink-subtle">{beat.customers.length}</td>
      </tr>
      {isOpen &&
        beat.customers.map((c) => (
          <tr key={c.customer_id} className="bg-paper-subtle/20">
            <td className={`px-3 py-2 ${nested ? "pl-14" : "pl-9"} text-ink-muted`}>
              {c.customer_name}
              {c.is_manual && <span className="ml-2 text-2xs text-warn">manual</span>}
            </td>
            <td className="px-3 py-2 text-right tabular text-ink-subtle text-xs">{fmtKg(c.hist_kg)}</td>
            <td className="px-3 py-2 text-right tabular text-ink-subtle text-xs">{c.share_pct.toFixed(1)}%</td>
            <td className="px-3 py-2 text-right">
              <input type="number" inputMode="decimal" value={c.target_kg} onChange={(e) => onCustKg(c.customer_id, e.target.value)} className="w-28 h-7 px-2 rounded border border-paper-line bg-paper text-xs text-right tabular" />
            </td>
            <td></td>
          </tr>
        ))}
    </>
  );
}
