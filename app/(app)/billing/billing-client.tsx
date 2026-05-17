"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Receipt, Search, Calendar, Check, AlertCircle, Edit2, X, Loader2,
  ChevronRight,
} from "lucide-react";
import { setInvoiceNumberAction, clearInvoiceNumberAction } from "./actions";
import type { BillingRow } from "./page";

type Props = {
  queue: BillingRow[];
  invoiced: BillingRow[];
  role: "admin" | "billing";
  filters: { q: string; from: string; to: string; show: string };
};

function fmtMoney(n: number): string {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric", month: "short",
    hour: "2-digit", minute: "2-digit",
  });
}

export function BillingClient({ queue, invoiced, role, filters }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [q, setQ] = useState(filters.q);
  const [from, setFrom] = useState(filters.from);
  const [to, setTo] = useState(filters.to);
  const [show, setShow] = useState(filters.show);

  function applyFilters() {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (show && show !== "queue") params.set("show", show);
    router.push(`/billing?${params.toString()}`);
  }

  function resetFilters() {
    router.push("/billing");
  }

  return (
    <div className="min-h-screen bg-paper">
      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
          <div>
            <h1 className="text-xl font-semibold leading-tight flex items-center gap-2">
              <Receipt size={18} className="text-accent" /> Billing
            </h1>
            <p className="text-sm text-ink-muted">
              Enter invoice numbers from Tally to advance approved orders to loading.
            </p>
          </div>
          <span className="text-2xs px-2 py-1 rounded-full bg-paper-subtle text-ink-muted">
            Signed in as <strong>{role}</strong>
          </span>
        </div>

        {/* Summary tiles */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4 mb-5">
          <div className="bg-paper-card border border-paper-line rounded-md p-3">
            <div className="text-2xs uppercase text-ink-muted">Awaiting invoice</div>
            <div className={`text-2xl font-bold tabular ${queue.length > 0 ? "text-accent" : ""}`}>
              {queue.length}
            </div>
            <div className="text-2xs text-ink-subtle">orders queued</div>
          </div>
          <div className="bg-paper-card border border-paper-line rounded-md p-3">
            <div className="text-2xs uppercase text-ink-muted">Total awaiting value</div>
            <div className="text-2xl font-bold tabular">
              ₹{fmtMoney(queue.reduce((s, r) => s + r.total_amount, 0))}
            </div>
            <div className="text-2xs text-ink-subtle">approved &amp; pending</div>
          </div>
          <div className="bg-paper-card border border-paper-line rounded-md p-3">
            <div className="text-2xs uppercase text-ink-muted">Recently invoiced</div>
            <div className="text-2xl font-bold tabular">{invoiced.length}</div>
            <div className="text-2xs text-ink-subtle">
              {filters.show === "queue" ? "hidden" : `${filters.from} → ${filters.to}`}
            </div>
          </div>
        </div>

        {/* Filter bar */}
        <div className="bg-paper-card border border-paper-line rounded-md p-3 mb-5">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
            <div className="relative">
              <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-subtle" />
              <input
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Customer / order / invoice #"
                className="text-xs border border-paper-line rounded pl-7 pr-2 py-1.5 bg-white w-full"
                onKeyDown={(e) => e.key === "Enter" && applyFilters()}
              />
            </div>
            <div className="flex items-center gap-1">
              <Calendar size={11} className="text-ink-subtle" />
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="text-xs border border-paper-line rounded px-2 py-1.5 bg-white flex-1"
              />
              <span className="text-ink-subtle text-xs">→</span>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="text-xs border border-paper-line rounded px-2 py-1.5 bg-white flex-1"
              />
            </div>
            <select
              value={show}
              onChange={(e) => setShow(e.target.value)}
              className="text-xs border border-paper-line rounded px-2 py-1.5 bg-white"
            >
              <option value="queue">Awaiting only</option>
              <option value="invoiced">Awaiting + recently invoiced</option>
              <option value="all">Awaiting + all later statuses</option>
            </select>
            <div className="flex items-center gap-2">
              <button
                onClick={applyFilters}
                className="text-xs px-3 py-1.5 bg-accent text-white rounded hover:bg-accent/90"
              >
                Apply
              </button>
              <button
                onClick={resetFilters}
                className="text-xs px-3 py-1.5 border border-paper-line rounded hover:bg-paper-subtle"
              >
                Reset
              </button>
            </div>
          </div>
        </div>

        {/* Queue */}
        <h2 className="text-sm font-semibold mb-2 mt-2">Awaiting invoice</h2>
        <QueueTable rows={queue} mode="queue" />

        {/* Invoiced reference */}
        {filters.show !== "queue" && (
          <>
            <h2 className="text-sm font-semibold mb-2 mt-6">
              {filters.show === "all" ? "Already invoiced (any later status)" : "Already invoiced"}
            </h2>
            <QueueTable rows={invoiced} mode="invoiced" />
          </>
        )}

        <p className="text-2xs text-ink-subtle mt-4">
          Type the Tally invoice number and press Save (or Enter). The order advances to
          <code className="px-1 mx-1 rounded bg-paper-subtle">invoiced</code> and becomes
          eligible for loading. Edit a typo until loading starts; after that the invoice
          number is locked.
        </p>
      </div>
    </div>
  );
}

function QueueTable({ rows, mode }: { rows: BillingRow[]; mode: "queue" | "invoiced" }) {
  if (rows.length === 0) {
    return (
      <div className="border border-paper-line rounded-md p-6 text-center text-sm text-ink-subtle bg-paper-card">
        {mode === "queue"
          ? "No orders awaiting invoice. ✓"
          : "No invoiced orders in this range."}
      </div>
    );
  }
  return (
    <div className="border border-paper-line rounded-md bg-paper-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-paper-subtle text-2xs uppercase text-ink-muted">
            <tr>
              <th className="text-left  px-3 py-2 font-medium">Order #</th>
              <th className="text-left  px-3 py-2 font-medium">Customer</th>
              <th className="text-right px-3 py-2 font-medium">Total (₹)</th>
              <th className="text-left  px-3 py-2 font-medium">
                {mode === "queue" ? "Approved" : "Invoiced"}
              </th>
              <th className="text-left  px-3 py-2 font-medium">Invoice #</th>
              <th className="text-right px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-paper-line">
            {rows.map((r) => (
              <BillingRowItem key={r.id} row={r} mode={mode} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BillingRowItem({ row, mode }: { row: BillingRow; mode: "queue" | "invoiced" }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [editing, setEditing] = useState(mode === "queue");
  const [value, setValue] = useState(row.invoice_number ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const locked = mode === "invoiced" && row.app_status !== "invoiced";

  async function save() {
    if (!value.trim()) {
      setError("Enter the invoice number");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await setInvoiceNumberAction(row.id, value);
      if (!res.ok) {
        setError(res.error || "Failed");
      } else {
        startTransition(() => router.refresh());
        setEditing(false);
      }
    } finally {
      setBusy(false);
    }
  }

  async function clearInvoice() {
    if (!confirm("Clear the invoice number? The order will return to 'approved'.")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await clearInvoiceNumberAction(row.id);
      if (!res.ok) {
        setError(res.error || "Failed");
      } else {
        startTransition(() => router.refresh());
        setValue("");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className={`hover:bg-paper-subtle/30 ${mode === "queue" ? "bg-warn/5" : ""}`}>
      <td className="px-3 py-2 text-xs font-mono">{row.rupyz_order_id}</td>
      <td className="px-3 py-2 text-xs">
        <div className="font-medium">{row.customer_name}</div>
      </td>
      <td className="px-3 py-2 text-xs text-right tabular font-medium">
        {fmtMoney(row.total_amount)}
      </td>
      <td className="px-3 py-2 text-xs tabular text-ink-muted">
        {fmtDate(mode === "queue" ? row.approved_at : row.invoiced_at)}
      </td>
      <td className="px-3 py-2 text-xs">
        {editing && !locked ? (
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
                if (e.key === "Escape" && row.invoice_number) {
                  setEditing(false);
                  setValue(row.invoice_number);
                  setError(null);
                }
              }}
              placeholder="e.g. SAJ-26-0142"
              className="text-xs border border-paper-line rounded px-2 py-1 bg-white w-36 focus:outline-none focus:border-accent"
              autoFocus={mode === "invoiced"}
              disabled={busy}
            />
            <button
              onClick={save}
              disabled={busy}
              className="text-2xs px-2 py-1 bg-accent text-white rounded hover:bg-accent/90 disabled:opacity-50 inline-flex items-center gap-1"
            >
              {busy ? <Loader2 size={9} className="animate-spin" /> : <Check size={10} />}
              Save
            </button>
            {row.invoice_number && (
              <button
                onClick={() => {
                  setEditing(false);
                  setValue(row.invoice_number ?? "");
                  setError(null);
                }}
                disabled={busy}
                className="text-2xs px-1.5 py-1 border border-paper-line rounded hover:bg-paper-subtle"
                title="Cancel"
              >
                <X size={10} />
              </button>
            )}
            {error && (
              <span className="text-2xs text-danger ml-1 inline-flex items-center gap-1">
                <AlertCircle size={9} /> {error}
              </span>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <span className="font-mono">{row.invoice_number}</span>
            {!locked && (
              <>
                <button
                  onClick={() => { setEditing(true); setError(null); }}
                  className="text-ink-subtle hover:text-ink"
                  title="Edit"
                >
                  <Edit2 size={10} />
                </button>
                <button
                  onClick={clearInvoice}
                  disabled={busy}
                  className="text-ink-subtle hover:text-danger"
                  title="Clear (revert to approved)"
                >
                  <X size={10} />
                </button>
              </>
            )}
            {locked && (
              <span className="text-2xs text-ink-subtle ml-1">locked ({row.app_status})</span>
            )}
            {row.invoiced_by_name && (
              <span className="text-2xs text-ink-subtle ml-1">by {row.invoiced_by_name}</span>
            )}
          </div>
        )}
      </td>
      <td className="px-3 py-2 text-right">
        <Link
          href={`/orders/${row.id}`}
          className="inline-flex items-center text-2xs text-accent hover:underline"
        >
          Detail <ChevronRight size={11} />
        </Link>
      </td>
    </tr>
  );
}
