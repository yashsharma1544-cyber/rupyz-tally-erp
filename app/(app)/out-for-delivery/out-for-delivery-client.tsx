"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, ChevronDown, Search, X } from "lucide-react";
import { fetchInvoiceLines } from "./actions";

export type InvoiceRow = {
  id: string;
  voucher_no: string;
  voucher_date: string;
  voucher_type: string;
  party_name: string;
  party_group: string | null;
  total_amount: number;
  tax: number;
};

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
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "2-digit", timeZone: "UTC",
  });
}

function fmtMoney(n: number): string {
  return "₹" + (Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function fmtKg(n: number | null): string {
  if (n == null) return "—";
  return (Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

export function OutForDeliveryClient({
  rows,
  parties,
  filters,
  periodCount,
  periodValue,
  totalCount,
}: {
  rows: InvoiceRow[];
  parties: string[];
  filters: { from: string | null; to: string | null; party: string | null; q: string | null };
  periodCount: number;
  periodValue: number;
  totalCount: number;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [linesCache, setLinesCache] = useState<Record<string, LineRow[]>>({});
  const [loadingLines, setLoadingLines] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState(filters.q ?? "");

  function setParam(name: string, value: string | null) {
    const sp = new URLSearchParams(searchParams.toString());
    if (value && value.trim()) sp.set(name, value);
    else sp.delete(name);
    router.push(`/out-for-delivery?${sp.toString()}`);
  }

  function clearFilters() {
    router.push("/out-for-delivery");
    setSearchInput("");
  }

  function onSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    setParam("q", searchInput);
  }

  async function toggleExpand(id: string) {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (!linesCache[id]) {
      setLoadingLines(id);
      const lines = await fetchInvoiceLines(id);
      setLinesCache((prev) => ({ ...prev, [id]: lines }));
      setLoadingLines(null);
    }
  }

  const anyFilter = filters.from || filters.to || filters.party || filters.q;

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Outstation invoices" value={totalCount.toLocaleString("en-IN")} sub="Anjali Agency, FY26-27 · OCS" />
        <Kpi label="Shown here" value={periodCount.toLocaleString("en-IN")} sub={anyFilter ? "matches filter" : "most recent"} />
        <Kpi label="Value (shown)" value={fmtMoney(periodValue)} sub="before tax" />
        <Kpi label="Parties" value={parties.length.toLocaleString("en-IN")} sub="distinct customers" />
      </div>

      {/* Filter bar */}
      <div className="bg-paper-card border border-paper-line rounded-md p-3 md:p-4">
        <div className="flex flex-wrap items-end gap-3">
          <form onSubmit={onSearchSubmit} className="flex items-end gap-2">
            <label className="block">
              <span className="text-2xs uppercase tracking-wide text-ink-muted font-medium">Search party / invoice</span>
              <div className="mt-1 relative">
                <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-subtle" />
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="e.g. Pooja Treaders or 0138"
                  className="h-9 pl-7 pr-2 w-64 rounded border border-paper-line bg-paper text-sm"
                />
              </div>
            </label>
            <button
              type="submit"
              className="h-9 px-3 rounded bg-accent text-white text-sm font-medium hover:bg-accent/90"
            >
              Apply
            </button>
          </form>

          <label className="block">
            <span className="text-2xs uppercase tracking-wide text-ink-muted font-medium">Party</span>
            <select
              value={filters.party ?? ""}
              onChange={(e) => setParam("party", e.target.value || null)}
              className="mt-1 h-9 px-2 rounded border border-paper-line bg-paper text-sm w-48"
            >
              <option value="">All parties</option>
              {parties.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-2xs uppercase tracking-wide text-ink-muted font-medium">From</span>
            <input
              type="date"
              value={filters.from ?? ""}
              onChange={(e) => setParam("from", e.target.value || null)}
              className="mt-1 h-9 px-2 rounded border border-paper-line bg-paper text-sm"
            />
          </label>
          <label className="block">
            <span className="text-2xs uppercase tracking-wide text-ink-muted font-medium">To</span>
            <input
              type="date"
              value={filters.to ?? ""}
              onChange={(e) => setParam("to", e.target.value || null)}
              className="mt-1 h-9 px-2 rounded border border-paper-line bg-paper text-sm"
            />
          </label>

          {anyFilter && (
            <button
              onClick={clearFilters}
              className="h-9 px-3 rounded border border-paper-line bg-paper-card text-sm text-ink-muted hover:bg-paper-subtle inline-flex items-center gap-1"
            >
              <X size={14} /> Clear
            </button>
          )}
        </div>
      </div>

      {/* Invoice list */}
      <div className="bg-paper-card border border-paper-line rounded-md overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-paper-subtle/60 border-b border-paper-line">
              <tr className="text-left text-2xs uppercase tracking-wide text-ink-muted">
                <th className="px-3 py-2.5 font-medium w-8"></th>
                <th className="px-3 py-2.5 font-medium">Date</th>
                <th className="px-3 py-2.5 font-medium">Invoice #</th>
                <th className="px-3 py-2.5 font-medium">Party</th>
                <th className="px-3 py-2.5 font-medium">Type</th>
                <th className="px-3 py-2.5 font-medium text-right">Tax</th>
                <th className="px-3 py-2.5 font-medium text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-paper-line">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-sm text-ink-muted">
                    No invoices match the current filters.
                  </td>
                </tr>
              )}
              {rows.map((r) => {
                const isOpen = expandedId === r.id;
                return (
                  <>
                    <tr
                      key={r.id}
                      onClick={() => toggleExpand(r.id)}
                      className={`cursor-pointer hover:bg-paper-subtle/40 ${isOpen ? "bg-paper-subtle/30" : ""}`}
                    >
                      <td className="px-3 py-2.5 text-ink-subtle">
                        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </td>
                      <td className="px-3 py-2.5 tabular whitespace-nowrap">{fmtDate(r.voucher_date)}</td>
                      <td className="px-3 py-2.5 font-mono text-xs">{r.voucher_no || "—"}</td>
                      <td className="px-3 py-2.5">
                        <div className="font-medium">{r.party_name}</div>
                        {r.party_group && (
                          <div className="text-2xs text-ink-subtle">{r.party_group}</div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-2xs text-ink-muted whitespace-nowrap">{r.voucher_type}</td>
                      <td className="px-3 py-2.5 text-right tabular text-ink-muted">{r.tax > 0 ? fmtMoney(r.tax) : "—"}</td>
                      <td className="px-3 py-2.5 text-right tabular font-semibold">{fmtMoney(r.total_amount)}</td>
                    </tr>
                    {isOpen && (
                      <tr key={`${r.id}-lines`}>
                        <td colSpan={7} className="px-3 py-3 bg-paper-subtle/20">
                          {loadingLines === r.id ? (
                            <div className="text-sm text-ink-muted">Loading line items…</div>
                          ) : (
                            <LinesTable lines={linesCache[r.id] ?? []} />
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
        {rows.length === 500 && (
          <div className="px-3 py-2 text-2xs text-ink-subtle border-t border-paper-line bg-paper-subtle/30">
            Showing first 500 — narrow the filters to see more.
          </div>
        )}
      </div>
    </div>
  );
}

function LinesTable({ lines }: { lines: LineRow[] }) {
  if (lines.length === 0) {
    return <div className="text-sm text-ink-muted">No line items.</div>;
  }
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
