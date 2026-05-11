"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  Clock, TrendingDown, Sparkles, Phone, MapPin, ChevronRight, ListChecks,
  type LucideIcon,
} from "lucide-react";
import type { CallListData, CallListRow } from "./page";

type TabKey = "sleeping" | "shrinking" | "new_stuck";

function fmtKg(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0";
  if (n >= 1000) return `${(n / 1000).toFixed(1)}t`;
  return `${n.toFixed(1)}kg`;
}

function fmtRelative(days: number | null): string {
  if (days == null) return "never";
  if (days === 0) return "today";
  if (days === 1) return "1d";
  if (days < 30) return `${days}d`;
  if (days < 365) return `~${Math.round(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

export function CallListClient({ data }: { data: CallListData }) {
  const [tab, setTab] = useState<TabKey>(() => {
    // Default to the bucket with the most items
    if (data.sleeping_total >= data.shrinking_total && data.sleeping_total >= data.new_stuck_total) return "sleeping";
    if (data.shrinking_total >= data.new_stuck_total) return "shrinking";
    return "new_stuck";
  });

  const tabs: Array<{ key: TabKey; label: string; icon: LucideIcon; total: number; description: string }> = [
    { key: "sleeping",  label: "Sleeping",  icon: Clock,         total: data.sleeping_total,  description: "30+ days since last order — ranked by 90-day kg" },
    { key: "shrinking", label: "Shrinking", icon: TrendingDown,  total: data.shrinking_total, description: "Last 30 days down ≥10% vs previous 30 days" },
    { key: "new_stuck", label: "New stuck", icon: Sparkles,      total: data.new_stuck_total, description: "Onboarded in last 90 days, ≤2 orders, no recent activity" },
  ];

  const rows = data[tab] as CallListRow[];

  const emptyMessage = useMemo(() => {
    switch (tab) {
      case "sleeping":  return "No sleeping customers — everyone has ordered recently.";
      case "shrinking": return "No shrinking customers — orders are holding steady or growing.";
      case "new_stuck": return "No stuck new customers — recent onboards are engaged.";
    }
  }, [tab]);

  return (
    <div className="min-h-screen bg-paper pb-12">
      <div className="max-w-4xl mx-auto px-3 py-4 lg:px-6 lg:py-6">

        <div className="mb-4">
          <h1 className="text-lg lg:text-xl font-semibold leading-tight inline-flex items-center gap-2">
            <ListChecks size={18} className="text-accent"/>
            Call list
          </h1>
          <p className="text-xs text-ink-muted mt-0.5">
            Customers worth a call this week
            {data.is_override && (
              <span className="ml-2 text-accent font-medium">
                (viewing as another user)
              </span>
            )}
          </p>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 mb-3 overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
          {tabs.map(t => {
            const active = t.key === tab;
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`px-3 py-1.5 text-xs rounded-md whitespace-nowrap transition-colors inline-flex items-center gap-1.5 ${
                  active
                    ? "bg-accent text-paper-card font-semibold"
                    : "bg-paper-card border border-paper-line text-ink-muted hover:bg-paper-subtle"
                }`}
              >
                <Icon size={12}/>
                {t.label}
                <span className={`tabular ${active ? "opacity-90" : "opacity-60"}`}>
                  {t.total}
                </span>
              </button>
            );
          })}
        </div>

        <p className="text-2xs text-ink-muted mb-3">
          {tabs.find(t => t.key === tab)?.description}
        </p>

        {/* Cards (mobile) / table (desktop) */}
        {rows.length === 0 ? (
          <div className="bg-paper-card border border-paper-line rounded-md p-8 text-center text-sm text-ink-muted">
            {emptyMessage}
          </div>
        ) : (
          <>
            {/* Mobile: card list */}
            <div className="lg:hidden space-y-2">
              {rows.map(r => <CallCardMobile key={r.id} row={r} tab={tab}/>)}
            </div>

            {/* Desktop: table */}
            <div className="hidden lg:block bg-paper-card border border-paper-line rounded-md overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-paper-subtle/50 border-b border-paper-line">
                  <tr className="text-left text-2xs uppercase tracking-wide text-ink-muted">
                    <th className="px-3 py-2 font-medium">Customer</th>
                    <th className="px-3 py-2 font-medium">Beat</th>
                    <th className="px-3 py-2 font-medium text-right">30d kg</th>
                    <th className="px-3 py-2 font-medium text-right">
                      {tab === "shrinking" ? "vs prev" : "90d kg"}
                    </th>
                    <th className="px-3 py-2 font-medium text-right">
                      {tab === "new_stuck" ? "Age" : "Last order"}
                    </th>
                    <th className="px-3 py-2 w-6"/>
                  </tr>
                </thead>
                <tbody className="divide-y divide-paper-line">
                  {rows.map(r => <CallRowDesktop key={r.id} row={r} tab={tab}/>)}
                </tbody>
              </table>
            </div>

            {(data[`${tab}_total` as `${TabKey}_total`] as number) > rows.length && (
              <p className="text-2xs text-ink-subtle mt-3 text-center">
                Showing top {rows.length} of {data[`${tab}_total` as `${TabKey}_total`]}.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ---------- Mobile card ----------

function CallCardMobile({ row, tab }: { row: CallListRow; tab: TabKey }) {
  return (
    <Link
      href={`/insights/customers/${row.id}`}
      className="block bg-paper-card border border-paper-line rounded-md p-3 hover:bg-paper-subtle/40 active:bg-paper-subtle"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-medium text-sm truncate">{row.name}</div>
          <div className="text-2xs text-ink-muted flex items-center gap-2 flex-wrap mt-0.5">
            {row.beat_name && (
              <span className="inline-flex items-center gap-1"><MapPin size={9}/>{row.beat_name}</span>
            )}
            {row.city && <span>· {row.city}</span>}
            {row.mobile && (
              <>
                <span>·</span>
                <span className="inline-flex items-center gap-0.5"><Phone size={9}/>{row.mobile}</span>
              </>
            )}
          </div>
        </div>
        <ChevronRight size={14} className="text-ink-subtle shrink-0"/>
      </div>

      <div className="mt-2 grid grid-cols-3 gap-2 text-2xs">
        <SignalCellMobile tab={tab} row={row}/>
      </div>
    </Link>
  );
}

function SignalCellMobile({ tab, row }: { tab: TabKey; row: CallListRow }) {
  if (tab === "sleeping") {
    return (
      <>
        <Tile label="Last order" value={fmtRelative(row.days_since_last_order)} accent="warn"/>
        <Tile label="90d kg" value={fmtKg(Number(row.kg_90d))}/>
        <Tile label="Lifetime orders" value={String(row.order_count)}/>
      </>
    );
  }
  if (tab === "shrinking") {
    return (
      <>
        <Tile label="Last 30d" value={fmtKg(Number(row.kg_30d))}/>
        <Tile label="Prev 30d" value={fmtKg(Number(row.kg_prev_30d))}/>
        <Tile label="Change" value={`${row.growth_pct.toFixed(0)}%`} accent="danger"/>
      </>
    );
  }
  // new_stuck
  return (
    <>
      <Tile label="Customer age" value={fmtRelative(row.days_since_created)}/>
      <Tile label="Orders" value={String(row.order_count)} accent="warn"/>
      <Tile label="Last order" value={fmtRelative(row.days_since_last_order)}/>
    </>
  );
}

function Tile({ label, value, accent }: { label: string; value: string; accent?: "warn" | "danger" }) {
  const color = accent === "warn" ? "text-warn" : accent === "danger" ? "text-danger" : "text-ink";
  return (
    <div>
      <div className="text-2xs uppercase tracking-wide text-ink-muted truncate">{label}</div>
      <div className={`font-bold tabular ${color}`}>{value}</div>
    </div>
  );
}

// ---------- Desktop row ----------

function CallRowDesktop({ row, tab }: { row: CallListRow; tab: TabKey }) {
  return (
    <tr className="hover:bg-paper-subtle/30 group">
      <td className="px-3 py-2.5">
        <Link href={`/insights/customers/${row.id}`} className="font-medium hover:text-accent hover:underline">
          {row.name}
        </Link>
        <div className="text-2xs text-ink-muted flex items-center gap-2 flex-wrap mt-0.5">
          {row.city && <span>{row.city}</span>}
          {row.mobile && (
            <a
              href={`tel:${row.mobile}`}
              className="inline-flex items-center gap-0.5 text-accent hover:underline"
            >
              <Phone size={9}/> {row.mobile}
            </a>
          )}
        </div>
      </td>
      <td className="px-3 py-2.5 text-ink-muted text-xs">
        {row.beat_name ?? "—"}
      </td>
      <td className="px-3 py-2.5 text-right tabular font-semibold">
        {fmtKg(Number(row.kg_30d))}
      </td>
      <td className="px-3 py-2.5 text-right tabular">
        {tab === "shrinking" ? (
          <span className="text-danger font-semibold">{row.growth_pct.toFixed(0)}%</span>
        ) : (
          <span className="text-ink-muted">{fmtKg(Number(row.kg_90d))}</span>
        )}
      </td>
      <td className="px-3 py-2.5 text-right">
        {tab === "new_stuck" ? (
          <span className="text-2xs tabular text-ink-muted">{fmtRelative(row.days_since_created)} old</span>
        ) : (
          <span className={`text-2xs tabular inline-flex items-center gap-0.5 ${
            (row.days_since_last_order ?? 999) >= 30 ? "text-warn font-semibold" : "text-ink-muted"
          }`}>
            {(row.days_since_last_order ?? 999) >= 30 && <Clock size={9}/>}
            {fmtRelative(row.days_since_last_order)}
          </span>
        )}
      </td>
      <td className="px-3 py-2.5">
        <Link
          href={`/insights/customers/${row.id}`}
          className="text-ink-subtle group-hover:text-accent inline-flex"
          aria-label="Open customer detail"
        >
          <ChevronRight size={14}/>
        </Link>
      </td>
    </tr>
  );
}
