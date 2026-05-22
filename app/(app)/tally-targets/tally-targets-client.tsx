"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import {
  Target, Loader2, RotateCcw, Check, AlertCircle, Save, RefreshCw, MapPin, Building2,
} from "lucide-react";
import {
  loadTallyAllocation, saveTallyAllocation, type TallyAllocRow,
} from "./tally-target-actions";

type Group = { company: string; party_group: string; root_group: string; parties: number; total_kg: number };
type Company = { company: string; rows: number; total_kg: number };

function fmtKg(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0";
  return n.toLocaleString("en-IN", { maximumFractionDigits: 1 });
}

export function TallyTargetsClient({
  partyGroups, companies, salesRowCount,
}: {
  partyGroups: Group[];
  companies: Company[];
  salesRowCount: number;
}) {
  const [company, setCompany] = useState<string>(companies[0]?.company ?? "");
  const [groupName, setGroupName] = useState<string>("");
  const [period, setPeriod] = useState<string>(defaultPeriod());
  const [targetKg, setTargetKg] = useState<string>("");
  const [rows, setRows] = useState<TallyAllocRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [rowCount, setRowCount] = useState(salesRowCount);

  const companyGroups = useMemo(
    () => partyGroups.filter((g) => g.company === company),
    [partyGroups, company],
  );

  // reset beat when company changes
  useEffect(() => { setGroupName(""); setRows([]); setTargetKg(""); }, [company]);

  const basisYearFor = (co: string) => (co.startsWith("Sushil") ? "26-27" : "25-26");

  const load = useCallback(async (co: string, g: string, p: string) => {
    if (!co || !g || !p) return;
    setLoading(true); setMsg(null);
    try {
      const res = await loadTallyAllocation(co, g, p, basisYearFor(co));
      if ("error" in res) { setMsg({ kind: "err", text: res.error }); setRows([]); }
      else { setRows(res.rows); setTargetKg(res.targetKg ? String(res.targetKg) : ""); setSaved(res.saved); }
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (company && groupName && period) load(company, groupName, period); }, [company, groupName, period, load]);

  const target = parseFloat(targetKg) || 0;
  const totalShare = useMemo(() => rows.reduce((s, r) => s + (r.share_pct || 0), 0), [rows]);
  const totalAlloc = useMemo(() => rows.reduce((s, r) => s + target * (r.share_pct || 0) / 100, 0), [rows, target]);

  function updateShare(party: string, v: string) {
    const pct = v === "" ? 0 : parseFloat(v);
    setRows((prev) => prev.map((r) => r.party_name === party ? { ...r, share_pct: Number.isFinite(pct) ? pct : 0 } : r));
  }
  function autoFill() {
    const tot = rows.reduce((s, r) => s + r.basis_kg, 0);
    setRows((prev) => prev.map((r) => ({ ...r, share_pct: tot > 0 ? Math.round(100 * r.basis_kg / tot * 10000) / 10000 : 0 })));
    setMsg({ kind: "ok", text: `Re-filled shares from ${basisYearFor(company)}` });
  }

  async function handleSave() {
    if (!company) { setMsg({ kind: "err", text: "Pick a company" }); return; }
    if (!groupName) { setMsg({ kind: "err", text: "Pick a beat" }); return; }
    if (!period.trim()) { setMsg({ kind: "err", text: "Enter a period label" }); return; }
    if (target <= 0) { setMsg({ kind: "err", text: "Enter a target in kg" }); return; }
    setSaving(true); setMsg(null);
    try {
      const res = await saveTallyAllocation({
        company, partyGroup: groupName, periodLabel: period.trim(), targetKg: target,
        allocations: rows.map((r) => ({ party_name: r.party_name, share_pct: r.share_pct, hist_kg: r.basis_kg })),
      });
      if ("error" in res) setMsg({ kind: "err", text: res.error });
      else { setSaved(true); setMsg({ kind: "ok", text: `Saved — ${fmtKg(res.allocatedKg)} kg across ${res.count} shops` }); }
    } finally { setSaving(false); }
  }

  async function handleRefresh() {
    setRefreshing(true); setMsg(null);
    try {
      const resp = await fetch("/api/tally-targets/refresh", { method: "POST" });
      const json = await resp.json();
      if (!resp.ok) setMsg({ kind: "err", text: json.error || "Refresh failed" });
      else {
        setRowCount(json.inserted);
        setMsg({ kind: "ok", text: `Refreshed — ${json.inserted} rows loaded across both companies. Reselect a beat to see updated shares.` });
        if (company && groupName && period) load(company, groupName, period);
      }
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally { setRefreshing(false); }
  }

  const shareWarn = Math.abs(totalShare - 100) > 0.5;

  return (
    <div className="space-y-4">
      {/* status + refresh */}
      <div className="flex items-center justify-between gap-3 flex-wrap bg-paper-card border border-paper-line rounded-md px-3 py-2">
        <span className="text-xs text-ink-muted">
          Tally sales loaded: <strong className="tabular text-ink">{fmtKg(rowCount)}</strong> rows
        </span>
        <button
          onClick={handleRefresh} disabled={refreshing}
          className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-paper-line rounded hover:bg-paper-subtle disabled:opacity-50"
        >
          {refreshing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          {refreshing ? "Refreshing…" : "Refresh from Google Sheet"}
        </button>
      </div>

      {/* company tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        <Building2 size={15} className="text-ink-subtle" />
        {companies.length === 0 && <span className="text-sm text-ink-muted">No data yet — hit Refresh.</span>}
        {companies.map((c) => {
          const active = c.company === company;
          return (
            <button
              key={c.company}
              onClick={() => setCompany(c.company)}
              className={`text-sm px-3 py-1.5 rounded border transition-colors ${
                active ? "bg-accent text-white border-accent" : "bg-paper-card border-paper-line text-ink-muted hover:bg-paper-subtle"
              }`}
            >
              {c.company}
              <span className={active ? "text-white/70 ml-1" : "text-ink-subtle ml-1"}>· {fmtKg(c.total_kg)}kg</span>
            </button>
          );
        })}
      </div>

      {/* beat picker — dropdown */}
      <div className="bg-paper-card border border-paper-line rounded-md p-3">
        <label className="block text-2xs uppercase tracking-wide text-ink-muted mb-1">Beat (party group)</label>
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-md">
            <MapPin size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-subtle pointer-events-none" />
            <select
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              className="w-full pl-8 pr-8 py-2 text-sm border border-paper-line rounded bg-paper-card focus:outline-none focus:border-accent appearance-none cursor-pointer"
            >
              <option value="">— Select a beat —</option>
              {companyGroups.map((g) => (
                <option key={g.party_group} value={g.party_group}>
                  {g.party_group} ({fmtKg(g.total_kg)} kg · {g.parties} shops)
                </option>
              ))}
            </select>
          </div>
          <span className="text-2xs text-ink-subtle whitespace-nowrap">{companyGroups.length} groups</span>
        </div>
      </div>

      {!groupName ? (
        <div className="bg-paper-card border border-dashed border-paper-line rounded-md p-8 text-center">
          <Target size={20} className="text-ink-subtle mx-auto mb-2" />
          <p className="text-sm font-medium">Pick a beat to set a Tally target</p>
        </div>
      ) : (
        <div className="bg-paper-card border border-paper-line rounded-md overflow-hidden">
          <div className="px-4 py-3 border-b border-paper-line bg-paper-subtle/40 flex items-center gap-2">
            <Target size={15} className="text-accent" />
            <h3 className="text-sm font-semibold">{company} — {groupName}</h3>
            {saved && <span className="ml-auto text-2xs text-ok inline-flex items-center gap-1"><Check size={11} /> saved</span>}
          </div>
          <div className="p-4 space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-2xs uppercase tracking-wide text-ink-muted mb-1">Period label</label>
                <input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="e.g. May 2026"
                  className="border border-paper-line rounded px-2 py-1.5 text-sm bg-paper-card w-40 focus:outline-none focus:border-accent" />
              </div>
              <div>
                <label className="block text-2xs uppercase tracking-wide text-ink-muted mb-1">Beat target (kg)</label>
                <input type="number" min="0" step="1" value={targetKg} onChange={(e) => setTargetKg(e.target.value)} placeholder="e.g. 5000"
                  className="border border-paper-line rounded px-2 py-1.5 text-sm bg-paper-card w-32 tabular focus:outline-none focus:border-accent" />
              </div>
              <button onClick={autoFill} disabled={loading || rows.length === 0}
                className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 border border-paper-line rounded hover:bg-paper-subtle disabled:opacity-50">
                <RotateCcw size={12} /> Auto-fill %
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-4 text-xs bg-paper-subtle/40 border border-paper-line rounded px-3 py-2">
              <span>Allocated: <strong className="tabular text-ink">{fmtKg(totalAlloc)}</strong><span className="text-ink-subtle"> / {fmtKg(target)} kg</span></span>
              <span className={shareWarn ? "text-warn" : "text-ok"}>
                Shares: <strong className="tabular">{totalShare.toLocaleString("en-IN", { maximumFractionDigits: 2 })}%</strong>
                {shareWarn && <span className="ml-1">(≠100%)</span>}
              </span>
              <span className="text-ink-subtle ml-auto">{rows.length} shops · share from {basisYearFor(company)}{basisYearFor(company) === "25-26" ? " (full year)" : ""}</span>
            </div>

            {msg && (
              <div className={`flex items-start gap-2 text-xs rounded px-3 py-2 border ${
                msg.kind === "ok" ? "bg-ok-soft/40 border-ok/40 text-ok" : "bg-danger-soft/40 border-danger/40 text-danger"
              }`}>
                {msg.kind === "ok" ? <Check size={13} className="mt-0.5 shrink-0" /> : <AlertCircle size={13} className="mt-0.5 shrink-0" />}
                <span>{msg.text}</span>
              </div>
            )}

            <div className="border border-paper-line rounded overflow-hidden">
              <div className="overflow-x-auto max-h-[460px] overflow-y-auto">
                <table className="w-full text-sm min-w-[600px]">
                  <thead className="bg-paper-subtle/60 border-b border-paper-line sticky top-0">
                    <tr className="text-left text-2xs uppercase tracking-wide text-ink-muted">
                      <th className="px-3 py-2 font-medium">Shop (Party)</th>
                      <th className="px-3 py-2 font-medium text-right">25-26 kg</th>
                      <th className="px-3 py-2 font-medium text-right">26-27 kg</th>
                      <th className="px-3 py-2 font-medium text-right">Share %<br/><span className="normal-case text-ink-subtle">(of {basisYearFor(company)})</span></th>
                      <th className="px-3 py-2 font-medium text-right">Target kg</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-paper-line">
                    {loading ? (
                      <tr><td colSpan={5} className="px-3 py-8 text-center text-ink-muted"><Loader2 size={16} className="animate-spin inline" /> Loading…</td></tr>
                    ) : rows.length === 0 ? (
                      <tr><td colSpan={5} className="px-3 py-8 text-center text-ink-muted">No Tally sales for this group.</td></tr>
                    ) : (
                      rows.map((r) => {
                        const alloc = target * (r.share_pct || 0) / 100;
                        return (
                          <tr key={r.party_name} className="hover:bg-paper-subtle/40">
                            <td className="px-3 py-2 font-medium">{r.party_name}</td>
                            <td className="px-3 py-2 text-right tabular text-ink-muted">{fmtKg(r.kg_2526)}</td>
                            <td className="px-3 py-2 text-right tabular text-ink-subtle">{fmtKg(r.kg_2627)}</td>
                            <td className="px-3 py-2 text-right">
                              <input type="number" min="0" step="0.01"
                                value={r.share_pct === 0 ? "" : r.share_pct}
                                onChange={(e) => updateShare(r.party_name, e.target.value)} placeholder="0"
                                className="border border-paper-line rounded px-2 py-1 text-sm bg-paper-card w-20 text-right tabular focus:outline-none focus:border-accent" />
                            </td>
                            <td className="px-3 py-2 text-right tabular font-semibold">{fmtKg(alloc)}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex justify-end">
              <button onClick={handleSave} disabled={saving || loading || target <= 0}
                className="inline-flex items-center gap-1.5 text-sm px-4 py-2 bg-accent text-white rounded hover:bg-accent/90 disabled:opacity-50">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {saving ? "Saving…" : "Save allocation"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function defaultPeriod(): string {
  return new Date().toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}
