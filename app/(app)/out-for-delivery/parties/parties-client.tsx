"use client";

import { useState, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, X, CheckCircle2, Edit2 } from "lucide-react";
import { assignPartyBeats } from "./actions";

export type PartyRow = {
  party_name: string;
  invoices: number;
  value: number;
  current_beat: string;
  is_override: boolean;
  overridden_by: string | null;
  overridden_at: string | null;
};

// Fixed beat options — includes everything the regex can produce plus a few extras.
// The user can type any custom beat via the "+ New beat" option (free text).
const BUILTIN_BEATS = [
  "S Pur",
  "D Raja",
  "Mehkar",
  "Lonar",
  "Deulgaon Mali",
  "Hiwra Ashram",
  "Sakharkheda",
  "D Mahi-Andera-Mera",
  "Malipeth",
  "Waghrul",
  "Talni",
  "B Pur / Bambu",
  "New Mondha",
  "Antri Deshmukh",
  "Internal",
  "Unassigned",
] as const;

function fmtMoney(n: number): string {
  return "₹" + (Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

export function PartiesClient({
  parties,
  beatCounts,
  filters,
  totalParties,
}: {
  parties: PartyRow[];
  beatCounts: [string, number][];
  filters: { beat: string; q: string };
  totalParties: number;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [searchInput, setSearchInput] = useState(filters.q);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingParty, setEditingParty] = useState<string | null>(null);
  const [customBeat, setCustomBeat] = useState("");
  const [savingParty, setSavingParty] = useState<string | null>(null);
  const [bulkBeat, setBulkBeat] = useState<string>("");
  const [bulkCustom, setBulkCustom] = useState("");
  const [showBulkCustom, setShowBulkCustom] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  // Combine built-in beats with any beats already used (incl. custom ones)
  const allBeats = useMemo(() => {
    const s = new Set<string>(BUILTIN_BEATS);
    for (const [b] of beatCounts) if (b) s.add(b);
    return Array.from(s).sort();
  }, [beatCounts]);

  function setParam(name: string, value: string | null) {
    const sp = new URLSearchParams(searchParams.toString());
    if (value && value.trim()) sp.set(name, value);
    else sp.delete(name);
    router.push(`/out-for-delivery/parties?${sp.toString()}`);
  }

  function onSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    setParam("q", searchInput);
  }

  function toggleRow(name: string) {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setSelected(next);
  }
  function toggleAll() {
    const names = parties.map((p) => p.party_name);
    const allSelected = names.every((n) => selected.has(n));
    const next = new Set(selected);
    if (allSelected) names.forEach((n) => next.delete(n));
    else names.forEach((n) => next.add(n));
    setSelected(next);
  }

  async function saveBeat(party_name: string, beat: string) {
    const trimmed = beat.trim();
    if (!trimmed) return;
    setSavingParty(party_name);
    const res = await assignPartyBeats([party_name], trimmed);
    setSavingParty(null);
    setEditingParty(null);
    setCustomBeat("");
    if (!res.ok) alert(res.error ?? "Failed");
    else router.refresh();
  }

  async function saveBulk() {
    const beat = showBulkCustom ? bulkCustom.trim() : bulkBeat;
    if (!beat) { alert("Pick or type a beat."); return; }
    if (selected.size === 0) return;
    if (!confirm(`Assign ${selected.size} party(ies) to beat "${beat}"?`)) return;
    setBulkBusy(true);
    const res = await assignPartyBeats(Array.from(selected), beat);
    setBulkBusy(false);
    if (!res.ok) alert(res.error ?? "Failed");
    else {
      setSelected(new Set());
      setBulkBeat("");
      setBulkCustom("");
      setShowBulkCustom(false);
      router.refresh();
    }
  }

  const mappedCount = totalParties - (beatCounts.find(([b]) => b === "Unassigned")?.[1] ?? 0);
  const mappedPct = totalParties > 0 ? Math.round((mappedCount / totalParties) * 100) : 0;

  return (
    <>
      {/* Progress */}
      <div className="bg-paper-card border border-paper-line rounded-md p-3 md:p-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="text-sm font-semibold">
              {mappedCount.toLocaleString("en-IN")} of {totalParties.toLocaleString("en-IN")} parties mapped
            </div>
            <div className="text-2xs text-ink-muted mt-0.5">{mappedPct}% complete</div>
          </div>
          <div className="flex-1 max-w-md">
            <div className="h-2 bg-paper-subtle rounded-full overflow-hidden">
              <div className="h-full bg-accent transition-all" style={{ width: `${mappedPct}%` }}></div>
            </div>
          </div>
        </div>
      </div>

      {/* Beat filter chips */}
      <div className="flex flex-wrap gap-2">
        <BeatChip label="All" count={totalParties} active={filters.beat === "all"} onClick={() => setParam("beat", "all")} />
        {beatCounts.map(([b, c]) => (
          <BeatChip key={b} label={b} count={c} active={filters.beat === b} onClick={() => setParam("beat", b)} highlight={b === "Unassigned"} />
        ))}
      </div>

      {/* Search */}
      <div className="bg-paper-card border border-paper-line rounded-md p-3">
        <form onSubmit={onSearchSubmit} className="flex items-end gap-2">
          <div className="relative flex-1 max-w-md">
            <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-subtle" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search party name"
              className="h-9 pl-7 pr-2 w-full rounded border border-paper-line bg-paper text-sm"
            />
          </div>
          <button type="submit" className="h-9 px-3 rounded bg-accent text-white text-sm font-medium hover:bg-accent/90">Search</button>
          {(filters.beat !== "Unassigned" || filters.q) && (
            <button type="button" onClick={() => { router.push("/out-for-delivery/parties"); setSearchInput(""); }}
              className="h-9 px-3 rounded border border-paper-line bg-paper text-sm text-ink-muted hover:bg-paper-subtle inline-flex items-center gap-1">
              <X size={14} /> Clear
            </button>
          )}
        </form>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="bg-accent/10 border border-accent/30 rounded-md p-3 flex flex-wrap items-center gap-3">
          <div className="text-sm font-medium">{selected.size} selected</div>
          <div className="flex items-center gap-2 ml-auto">
            {!showBulkCustom ? (
              <>
                <select value={bulkBeat} onChange={(e) => { if (e.target.value === "__custom__") setShowBulkCustom(true); else setBulkBeat(e.target.value); }}
                  className="h-8 px-2 rounded border border-paper-line bg-paper text-xs w-44">
                  <option value="">— Pick beat —</option>
                  {allBeats.filter((b) => b !== "Unassigned").map((b) => (<option key={b} value={b}>{b}</option>))}
                  <option value="__custom__">+ New beat…</option>
                </select>
              </>
            ) : (
              <>
                <input type="text" value={bulkCustom} onChange={(e) => setBulkCustom(e.target.value)}
                  placeholder="New beat name" className="h-8 px-2 rounded border border-paper-line bg-paper text-xs w-44" autoFocus />
                <button onClick={() => setShowBulkCustom(false)} className="h-8 px-2 rounded border border-paper-line bg-paper text-xs text-ink-muted">Cancel</button>
              </>
            )}
            <button onClick={() => setSelected(new Set())} className="h-8 px-3 rounded border border-paper-line bg-paper text-xs text-ink-muted">
              Deselect
            </button>
            <button onClick={saveBulk} disabled={bulkBusy || selected.size === 0}
              className="h-8 px-3 rounded bg-accent text-white text-xs font-medium hover:bg-accent/90 disabled:opacity-50 inline-flex items-center gap-1">
              <CheckCircle2 size={14} /> {bulkBusy ? "Assigning…" : `Assign ${selected.size}`}
            </button>
          </div>
        </div>
      )}

      {/* Party table */}
      <div className="bg-paper-card border border-paper-line rounded-md overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <thead className="bg-paper-subtle/60 border-b border-paper-line">
              <tr className="text-left text-2xs uppercase tracking-wide text-ink-muted">
                <th className="px-2 py-2.5 w-8">
                  <input type="checkbox" checked={parties.length > 0 && parties.every((p) => selected.has(p.party_name))} onChange={toggleAll} />
                </th>
                <th className="px-3 py-2.5 font-medium">Party</th>
                <th className="px-3 py-2.5 font-medium text-right">Invoices</th>
                <th className="px-3 py-2.5 font-medium text-right">Value</th>
                <th className="px-3 py-2.5 font-medium">Current beat</th>
                <th className="px-3 py-2.5 font-medium w-56">Set / Change</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-paper-line">
              {parties.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-sm text-ink-muted">No parties match the filter.</td></tr>
              )}
              {parties.map((p) => (
                <tr key={p.party_name} className="hover:bg-paper-subtle/40">
                  <td className="px-2 py-2"><input type="checkbox" checked={selected.has(p.party_name)} onChange={() => toggleRow(p.party_name)} /></td>
                  <td className="px-3 py-2 font-medium">{p.party_name}</td>
                  <td className="px-3 py-2 text-right tabular">{p.invoices}</td>
                  <td className="px-3 py-2 text-right tabular text-ink-muted">{fmtMoney(p.value)}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-block px-2 py-0.5 rounded text-2xs font-medium ${p.current_beat === "Unassigned" ? "bg-amber-50 text-amber-800 border border-amber-200" : "bg-emerald-50 text-emerald-800 border border-emerald-200"}`}>
                      {p.current_beat}
                    </span>
                    {p.is_override && <span className="ml-1 text-2xs text-ink-subtle">(manual)</span>}
                  </td>
                  <td className="px-3 py-2">
                    {editingParty === p.party_name ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          value={customBeat}
                          onChange={(e) => setCustomBeat(e.target.value)}
                          placeholder="Beat name"
                          className="h-7 px-2 rounded border border-paper-line bg-paper text-xs flex-1"
                          autoFocus
                          onKeyDown={(e) => { if (e.key === "Enter") saveBeat(p.party_name, customBeat); if (e.key === "Escape") setEditingParty(null); }}
                        />
                        <button onClick={() => saveBeat(p.party_name, customBeat)} disabled={savingParty === p.party_name}
                          className="h-7 px-2 rounded bg-accent text-white text-xs disabled:opacity-50">Save</button>
                        <button onClick={() => { setEditingParty(null); setCustomBeat(""); }} className="h-7 px-1 text-ink-muted">
                          <X size={12} />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        <select
                          value=""
                          onChange={(e) => {
                            const v = e.target.value;
                            if (!v) return;
                            if (v === "__custom__") { setEditingParty(p.party_name); setCustomBeat(""); }
                            else saveBeat(p.party_name, v);
                          }}
                          disabled={savingParty === p.party_name}
                          className="h-7 px-1.5 rounded border border-paper-line bg-paper text-xs flex-1"
                        >
                          <option value="">— Assign beat —</option>
                          {allBeats.filter((b) => b !== "Unassigned" && b !== p.current_beat).map((b) => (
                            <option key={b} value={b}>{b}</option>
                          ))}
                          <option value="__custom__">+ New beat…</option>
                        </select>
                        {savingParty === p.party_name && <span className="text-2xs text-ink-muted">saving…</span>}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="text-2xs text-ink-subtle">
        Tip: use the checkboxes + bulk-assign bar to batch-tag multiple parties on the same route in one click.
      </div>
    </>
  );
}

function BeatChip({ label, count, active, onClick, highlight }: { label: string; count: number; active: boolean; onClick: () => void; highlight?: boolean }) {
  const cls = active
    ? "bg-ink text-paper border-ink"
    : highlight
    ? "bg-amber-50 border-amber-300 text-amber-900 hover:bg-amber-100"
    : "border-paper-line hover:bg-paper-subtle";
  return (
    <button onClick={onClick} className={`h-8 px-3 rounded-full border text-xs font-medium inline-flex items-center gap-1.5 ${cls}`}>
      {label}
      <span className={`tabular ${active ? "" : "text-ink-muted"}`}>{count}</span>
    </button>
  );
}
