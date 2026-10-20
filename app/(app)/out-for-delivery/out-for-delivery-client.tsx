"use client";

import { useState, useMemo, Fragment } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, ChevronDown, Search, X, Truck, CheckCircle2, Clock, PackageCheck, MapPin, Plus } from "lucide-react";
import { fetchInvoiceLines, createDispatch, markDelivered, createVehicle, createHelper } from "./actions";

export type InvoiceStatus = "pending" | "dispatched" | "delivered";

export type InvoiceRow = {
  id: string;
  voucher_no: string;
  voucher_date: string;
  voucher_type: string;
  party_name: string;
  party_group: string | null;
  beat: string;
  total_amount: number;
  tax: number;
  kg: number;
  dispatched_at: string | null;
  delivered_at: string | null;
  dispatch_id: string | null;
  status: InvoiceStatus;
};

export type VehicleOpt = { id: string; number: string; make: string | null; capacity_kg: number | null };
export type HelperOpt = { id: string; name: string; role: string };

export type LineRow = {
  line_no: number | null;
  item_name: string | null;
  qty: number | null;
  qty_kg: number | null;
  qty_raw_text: string | null;
  rate: number | null;
  amount: number | null;
  hsn: string | null;
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" });
}
function fmtMoney(n: number): string {
  return "₹" + (Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}
function fmtKg(n: number | null): string {
  if (n == null) return "—";
  return (Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 1 });
}

const STATUS_META: Record<InvoiceStatus, { label: string; cls: string; Icon: typeof Clock }> = {
  pending: { label: "Pending", cls: "bg-amber-50 text-amber-800 border-amber-200", Icon: Clock },
  dispatched: { label: "In transit", cls: "bg-blue-50 text-blue-800 border-blue-200", Icon: Truck },
  delivered: { label: "Delivered", cls: "bg-emerald-50 text-emerald-800 border-emerald-200", Icon: CheckCircle2 },
};

