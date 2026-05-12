"use client";

import Link from "next/link";
import {
  ArrowLeft, Package, MapPin, Phone, Users, TrendingUp, TrendingDown, Minus,
  AlertCircle, ChevronRight,
} from "lucide-react";
import type { ProductDetailData, BuyerRow } from "./page";

function fmtKg(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0kg";
  if (n >= 1000) return `${(n / 1000).toFixed(2).replace(/\.00$/, "")}t`;
  return `${n.toFixed(1)}kg`;
}

function fmtRelative(days: number | null): string {
  if (days == null) return "never";
  if (days === 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  if (days < 60) return "~1 month ago";
  if (days < 365) return `~${Math.round(days/30)} months ago`;
  return `${Math.floor(days/365)}y ago`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function ProductDetailClient({ data }: { data: ProductDetailData }) {
  const growth = Number(data.growth_pct);
  const trend = growth >= 5 ? "up" : growth <= -5 ? "down" : "flat";

  return (
    <div className="min-h-screen bg-paper pb-12">
      <div className="max-w-5xl mx-auto px-3 py-4 lg:px-6 lg:py-6">

        <Link href="/insights/products" className="text-xs text-ink-muted hover:text-ink inline-flex items-center gap-1 mb-3">
          <ArrowLeft size={11}/> Products
        </Link>

        {/* Header */}
        <div className="mb-4">
          <h1 className="text-lg lg:text-xl font-semibold leading-tight inline-flex items-center gap-2">
            <Package size={18} className="text-accent"/>
            {data.name}
          </h1>
          <div className="text-2xs lg:text-xs text-ink-muted mt-0.5 flex items-center gap-2 flex-wrap">
            {data.brand_name && <span>{data.brand_name}</span>}
            {data.weight_kg != null && <span>· {Number(data.weight_kg).toFixed(2)} kg/unit conversion</span>}
            {data.days_since_last_sold != null && data.days_since_last_sold >= 30 && (
              <span className="inline-flex items-center gap-1 text-warn font-medium">
                · stagnant · last sold {fmtRelative(data.days_since_last_sold)}
              </span>
            )}
          </div>
        </div>

        {/* KPI tiles */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 lg:gap-3 mb-4">
          <KpiCard
            label="Last 30 days"
            value={fmtKg(Number(data.kg_30d))}
            sublabel={
              <span className={
                trend === "up" ? "text-ok"
                : trend === "down" ? "text-danger"
                : "text-ink-subtle"
              }>
                {trend === "up" && <TrendingUp size={11} className="inline mr-0.5"/>}
                {trend === "down" && <TrendingDown size={11} className="inline mr-0.5"/>}
                {trend === "flat" && <Minus size={11} className="inline mr-0.5"/>}
                {growth > 0 ? "+" : ""}{growth}% vs prev
              </span>
            }
          />
          <KpiCard
            label="Last 90 days"
            value={fmtKg(Number(data.kg_90d))}
            sublabel={`${data.buyers_90d} buyers`}
          />
          <KpiCard
            label="Active buyers"
            value={data.buyers_30d.toString()}
            sublabel="in last 30 days"
          />
          <KpiCard
            label="Lifetime"
            value={fmtKg(Number(data.kg_lifetime))}
            sublabel={data.last_sold_at ? `last sold ${fmtRelative(data.days_since_last_sold)}` : "never sold"}
          />
        </div>

        {/* Stoppers warning (if any) */}
        {data.recent_stoppers.length > 0 && (
          <div className="bg-warn-soft border border-warn/30 rounded-md px-3 py-2 mb-4 flex items-start gap-2">
            <AlertCircle size={14} className="text-warn shrink-0 mt-0.5"/>
            <div className="text-xs">
              <span className="font-semibold">{data.recent_stoppers.length} customer{data.recent_stoppers.length === 1 ? "" : "s"} stopped buying</span> in the last 30 days — were active in the prior 60 days. See below.
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Top buyers */}
          <section className="bg-paper-card border border-paper-line rounded-md p-3 lg:p-4">
            <h2 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
              <Users size={14} className="text-ink-muted"/>
              Top buyers (90d)
            </h2>
            {data.top_buyers.length === 0 ? (
              <p className="text-xs text-ink-subtle">No buyers in the last 90 days.</p>
            ) : (
              <div className="divide-y divide-paper-line">
                {data.top_buyers.map(b => <BuyerRowDisplay key={b.customer_id} row={b}/>)}
              </div>
            )}
          </section>

          {/* Recent stoppers */}
          <section className="bg-paper-card border border-paper-line rounded-md p-3 lg:p-4">
            <h2 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
              <TrendingDown size={14} className="text-warn"/>
              Recent stoppers
            </h2>
            <p className="text-2xs text-ink-muted mb-2">
              Bought in last 90 days but not in last 30
            </p>
            {data.recent_stoppers.length === 0 ? (
              <p className="text-xs text-ink-subtle">No recent stoppers — everyone who was buying is still buying.</p>
            ) : (
              <div className="divide-y divide-paper-line">
                {data.recent_stoppers.map(b => <BuyerRowDisplay key={b.customer_id} row={b}/>)}
              </div>
            )}
          </section>
        </div>

        {/* Beat breakdown */}
        {data.beats.length > 0 && (
          <section className="mt-4 bg-paper-card border border-paper-line rounded-md p-3 lg:p-4">
            <h2 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
              <MapPin size={14} className="text-ink-muted"/>
              Beat breakdown
            </h2>
            <div className="overflow-x-auto -mx-3 lg:mx-0">
              <table className="w-full text-sm">
                <thead className="text-left text-2xs uppercase tracking-wide text-ink-muted">
                  <tr>
                    <th className="px-3 py-1.5 font-medium">Beat</th>
                    <th className="px-3 py-1.5 font-medium text-right">30d kg</th>
                    <th className="px-3 py-1.5 font-medium text-right">90d kg</th>
                    <th className="px-3 py-1.5 font-medium text-right">Buyers 30d</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-paper-line">
                  {data.beats.map(b => (
                    <tr key={b.beat_id ?? b.beat_name}>
                      <td className="px-3 py-1.5">
                        {b.beat_id ? (
                          <Link href={`/insights/beats/${b.beat_id}`} className="hover:text-accent hover:underline">
                            {b.beat_name}
                          </Link>
                        ) : (
                          <span className="text-ink-muted">{b.beat_name}</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular">{fmtKg(Number(b.kg_30d ?? 0))}</td>
                      <td className="px-3 py-1.5 text-right tabular text-ink-muted">{fmtKg(Number(b.kg_90d))}</td>
                      <td className="px-3 py-1.5 text-right tabular text-ink-muted">{Number(b.buyers_30d)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function KpiCard({
  label, value, sublabel,
}: {
  label: string;
  value: React.ReactNode;
  sublabel?: React.ReactNode;
}) {
  return (
    <div className="bg-paper-card border border-paper-line rounded-md p-2.5 lg:p-3">
      <div className="text-2xs uppercase tracking-wide text-ink-muted">{label}</div>
      <div className="text-base lg:text-lg font-bold tabular leading-tight mt-0.5 truncate">{value}</div>
      {sublabel && <div className="text-2xs text-ink-muted mt-0.5 truncate">{sublabel}</div>}
    </div>
  );
}

function BuyerRowDisplay({ row }: { row: BuyerRow }) {
  return (
    <Link
      href={`/insights/customers/${row.customer_id}`}
      className="block py-2 first:pt-0 last:pb-0 -mx-1 px-1 rounded hover:bg-paper-subtle/40 group"
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate group-hover:text-accent">{row.customer_name}</div>
          <div className="text-2xs text-ink-muted flex items-center gap-2 flex-wrap">
            {row.beat_name && (
              <span className="inline-flex items-center gap-0.5"><MapPin size={9}/>{row.beat_name}</span>
            )}
            {row.mobile && (
              <span className="inline-flex items-center gap-0.5"><Phone size={9}/>{row.mobile}</span>
            )}
            <span>· last: {fmtDate(row.last_order_at)}</span>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-sm font-bold tabular">{fmtKg(Number(row.kg_90d))}</div>
          {row.kg_30d != null && Number(row.kg_30d) > 0 && (
            <div className="text-2xs text-ink-subtle tabular">{fmtKg(Number(row.kg_30d))} in 30d</div>
          )}
        </div>
        <ChevronRight size={12} className="text-ink-subtle shrink-0 self-center"/>
      </div>
    </Link>
  );
}
