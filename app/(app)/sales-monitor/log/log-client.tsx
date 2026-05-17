"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, RefreshCw, FileText, AlertCircle, Check, Clock,
  Loader2, ExternalLink, XCircle,
} from "lucide-react";
import { retryReport, getPdfSignedUrl } from "./actions";
import type { LogRow, SalesmanOpt } from "./page";

type Props = {
  logs: LogRow[];
  salesmen: SalesmanOpt[];
  filters: {
    from: string;
    to: string;
    salesman: string;
    type: string;
    status: string;
  };
  todayCounts: { sent: number; failed: number; pending: number; total: number };
  todayISO: string;
};

export function LogClient({ logs, salesmen, filters, todayCounts, todayISO }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  // Local filter state — applied on Apply or Enter
  const [from, setFrom] = useState(filters.from);
  const [to, setTo] = useState(filters.to);
  const [salesman, setSalesman] = useState(filters.salesman);
  const [type, setType] = useState(filters.type);
  const [status, setStatus] = useState(filters.status);

  const [retrying, setRetrying] = useState<Set<string>>(new Set());
  const [opening, setOpening] = useState<Set<string>>(new Set());
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<Date>(new Date());

  // Auto-refresh: every 30 seconds, refresh server data
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => {
      startTransition(() => {
        router.refresh();
        setRefreshedAt(new Date());
      });
    }, 30_000);
    return () => clearInterval(id);
  }, [autoRefresh, router]);

  function applyFilters() {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (salesman) params.set("salesman", salesman);
    if (type) params.set("type", type);
    if (status) params.set("status", status);
    router.push(`/sales-monitor/log?${params.toString()}`);
  }

  function resetFilters() {
    router.push("/sales-monitor/log");
  }

  function quickFilter(s: string) {
    setStatus(s);
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (salesman) params.set("salesman", salesman);
    if (type) params.set("type", type);
    if (s) params.set("status", s);
    router.push(`/sales-monitor/log?${params.toString()}`);
  }

  async function handleRetry(row: LogRow) {
    const key = `${row.id}`;
    setRetrying((prev) => new Set(prev).add(key));
    try {
      const res = await retryReport(row.salesman_id, row.report_date, row.report_type);
      if (res.ok) {
        startTransition(() => router.refresh());
      } else {
        alert(`Retry failed: ${res.error}`);
      }
    } catch (e) {
      alert(`Retry error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRetrying((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  async function handleViewPdf(row: LogRow) {
    const key = `${row.id}`;
    setOpening((prev) => new Set(prev).add(key));
    try {
      const res = await getPdfSignedUrl(row.salesman_id, row.report_date, row.report_type);
      if (res.ok && res.url) {
        window.open(res.url, "_blank", "noopener,noreferrer");
      } else {
        alert(`Couldn't open PDF: ${res.error}`);
      }
    } catch (e) {
      alert(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setOpening((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  function manualRefresh() {
    startTransition(() => {
      router.refresh();
      setRefreshedAt(new Date());
    });
  }

  return (
    <div className="min-h-screen bg-paper">
      <div className="max-w-6xl mx-auto px-4 py-6">
        <Link
          href="/sales-monitor"
          className="text-xs text-ink-muted hover:text-ink inline-flex items-center gap-1 mb-3"
        >
          <ArrowLeft size={11} /> Sales Monitor
        </Link>

        <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
          <div>
            <h1 className="text-xl font-semibold leading-tight">Send Log</h1>
            <p className="text-sm text-ink-muted">
              Audit trail for daily report sends. Click failed rows to retry.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={manualRefresh}
              className="text-2xs px-2 py-1 border border-paper-line rounded hover:bg-paper-subtle inline-flex items-center gap-1"
              title="Refresh now"
            >
              <RefreshCw size={11} />
              Refresh
            </button>
            <label className="text-2xs text-ink-muted inline-flex items-center gap-1 cursor-pointer">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="cursor-pointer"
              />
              Auto-refresh (30s)
            </label>
          </div>
        </div>
        <div className="text-2xs text-ink-subtle mb-5">
          Last refreshed: {refreshedAt.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })}
        </div>

        {/* Today's snapshot — quick-filter buttons */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 mb-5">
          <button
            onClick={() => quickFilter("")}
            className="text-left bg-paper-card border border-paper-line rounded-md p-3 hover:bg-paper-subtle transition-colors"
          >
            <div className="text-2xs uppercase tracking-wide text-ink-muted mb-1">Today total</div>
            <div className="text-lg font-bold tabular">{todayCounts.total}</div>
          </button>
          <button
            onClick={() => quickFilter("sent")}
            className="text-left bg-paper-card border border-paper-line rounded-md p-3 hover:bg-accent/5 transition-colors"
          >
            <div className="text-2xs uppercase tracking-wide text-ink-muted mb-1 flex items-center gap-1">
              <Check size={9} className="text-accent" /> Sent
            </div>
            <div className="text-lg font-bold tabular text-accent">{todayCounts.sent}</div>
          </button>
          <button
            onClick={() => quickFilter("failed")}
            className={`text-left bg-paper-card border rounded-md p-3 hover:bg-danger/5 transition-colors ${
              todayCounts.failed > 0 ? "border-danger/40" : "border-paper-line"
            }`}
          >
            <div className="text-2xs uppercase tracking-wide text-ink-muted mb-1 flex items-center gap-1">
              <XCircle size={9} className={todayCounts.failed > 0 ? "text-danger" : "text-ink-subtle"} /> Failed
            </div>
            <div className={`text-lg font-bold tabular ${todayCounts.failed > 0 ? "text-danger" : ""}`}>
              {todayCounts.failed}
            </div>
          </button>
          <button
            onClick={() => quickFilter("pending")}
            className="text-left bg-paper-card border border-paper-line rounded-md p-3 hover:bg-warn/5 transition-colors"
          >
            <div className="text-2xs uppercase tracking-wide text-ink-muted mb-1 flex items-center gap-1">
              <Clock size={9} className="text-warn" /> Pending
            </div>
            <div className="text-lg font-bold tabular text-warn">{todayCounts.pending}</div>
          </button>
        </div>

        {/* Filter bar */}
        <div className="bg-paper-card border border-paper-line rounded-md p-3 mb-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            <div>
              <label className="text-2xs uppercase text-ink-muted block mb-1">From</label>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="text-xs border border-paper-line rounded px-2 py-1.5 bg-white w-full"
              />
            </div>
            <div>
              <label className="text-2xs uppercase text-ink-muted block mb-1">To</label>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="text-xs border border-paper-line rounded px-2 py-1.5 bg-white w-full"
              />
            </div>
            <div>
              <label className="text-2xs uppercase text-ink-muted block mb-1">Salesman</label>
              <select
                value={salesman}
                onChange={(e) => setSalesman(e.target.value)}
                className="text-xs border border-paper-line rounded px-2 py-1.5 bg-white w-full"
              >
                <option value="">All</option>
                {salesmen.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-2xs uppercase text-ink-muted block mb-1">Type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="text-xs border border-paper-line rounded px-2 py-1.5 bg-white w-full"
              >
                <option value="">All</option>
                <option value="morning">Morning</option>
                <option value="midday">Mid-day</option>
                <option value="evening">Evening</option>
              </select>
            </div>
            <div>
              <label className="text-2xs uppercase text-ink-muted block mb-1">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="text-xs border border-paper-line rounded px-2 py-1.5 bg-white w-full"
              >
                <option value="">All</option>
                <option value="sent">Sent</option>
                <option value="failed">Failed</option>
                <option value="pending">Pending</option>
              </select>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-3">
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
            <span className="text-2xs text-ink-subtle ml-auto">
              Showing {logs.length} row{logs.length === 1 ? "" : "s"} for {filters.from} → {filters.to}
            </span>
          </div>
        </div>

        {/* Log table */}
        <div className="border border-paper-line rounded-md bg-paper-card overflow-hidden">
          {logs.length === 0 ? (
            <div className="px-3 py-12 text-center text-sm text-ink-muted">
              No sends in this range.
              <p className="text-2xs text-ink-subtle mt-2">
                Try widening the date range, removing filters, or checking back after the next cron run.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-paper-subtle text-2xs uppercase text-ink-muted">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Date</th>
                    <th className="text-left px-3 py-2 font-medium">Salesman</th>
                    <th className="text-left px-3 py-2 font-medium">Type</th>
                    <th className="text-left px-3 py-2 font-medium">Status</th>
                    <th className="text-left px-3 py-2 font-medium">Sent at (IST)</th>
                    <th className="text-left px-3 py-2 font-medium">Tries</th>
                    <th className="text-left px-3 py-2 font-medium">Error</th>
                    <th className="text-right px-3 py-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-paper-line">
                  {logs.map((row) => {
                    const isToday = row.report_date === todayISO;
                    const isRetrying = retrying.has(row.id);
                    const isOpening = opening.has(row.id);
                    return (
                      <tr
                        key={row.id}
                        className={`hover:bg-paper-subtle/30 ${
                          row.status === "failed" ? "bg-danger/5" : ""
                        }`}
                      >
                        <td className="px-3 py-2 text-xs">
                          <div>{row.report_date}</div>
                          {isToday && (
                            <div className="text-2xs text-accent font-medium">today</div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          <Link
                            href={`/sales-monitor/${row.salesman_id}?date=${row.report_date}`}
                            className="font-medium hover:underline"
                          >
                            {row.salesman_name}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-xs capitalize">{row.report_type}</td>
                        <td className="px-3 py-2 text-xs">
                          <StatusBadge status={row.status} />
                        </td>
                        <td className="px-3 py-2 text-xs tabular text-ink-muted">
                          {row.sent_at
                            ? new Date(row.sent_at).toLocaleString("en-IN", {
                                timeZone: "Asia/Kolkata",
                                hour: "2-digit", minute: "2-digit",
                                day: "numeric", month: "short",
                              })
                            : "—"}
                        </td>
                        <td className="px-3 py-2 text-xs tabular">{row.attempts}</td>
                        <td className="px-3 py-2 text-2xs text-danger max-w-[280px]">
                          {row.error_message ? (
                            <span title={row.error_message} className="line-clamp-2 break-words">
                              {row.error_message}
                            </span>
                          ) : (
                            <span className="text-ink-subtle">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="inline-flex items-center gap-1">
                            {row.status === "sent" && (
                              <button
                                onClick={() => handleViewPdf(row)}
                                disabled={isOpening}
                                title="Open PDF"
                                className="inline-flex items-center gap-1 text-2xs px-2 py-1 border border-paper-line rounded hover:bg-paper-subtle disabled:opacity-50"
                              >
                                {isOpening ? (
                                  <Loader2 size={10} className="animate-spin" />
                                ) : (
                                  <FileText size={10} />
                                )}
                                PDF
                              </button>
                            )}
                            {(row.status === "failed" || row.status === "pending") && (
                              <button
                                onClick={() => handleRetry(row)}
                                disabled={isRetrying}
                                title="Retry send"
                                className="inline-flex items-center gap-1 text-2xs px-2 py-1 bg-accent text-white rounded hover:bg-accent/90 disabled:opacity-50"
                              >
                                {isRetrying ? (
                                  <Loader2 size={10} className="animate-spin" />
                                ) : (
                                  <RefreshCw size={10} />
                                )}
                                Retry
                              </button>
                            )}
                            <Link
                              href={`/sales-monitor/${row.salesman_id}?date=${row.report_date}`}
                              title="Open detail"
                              className="inline-flex items-center text-2xs px-1.5 py-1 border border-paper-line rounded hover:bg-paper-subtle"
                            >
                              <ExternalLink size={10} />
                            </Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p className="text-2xs text-ink-subtle mt-3">
          Cron fires at 9:55 AM IST (morning), 1:00 PM (mid-day), 7:30 PM (evening).
          Coordinator reminder at 9:30 AM is not logged here. Failed sends can be retried —
          attempts counter increments each time. The PDF link generates a 10-minute signed URL.
        </p>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: "sent" | "failed" | "pending" }) {
  if (status === "sent") {
    return (
      <span className="inline-flex items-center gap-1 text-2xs px-2 py-0.5 rounded-full bg-accent/10 text-accent font-medium">
        <Check size={10} /> sent
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-1 text-2xs px-2 py-0.5 rounded-full bg-danger/10 text-danger font-medium">
        <XCircle size={10} /> failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-2xs px-2 py-0.5 rounded-full bg-warn/10 text-warn font-medium">
      <Clock size={10} /> pending
    </span>
  );
}