export function OutForDeliveryClient({
  rows,
  parties,
  beats,
  vehicles,
  helpers,
  filters,
  statusCounts,
  periodCount,
  periodValue,
  periodKg,
}: {
  rows: InvoiceRow[];
  parties: string[];
  beats: string[];
  vehicles: VehicleOpt[];
  helpers: HelperOpt[];
  filters: { from: string | null; to: string | null; party: string | null; q: string | null; beat: string | null; status: InvoiceStatus | "all" };
  statusCounts: { pending: number; dispatched: number; delivered: number; all: number };
  periodCount: number;
  periodValue: number;
  periodKg: number;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [linesCache, setLinesCache] = useState<Record<string, LineRow[]>>({});
  const [loadingLines, setLoadingLines] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState(filters.q ?? "");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Default to grouped view — a tile per beat showing the delivery (invoice) date
  const [groupByBeat, setGroupByBeat] = useState(true);
  // Beat tiles are collapsed by default; the Set holds beats the user has opened
  const [openBeats, setOpenBeats] = useState<Set<string>>(new Set());
  function toggleBeat(beat: string) {
    const next = new Set(openBeats);
    if (next.has(beat)) next.delete(beat);
    else next.add(beat);
    setOpenBeats(next);
  }
  const [showDispatchModal, setShowDispatchModal] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  function setParam(name: string, value: string | null) {
    const sp = new URLSearchParams(searchParams.toString());
    if (value && value.trim()) sp.set(name, value);
    else sp.delete(name);
    router.push(`/out-for-delivery?${sp.toString()}`);
  }

  function clearFilters() {
    router.push("/out-for-delivery");
    setSearchInput("");
    setSelected(new Set());
  }
  function onSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    setParam("q", searchInput);
  }

  async function toggleExpand(id: string) {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    if (!linesCache[id]) {
      setLoadingLines(id);
      const lines = await fetchInvoiceLines(id);
      setLinesCache((prev) => ({ ...prev, [id]: lines }));
      setLoadingLines(null);
    }
  }

  function toggleRow(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }
  function toggleAll(ids: string[]) {
    const allSelected = ids.every((id) => selected.has(id));
    const next = new Set(selected);
    if (allSelected) ids.forEach((id) => next.delete(id));
    else ids.forEach((id) => next.add(id));
    setSelected(next);
  }

  const selectedRows = useMemo(() => rows.filter((r) => selected.has(r.id)), [rows, selected]);
  const selectableRows = useMemo(() => rows.filter((r) => r.status === "pending"), [rows]);

  async function onMarkDelivered(id: string) {
    setActionBusy(id);
    const res = await markDelivered([id]);
    setActionBusy(null);
    if (!res.ok) alert(res.error ?? "Failed to mark delivered");
    else router.refresh();
  }

  async function onMarkSelectedDelivered() {
    if (selectedRows.length === 0) return;
    const dispatched = selectedRows.filter((r) => r.status === "dispatched").map((r) => r.id);
    if (dispatched.length === 0) {
      alert("Select at least one 'In transit' invoice to mark delivered.");
      return;
    }
    if (!confirm(`Mark ${dispatched.length} invoice(s) as delivered?`)) return;
    setActionBusy("bulk-delivered");
    const res = await markDelivered(dispatched);
    setActionBusy(null);
    if (!res.ok) alert(res.error ?? "Failed");
    else { setSelected(new Set()); router.refresh(); }
  }

  const anyFilter = filters.from || filters.to || filters.party || filters.q || filters.beat || filters.status !== "pending";

  // Beat grouping — each tile shows beat, invoice/delivery date(s), count, kg, value.
  // If every invoice in a beat shares one voucher_date (common for tomorrow's trip
  // bills) show just that date; otherwise show earliest → latest.
  const beatGroups = useMemo(() => {
    if (!groupByBeat) return null;
    const map = new Map<string, InvoiceRow[]>();
    for (const r of rows) {
      if (!map.has(r.beat)) map.set(r.beat, []);
      map.get(r.beat)!.push(r);
    }
    return Array.from(map.entries())
      .map(([beat, invs]) => {
        const dates = Array.from(new Set(invs.map((i) => i.voucher_date))).sort();
        const dateLabel = dates.length === 1 ? fmtDate(dates[0]) : `${fmtDate(dates[0])} → ${fmtDate(dates[dates.length - 1])}`;
        return {
          beat, invs,
          count: invs.length,
          value: invs.reduce((a, b) => a + b.total_amount, 0),
          kg: invs.reduce((a, b) => a + b.kg, 0),
          dateLabel,
          singleDate: dates.length === 1,
        };
      })
      .sort((a, b) => b.count - a.count);
  }, [rows, groupByBeat]);

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Status chips + parties link.
          On mobile the chips get their own horizontally-scrollable row so
          each one stays legible / tappable, and the Parties & Beats button
          drops to its own line below. On md+ it collapses to a single row
          with the button pushed right (ml-auto). */}
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:flex-wrap">
        <div className="flex items-center gap-2 overflow-x-auto -mx-4 px-4 pb-1 md:mx-0 md:px-0 md:pb-0 md:flex-wrap">
          <StatusChip label="Pending" count={statusCounts.pending} active={filters.status === "pending"} onClick={() => setParam("status", "pending")} tone="amber" />
          <StatusChip label="In transit" count={statusCounts.dispatched} active={filters.status === "dispatched"} onClick={() => setParam("status", "dispatched")} tone="blue" />
          <StatusChip label="Delivered" count={statusCounts.delivered} active={filters.status === "delivered"} onClick={() => setParam("status", "delivered")} tone="emerald" />
          <StatusChip label="All" count={statusCounts.all} active={filters.status === "all"} onClick={() => setParam("status", "all")} tone="neutral" />
        </div>
        <Link href="/out-for-delivery/parties"
          className="h-8 px-3 rounded-full border border-paper-line hover:bg-paper-subtle text-xs font-medium inline-flex items-center justify-center gap-1.5 md:ml-auto">
          <MapPin size={12} /> Parties &amp; Beats
        </Link>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Shown" value={periodCount.toLocaleString("en-IN")} sub={anyFilter ? "matches filter" : "most recent"} />
        <Kpi label="Value" value={fmtMoney(periodValue)} sub="before tax" />
        <Kpi label="Weight" value={`${fmtKg(periodKg)} kg`} sub="in shown invoices" />
        <Kpi label="Parties" value={new Set(rows.map((r) => r.party_name)).size.toLocaleString("en-IN")} sub="distinct customers" />
      </div>

      {/* Filter bar */}
      <div className="bg-paper-card border border-paper-line rounded-md p-3 md:p-4">
        <div className="flex flex-wrap items-end gap-3">
          <form onSubmit={onSearchSubmit} className="flex items-end gap-2">
            <label className="block">
              <span className="text-2xs uppercase tracking-wide text-ink-muted font-medium">Search party / invoice</span>
              <div className="mt-1 relative">
                <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-subtle" />
                <input type="text" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="e.g. Pooja or OCS/0138"
                  className="h-9 pl-7 pr-2 w-56 rounded border border-paper-line bg-paper text-sm" />
              </div>
            </label>
            <button type="submit" className="h-9 px-3 rounded bg-accent text-white text-sm font-medium hover:bg-accent/90">Apply</button>
          </form>

          <label className="block">
            <span className="text-2xs uppercase tracking-wide text-ink-muted font-medium">Beat</span>
            <select value={filters.beat ?? ""} onChange={(e) => setParam("beat", e.target.value || null)}
              className="mt-1 h-9 px-2 rounded border border-paper-line bg-paper text-sm w-44">
              <option value="">All beats</option>
              {beats.map((b) => (<option key={b} value={b}>{b}</option>))}
            </select>
          </label>

          <label className="block">
            <span className="text-2xs uppercase tracking-wide text-ink-muted font-medium">Party</span>
            <select value={filters.party ?? ""} onChange={(e) => setParam("party", e.target.value || null)}
              className="mt-1 h-9 px-2 rounded border border-paper-line bg-paper text-sm w-48">
              <option value="">All parties</option>
              {parties.map((p) => (<option key={p} value={p}>{p}</option>))}
            </select>
          </label>

          <label className="block">
            <span className="text-2xs uppercase tracking-wide text-ink-muted font-medium">From</span>
            <input type="date" value={filters.from ?? ""} onChange={(e) => setParam("from", e.target.value || null)}
              className="mt-1 h-9 px-2 rounded border border-paper-line bg-paper text-sm" />
          </label>
          <label className="block">
            <span className="text-2xs uppercase tracking-wide text-ink-muted font-medium">To</span>
            <input type="date" value={filters.to ?? ""} onChange={(e) => setParam("to", e.target.value || null)}
              className="mt-1 h-9 px-2 rounded border border-paper-line bg-paper text-sm" />
          </label>

          <label className="inline-flex items-center gap-1.5 h-9 text-sm" title="Off: show one flat table of invoices">
            <input type="checkbox" checked={groupByBeat} onChange={(e) => setGroupByBeat(e.target.checked)} />
            Group by beat
          </label>
          {groupByBeat && beatGroups && beatGroups.length > 0 && (
            <div className="inline-flex items-center gap-1 h-9 text-2xs">
              <button
                type="button"
                onClick={() => setOpenBeats(new Set(beatGroups.map((g) => g.beat)))}
                className="h-7 px-2 rounded border border-paper-line bg-paper text-ink-muted hover:bg-paper-subtle"
              >Expand all</button>
              <button
                type="button"
                onClick={() => setOpenBeats(new Set())}
                className="h-7 px-2 rounded border border-paper-line bg-paper text-ink-muted hover:bg-paper-subtle"
              >Collapse all</button>
            </div>
          )}

          {anyFilter && (
            <button onClick={clearFilters}
              className="h-9 px-3 rounded border border-paper-line bg-paper-card text-sm text-ink-muted hover:bg-paper-subtle inline-flex items-center gap-1">
              <X size={14} /> Clear
            </button>
          )}
        </div>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="bg-accent/10 border border-accent/30 rounded-md p-3 flex flex-wrap items-center gap-3">
          <div className="text-sm font-medium">{selected.size} selected</div>
          <div className="text-2xs text-ink-muted">
            Value {fmtMoney(selectedRows.reduce((a, r) => a + r.total_amount, 0))} ·
            {" "}Kg {fmtKg(selectedRows.reduce((a, r) => a + r.kg, 0))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => setSelected(new Set())} className="h-8 px-3 rounded border border-paper-line bg-paper text-xs text-ink-muted hover:bg-paper-subtle">
              Deselect
            </button>
            {selectedRows.every((r) => r.status === "pending") && (
              <button onClick={() => setShowDispatchModal(true)}
                className="h-8 px-3 rounded bg-accent text-white text-xs font-medium hover:bg-accent/90 inline-flex items-center gap-1">
                <Truck size={14} /> Create Dispatch
              </button>
            )}
            {selectedRows.some((r) => r.status === "dispatched") && (
              <button onClick={onMarkSelectedDelivered} disabled={actionBusy === "bulk-delivered"}
                className="h-8 px-3 rounded bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 inline-flex items-center gap-1 disabled:opacity-50">
                <CheckCircle2 size={14} /> Mark Delivered
              </button>
            )}
          </div>
        </div>
      )}

      {/* List */}
      {groupByBeat && beatGroups ? (
        <div className="space-y-2">
          {beatGroups.map((g) => (
            <BeatTile key={g.beat} beat={g.beat} count={g.count} value={g.value} kg={g.kg}
              dateLabel={g.dateLabel} singleDate={g.singleDate}
              isOpen={openBeats.has(g.beat)} onToggle={() => toggleBeat(g.beat)}
              invoices={g.invs} selected={selected} onToggleRow={toggleRow} onToggleAll={toggleAll}
              expandedId={expandedId} onExpand={toggleExpand} linesCache={linesCache} loadingLines={loadingLines}
              onMarkDelivered={onMarkDelivered} actionBusy={actionBusy} />
          ))}
          {beatGroups.length === 0 && <EmptyState />}
        </div>
      ) : (
        <InvoiceTable invoices={rows} selected={selected} onToggleRow={toggleRow} onToggleAll={toggleAll}
          expandedId={expandedId} onExpand={toggleExpand} linesCache={linesCache} loadingLines={loadingLines}
          onMarkDelivered={onMarkDelivered} actionBusy={actionBusy} />
      )}

      {rows.length === 500 && (
        <div className="text-2xs text-ink-subtle px-1">Showing first 500 — narrow filters to see more.</div>
      )}

      {/* Create dispatch modal */}
      {showDispatchModal && (
        <CreateDispatchModal selectedRows={selectedRows} vehicles={vehicles} helpers={helpers}
          onClose={() => setShowDispatchModal(false)}
          onCreated={(dispatchId) => {
            setShowDispatchModal(false);
            setSelected(new Set());
            // Same-tab navigation — window.open popups get killed by popup
            // blockers on both desktop and mobile. ?confirm=load lands with
            // the vehicle-load section at the top.
            router.push(`/out-for-delivery/dispatch/${dispatchId}?confirm=load`);
          }} />
      )}
    </div>
  );
}

function StatusChip({ label, count, active, onClick, tone }: { label: string; count: number; active: boolean; onClick: () => void; tone: "amber" | "blue" | "emerald" | "neutral" }) {
  const toneCls = {
    amber: active ? "bg-amber-100 border-amber-300 text-amber-900" : "border-paper-line hover:bg-paper-subtle",
    blue: active ? "bg-blue-100 border-blue-300 text-blue-900" : "border-paper-line hover:bg-paper-subtle",
    emerald: active ? "bg-emerald-100 border-emerald-300 text-emerald-900" : "border-paper-line hover:bg-paper-subtle",
    neutral: active ? "bg-ink text-paper border-ink" : "border-paper-line hover:bg-paper-subtle",
  }[tone];
  return (
    <button onClick={onClick} className={`h-8 px-3 rounded-full border text-xs font-medium inline-flex items-center gap-1.5 shrink-0 whitespace-nowrap ${toneCls}`}>
      {label}
      <span className={`tabular ${active ? "" : "text-ink-muted"}`}>{count.toLocaleString("en-IN")}</span>
    </button>
  );
}

function InvoiceTable({
  invoices, selected, onToggleRow, onToggleAll, expandedId, onExpand, linesCache, loadingLines, onMarkDelivered, actionBusy, embedded,
}: {
  invoices: InvoiceRow[];
  selected: Set<string>;
  onToggleRow: (id: string) => void;
  onToggleAll: (ids: string[]) => void;
  expandedId: string | null;
  onExpand: (id: string) => void;
  linesCache: Record<string, LineRow[]>;
  loadingLines: string | null;
  onMarkDelivered: (id: string) => void;
  actionBusy: string | null;
  // When rendered inside a BeatTile, skip the outer card chrome so the two
  // borders don't double up.
  embedded?: boolean;
}) {
  const allIds = invoices.map((r) => r.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));
  if (invoices.length === 0) return <EmptyState />;
  const wrapperCls = embedded ? "" : "bg-paper-card border border-paper-line rounded-md overflow-hidden";
  return (
    <div className={wrapperCls}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead className="bg-paper-subtle/60 border-b border-paper-line">
            <tr className="text-left text-2xs uppercase tracking-wide text-ink-muted">
              <th className="px-2 py-2.5 w-8"><input type="checkbox" checked={allSelected} onChange={() => onToggleAll(allIds)} /></th>
              <th className="px-3 py-2.5 w-6"></th>
              <th className="px-3 py-2.5 font-medium">Date</th>
              <th className="px-3 py-2.5 font-medium">Invoice #</th>
              <th className="px-3 py-2.5 font-medium">Party</th>
              <th className="px-3 py-2.5 font-medium">Beat</th>
              <th className="px-3 py-2.5 font-medium">Status</th>
              <th className="px-3 py-2.5 font-medium text-right">Kg</th>
              <th className="px-3 py-2.5 font-medium text-right">Total</th>
              <th className="px-3 py-2.5 w-24"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-paper-line">
            {invoices.map((r) => {
              const isOpen = expandedId === r.id;
              const meta = STATUS_META[r.status];
              return (
                <Fragment key={r.id}>
                  <tr className={`hover:bg-paper-subtle/40 ${isOpen ? "bg-paper-subtle/30" : ""}`}>
                    <td className="px-2 py-2.5"><input type="checkbox" checked={selected.has(r.id)} onChange={() => onToggleRow(r.id)} /></td>
                    <td className="px-3 py-2.5 text-ink-subtle cursor-pointer" onClick={() => onExpand(r.id)}>
                      {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </td>
                    <td className="px-3 py-2.5 tabular whitespace-nowrap cursor-pointer" onClick={() => onExpand(r.id)}>{fmtDate(r.voucher_date)}</td>
                    <td className="px-3 py-2.5 font-mono text-xs cursor-pointer" onClick={() => onExpand(r.id)}>{r.voucher_no || "—"}</td>
                    <td className="px-3 py-2.5 cursor-pointer" onClick={() => onExpand(r.id)}>
                      <div className="font-medium">{r.party_name}</div>
                    </td>
                    <td className="px-3 py-2.5 text-ink-muted text-xs">{r.beat}</td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-2xs font-medium ${meta.cls}`}>
                        <meta.Icon size={10} /> {meta.label}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular">{fmtKg(r.kg)}</td>
                    <td className="px-3 py-2.5 text-right tabular font-semibold">{fmtMoney(r.total_amount)}</td>
                    <td className="px-3 py-2.5">
                      {r.status === "dispatched" && (
                        <button onClick={() => onMarkDelivered(r.id)} disabled={actionBusy === r.id}
                          className="h-7 px-2 rounded border border-emerald-200 bg-emerald-50 text-emerald-800 text-2xs font-medium hover:bg-emerald-100 disabled:opacity-50">
                          Mark delivered
                        </button>
                      )}
                      {r.status === "delivered" && r.delivered_at && (
                        <span className="text-2xs text-emerald-700">{fmtDate(r.delivered_at.slice(0, 10))}</span>
                      )}
                      {r.dispatch_id && (
                        <a href={`/out-for-delivery/dispatch/${r.dispatch_id}`} target="_blank" rel="noopener"
                           className="ml-1 text-2xs text-accent hover:underline">load list</a>
                      )}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={10} className="px-3 py-3 bg-paper-subtle/20">
                        {loadingLines === r.id ? (
                          <div className="text-sm text-ink-muted">Loading line items…</div>
                        ) : (
                          <LinesTable lines={linesCache[r.id] ?? []} />
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BeatTile(props: {
  beat: string;
  count: number;
  value: number;
  kg: number;
  dateLabel: string;
  singleDate: boolean;
  isOpen: boolean;
  onToggle: () => void;
  invoices: InvoiceRow[];
  selected: Set<string>;
  onToggleRow: (id: string) => void;
  onToggleAll: (ids: string[]) => void;
  expandedId: string | null;
  onExpand: (id: string) => void;
  linesCache: Record<string, LineRow[]>;
  loadingLines: string | null;
  onMarkDelivered: (id: string) => void;
  actionBusy: string | null;
}) {
  const anySelectedInBeat = props.invoices.some((r) => props.selected.has(r.id));
  const allSelectedInBeat = props.invoices.length > 0 && props.invoices.every((r) => props.selected.has(r.id));
  return (
    <div className={`bg-paper-card border rounded-md overflow-hidden transition-colors ${anySelectedInBeat ? "border-accent/50" : "border-paper-line"}`}>
      {/* Tile header — click toggles the beat open/closed. The checkbox sits
          outside the toggle hit-area so selecting all invoices in a beat does
          not also expand it. */}
      <div className="flex items-stretch">
        <label className="flex items-center px-3 border-r border-paper-line hover:bg-paper-subtle/50 cursor-pointer" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={allSelectedInBeat}
            ref={(el) => { if (el) el.indeterminate = anySelectedInBeat && !allSelectedInBeat; }}
            onChange={() => props.onToggleAll(props.invoices.map((r) => r.id))}
          />
        </label>
        <button
          type="button"
          onClick={props.onToggle}
          className="flex-1 flex items-center gap-3 px-4 py-3 hover:bg-paper-subtle/40 text-left"
        >
          {props.isOpen ? <ChevronDown size={16} className="text-ink-subtle" /> : <ChevronRight size={16} className="text-ink-subtle" />}
          <div className="flex-1 min-w-0 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-base font-semibold text-ink">{props.beat}</span>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-2xs font-medium ${props.singleDate ? "bg-amber-50 text-amber-800 border border-amber-200" : "bg-paper-subtle text-ink-muted border border-paper-line"}`}>
              <Clock size={10} /> {props.dateLabel}
            </span>
            <span className="text-xs text-ink-muted tabular">
              {props.count} {props.count === 1 ? "invoice" : "invoices"} · {fmtKg(props.kg)} kg · {fmtMoney(props.value)}
            </span>
          </div>
        </button>
      </div>
      {props.isOpen && (
        <div className="border-t border-paper-line">
          <InvoiceTable
            invoices={props.invoices}
            selected={props.selected}
            onToggleRow={props.onToggleRow}
            onToggleAll={props.onToggleAll}
            expandedId={props.expandedId}
            onExpand={props.onExpand}
            linesCache={props.linesCache}
            loadingLines={props.loadingLines}
            onMarkDelivered={props.onMarkDelivered}
            actionBusy={props.actionBusy}
            embedded
          />
        </div>
      )}
    </div>
  );
}

function LinesTable({ lines }: { lines: LineRow[] }) {
  if (lines.length === 0) return <div className="text-sm text-ink-muted">No line items.</div>;
  const totalKg = lines.reduce((a, l) => a + (Number(l.qty_kg) || 0), 0);
  const totalAmt = lines.reduce((a, l) => a + (Number(l.amount) || 0), 0);
  return (
    <div className="rounded border border-paper-line bg-paper overflow-hidden">
      <table className="w-full text-xs">
        <thead className="bg-paper-subtle/60 border-b border-paper-line">
          <tr className="text-left text-2xs uppercase tracking-wide text-ink-muted">
            <th className="px-2 py-1.5 font-medium">#</th>
            <th className="px-2 py-1.5 font-medium">Item</th>
            <th className="px-2 py-1.5 font-medium">HSN</th>
            <th className="px-2 py-1.5 font-medium text-right">Qty</th>
            <th className="px-2 py-1.5 font-medium text-right">Kg</th>
            <th className="px-2 py-1.5 font-medium text-right">Rate</th>
            <th className="px-2 py-1.5 font-medium text-right">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-paper-line">
          {lines.map((l, i) => (
            <tr key={`${l.line_no}-${i}`}>
              <td className="px-2 py-1.5 text-ink-subtle tabular">{l.line_no ?? i + 1}</td>
              <td className="px-2 py-1.5">{l.item_name ?? "—"}</td>
              <td className="px-2 py-1.5 font-mono text-2xs text-ink-muted">{l.hsn ?? "—"}</td>
              <td className="px-2 py-1.5 text-right tabular">{l.qty != null ? Number(l.qty).toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—"}</td>
              <td className="px-2 py-1.5 text-right tabular">{fmtKg(l.qty_kg)}</td>
              <td className="px-2 py-1.5 text-right tabular text-ink-muted">{l.rate != null ? fmtMoney(Number(l.rate)) : "—"}</td>
              <td className="px-2 py-1.5 text-right tabular font-medium">{l.amount != null ? fmtMoney(Number(l.amount)) : "—"}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-paper-line bg-paper-subtle/40 font-semibold">
            <td colSpan={4} className="px-2 py-1.5 text-right text-ink-muted">Total</td>
            <td className="px-2 py-1.5 text-right tabular">{fmtKg(totalKg)}</td>
            <td className="px-2 py-1.5"></td>
            <td className="px-2 py-1.5 text-right tabular">{fmtMoney(totalAmt)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-paper-card border border-paper-line rounded-md p-3">
      <div className="text-2xs uppercase tracking-wide text-ink-muted font-medium">{label}</div>
      <div className="text-xl font-bold tabular mt-0.5 text-ink">{value}</div>
      {sub && <div className="text-2xs text-ink-subtle mt-0.5">{sub}</div>}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="bg-paper-card border border-dashed border-paper-line rounded-md p-10 text-center text-sm text-ink-muted">
      No invoices match the current filters.
    </div>
  );
}

function CreateDispatchModal({
  selectedRows, vehicles: vehiclesProp, helpers: helpersProp, onClose, onCreated,
}: {
  selectedRows: InvoiceRow[];
  vehicles: VehicleOpt[];
  helpers: HelperOpt[];
  onClose: () => void;
  onCreated: (dispatchId: string) => void;
}) {
  // Local lists so items created inline show up immediately in the dropdowns
  // without a round-trip refresh.
  const [vehicles, setVehicles] = useState<VehicleOpt[]>(vehiclesProp);
  const [helpers, setHelpers] = useState<HelperOpt[]>(helpersProp);
  const [vehicleId, setVehicleId] = useState<string>(vehiclesProp[0]?.id ?? "");
  const [helper1Id, setHelper1Id] = useState<string>("");
  const [helper2Id, setHelper2Id] = useState<string>("");
  const [dispatchDate, setDispatchDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Inline new-vehicle form
  const [showNewVehicle, setShowNewVehicle] = useState(false);
  const [newVehNumber, setNewVehNumber] = useState("");
  const [newVehMake, setNewVehMake] = useState("");
  const [newVehCapacity, setNewVehCapacity] = useState("");
  const [savingVehicle, setSavingVehicle] = useState(false);
  const [newVehErr, setNewVehErr] = useState<string | null>(null);

  // Inline new-helper form. `target` says which slot the freshly-created
  // helper should be auto-assigned to.
  const [newHelperTarget, setNewHelperTarget] = useState<null | 1 | 2>(null);
  const [newHelperName, setNewHelperName] = useState("");
  const [newHelperRole, setNewHelperRole] = useState("");
  const [savingHelper, setSavingHelper] = useState(false);
  const [newHelperErr, setNewHelperErr] = useState<string | null>(null);

  const totalKg = selectedRows.reduce((a, r) => a + r.kg, 0);
  const totalValue = selectedRows.reduce((a, r) => a + r.total_amount, 0);
  const beats = Array.from(new Set(selectedRows.map((r) => r.beat))).sort();
  const vehicle = vehicles.find((v) => v.id === vehicleId);
  const overload = vehicle?.capacity_kg != null && totalKg > vehicle.capacity_kg;
  // Guard so the same person isn't picked as helper 1 and helper 2
  const sameHelper = helper1Id !== "" && helper1Id === helper2Id;

  async function saveNewHelper() {
    setNewHelperErr(null);
    const name = newHelperName.trim();
    if (!name) { setNewHelperErr("Name is required"); return; }
    setSavingHelper(true);
    const res = await createHelper({ name, role: newHelperRole.trim() || null });
    setSavingHelper(false);
    if (!res.ok) { setNewHelperErr(res.error ?? "Failed"); return; }
    // Add to local list (dedupe), auto-select into the slot that opened the form
    setHelpers((prev) => {
      const without = prev.filter((h) => h.id !== res.helper.id);
      return [...without, res.helper].sort((a, b) => a.name.localeCompare(b.name));
    });
    if (newHelperTarget === 1) setHelper1Id(res.helper.id);
    else if (newHelperTarget === 2) setHelper2Id(res.helper.id);
    setNewHelperTarget(null);
    setNewHelperName(""); setNewHelperRole("");
  }

  async function saveNewVehicle() {
    setNewVehErr(null);
    const number = newVehNumber.trim();
    if (!number) { setNewVehErr("Vehicle number is required"); return; }
    setSavingVehicle(true);
    const res = await createVehicle({
      number,
      make: newVehMake.trim() || null,
      capacity_kg: newVehCapacity.trim() ? Number(newVehCapacity) : null,
    });
    setSavingVehicle(false);
    if (!res.ok) { setNewVehErr(res.error ?? "Failed"); return; }
    // Insert at the top of the local list, select it, and collapse the form.
    setVehicles((prev) => {
      const without = prev.filter((v) => v.id !== res.vehicle.id);
      return [res.vehicle, ...without];
    });
    setVehicleId(res.vehicle.id);
    setShowNewVehicle(false);
    setNewVehNumber(""); setNewVehMake(""); setNewVehCapacity("");
  }

  async function submit() {
    if (sameHelper) { setErr("Helper 1 and Helper 2 cannot be the same person."); return; }
    setBusy(true); setErr(null);
    const res = await createDispatch({
      invoiceIds: selectedRows.map((r) => r.id),
      vehicleId: vehicleId || null,
      helper1UserId: helper1Id || null,
      helper2UserId: helper2Id || null,
      dispatchDate,
      notes: notes.trim() || null,
    });
    setBusy(false);
    if (!res.ok) { setErr(res.error ?? "Failed"); return; }
    onCreated(res.dispatchId);
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-paper rounded-md max-w-lg w-full shadow-xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-paper-line flex items-center justify-between sticky top-0 bg-paper z-10">
          <h2 className="text-base font-semibold inline-flex items-center gap-2"><Truck size={16} /> Create dispatch</h2>
          <button onClick={onClose} className="text-ink-muted hover:text-ink"><X size={16} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="bg-paper-subtle/40 rounded p-3 text-sm">
            <div><strong>{selectedRows.length}</strong> invoices · <strong>{fmtKg(totalKg)} kg</strong> · <strong>{fmtMoney(totalValue)}</strong></div>
            <div className="text-2xs text-ink-muted mt-1">Beats: {beats.join(", ")}</div>
          </div>
          <label className="block">
            <span className="text-2xs uppercase tracking-wide text-ink-muted font-medium">Dispatch date</span>
            <input type="date" value={dispatchDate} onChange={(e) => setDispatchDate(e.target.value)}
              className="mt-1 h-9 px-2 rounded border border-paper-line bg-paper text-sm w-full" />
          </label>

          {/* Vehicle picker with inline "+ New vehicle" affordance */}
          <div>
            <div className="flex items-center justify-between">
              <span className="text-2xs uppercase tracking-wide text-ink-muted font-medium">Vehicle</span>
              {!showNewVehicle && (
                <button type="button" onClick={() => setShowNewVehicle(true)}
                  className="text-2xs text-accent hover:underline inline-flex items-center gap-1">
                  <Plus size={11} /> New vehicle
                </button>
              )}
            </div>
            <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}
              disabled={showNewVehicle}
              className="mt-1 h-9 px-2 rounded border border-paper-line bg-paper text-sm w-full disabled:opacity-50">
              <option value="">— None —</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.number}{v.make ? ` · ${v.make}` : ""}{v.capacity_kg ? ` · ${v.capacity_kg} kg cap` : ""}
                </option>
              ))}
            </select>
            {overload && !showNewVehicle && (
              <div className="text-2xs text-amber-700 mt-1">⚠ Load ({fmtKg(totalKg)} kg) exceeds vehicle capacity ({vehicle?.capacity_kg} kg)</div>
            )}

            {showNewVehicle && (
              <div className="mt-2 p-3 border border-accent/40 bg-accent/5 rounded space-y-2">
                <div className="text-2xs uppercase tracking-wide text-ink-muted font-medium">Add new vehicle</div>
                <div className="grid grid-cols-2 gap-2">
                  <input type="text" value={newVehNumber} onChange={(e) => setNewVehNumber(e.target.value)}
                    placeholder="Number (e.g. MH 21 X 6268)"
                    className="h-9 px-2 rounded border border-paper-line bg-paper text-sm" />
                  <input type="text" value={newVehMake} onChange={(e) => setNewVehMake(e.target.value)}
                    placeholder="Make (optional)"
                    className="h-9 px-2 rounded border border-paper-line bg-paper text-sm" />
                  <input type="number" value={newVehCapacity} onChange={(e) => setNewVehCapacity(e.target.value)}
                    placeholder="Capacity kg (optional)"
                    className="h-9 px-2 rounded border border-paper-line bg-paper text-sm col-span-2" />
                </div>
                {newVehErr && <div className="text-2xs text-danger">{newVehErr}</div>}
                <div className="flex items-center justify-end gap-2">
                  <button type="button" onClick={() => { setShowNewVehicle(false); setNewVehErr(null); }}
                    className="h-8 px-3 rounded border border-paper-line bg-paper-card text-xs text-ink-muted hover:bg-paper-subtle">
                    Cancel
                  </button>
                  <button type="button" onClick={saveNewVehicle} disabled={savingVehicle || !newVehNumber.trim()}
                    className="h-8 px-3 rounded bg-accent text-white text-xs font-medium hover:bg-accent/90 disabled:opacity-50 inline-flex items-center gap-1">
                    <PackageCheck size={12} /> {savingVehicle ? "Saving…" : "Save vehicle"}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Two helper slots, both optional. Each has a "+ New helper" link
              that reveals a shared inline form; whichever slot opened it is
              where the new helper lands when saved. */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-2xs uppercase tracking-wide text-ink-muted font-medium">Helper 1</span>
                {newHelperTarget !== 1 && (
                  <button type="button" onClick={() => { setNewHelperTarget(1); setNewHelperErr(null); }}
                    className="text-2xs text-accent hover:underline inline-flex items-center gap-1">
                    <Plus size={11} /> New
                  </button>
                )}
              </div>
              <select value={helper1Id} onChange={(e) => setHelper1Id(e.target.value)}
                disabled={newHelperTarget !== null}
                className="mt-1 h-9 px-2 rounded border border-paper-line bg-paper text-sm w-full disabled:opacity-50">
                <option value="">— None —</option>
                {helpers.map((h) => (<option key={h.id} value={h.id}>{h.name}{h.role ? ` · ${h.role}` : ""}</option>))}
              </select>
            </div>
            <div>
              <div className="flex items-center justify-between">
                <span className="text-2xs uppercase tracking-wide text-ink-muted font-medium">Helper 2</span>
                {newHelperTarget !== 2 && (
                  <button type="button" onClick={() => { setNewHelperTarget(2); setNewHelperErr(null); }}
                    className="text-2xs text-accent hover:underline inline-flex items-center gap-1">
                    <Plus size={11} /> New
                  </button>
                )}
              </div>
              <select value={helper2Id} onChange={(e) => setHelper2Id(e.target.value)}
                disabled={newHelperTarget !== null}
                className="mt-1 h-9 px-2 rounded border border-paper-line bg-paper text-sm w-full disabled:opacity-50">
                <option value="">— None —</option>
                {helpers.map((h) => (<option key={h.id} value={h.id}>{h.name}{h.role ? ` · ${h.role}` : ""}</option>))}
              </select>
            </div>
          </div>
          {sameHelper && (
            <div className="text-2xs text-amber-700 -mt-2">Helper 1 and Helper 2 cannot be the same person.</div>
          )}
          {newHelperTarget !== null && (
            <div className="p-3 border border-accent/40 bg-accent/5 rounded space-y-2">
              <div className="text-2xs uppercase tracking-wide text-ink-muted font-medium">
                Add new helper → Helper {newHelperTarget}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input type="text" value={newHelperName} onChange={(e) => setNewHelperName(e.target.value)}
                  placeholder="Name (e.g. Rajesh Dhoke)" autoFocus
                  className="h-9 px-2 rounded border border-paper-line bg-paper text-sm" />
                <input type="text" value={newHelperRole} onChange={(e) => setNewHelperRole(e.target.value)}
                  placeholder="Role (optional, e.g. helper, loader)"
                  className="h-9 px-2 rounded border border-paper-line bg-paper text-sm" />
              </div>
              {newHelperErr && <div className="text-2xs text-danger">{newHelperErr}</div>}
              <div className="flex items-center justify-end gap-2">
                <button type="button" onClick={() => { setNewHelperTarget(null); setNewHelperErr(null); setNewHelperName(""); setNewHelperRole(""); }}
                  className="h-8 px-3 rounded border border-paper-line bg-paper-card text-xs text-ink-muted hover:bg-paper-subtle">
                  Cancel
                </button>
                <button type="button" onClick={saveNewHelper} disabled={savingHelper || !newHelperName.trim()}
                  className="h-8 px-3 rounded bg-accent text-white text-xs font-medium hover:bg-accent/90 disabled:opacity-50 inline-flex items-center gap-1">
                  <PackageCheck size={12} /> {savingHelper ? "Saving…" : "Save helper"}
                </button>
              </div>
            </div>
          )}

          <label className="block">
            <span className="text-2xs uppercase tracking-wide text-ink-muted font-medium">Notes (optional)</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
              placeholder="e.g. deliver Mehkar stops first"
              className="mt-1 px-2 py-1.5 rounded border border-paper-line bg-paper text-sm w-full" />
          </label>
          {err && <div className="text-sm text-danger">{err}</div>}
        </div>
        <div className="px-5 py-3 border-t border-paper-line flex justify-end gap-2 sticky bottom-0 bg-paper">
          <button onClick={onClose} className="h-9 px-4 rounded border border-paper-line bg-paper-card text-sm text-ink-muted hover:bg-paper-subtle">Cancel</button>
          <button onClick={submit}
            disabled={busy || selectedRows.length === 0 || sameHelper || showNewVehicle || newHelperTarget !== null}
            className="h-9 px-4 rounded bg-accent text-white text-sm font-medium hover:bg-accent/90 disabled:opacity-50 inline-flex items-center gap-1.5">
            <PackageCheck size={14} /> {busy ? "Creating…" : "Create & open load list"}
          </button>
        </div>
      </div>
    </div>
  );
}
