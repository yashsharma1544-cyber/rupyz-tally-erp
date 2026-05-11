"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  ArrowLeft, Phone, MapPin, CheckCircle2, AlertCircle,
  TrendingUp, TrendingDown, Minus, Calendar, ShoppingBag, Package,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { markVisited } from "./actions";
import type { CustomerDetailData } from "./page";

function fmtKg(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)} t`;
  return `${n.toFixed(1)} kg`;
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function fmtRelative(days: number | null): string {
  if (days == null) return "never";
  if (days < 1) return "today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  if (days < 60) return `~1 month ago`;
  if (days < 365) return `~${Math.round(days / 30)} months ago`;
  return `${Math.floor(days / 365)} year${Math.floor(days/365) === 1 ? "" : "s"} ago`;
}

export function CustomerDetailClient({ data }: { data: CustomerDetailData }) {
  const [pending, startTransition] = useTransition();
  const [justVisited, setJustVisited] = useState(false);

  function onMarkVisited() {
    startTransition(async () => {
      const res = await markVisited(data.id);
      if (res.ok) {
        setJustVisited(true);
        toast.success("Visit logged");
      } else {
        toast.error(res.error ?? "Could not log visit");
      }
    });
  }

  const growthTrend = data.growth_pct >= 5 ? "up" : data.growth_pct <= -5 ? "down" : "flat";
  const isSleeping = data.days_since_last_order != null && data.days_since_last_order >= 30;

  return (
    <div className="min-h-screen bg-paper pb-20 lg:pb-6">
      <div className="max-w-4xl mx-auto px-3 py-3 lg:px-6 lg:py-5">

        {/* Back link */}
        <Link
          href={data.beat_id ? `/insights/beats/${data.beat_id}` : "/insights"}
          className="text-xs text-ink-muted hover:text-ink inline-flex items-center gap-1 mb-3"
        >
          <ArrowLeft size={11}/>
          {data.beat_name ? `Back to ${data.beat_name}` : "Back to Insights"}
        </Link>

        {/* Header */}
        <div className="mb-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <h1 className="text-lg lg:text-xl font-semibold leading-tight truncate">
                {data.name}
              </h1>
              <div className="text-2xs lg:text-xs text-ink-muted mt-0.5 flex items-center gap-2 flex-wrap">
                {data.beat_name && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin size={10}/> {data.beat_name}
                  </span>
                )}
                {data.city && <span>· {data.city}</span>}
                {isSleeping && (
                  <span className="inline-flex items-center gap-1 text-warn font-medium">
                    · sleeping · last order {fmtRelative(data.days_since_last_order)}
                  </span>
                )}
                {data.confidence === "insufficient" && (
                  <span className="inline-flex items-center gap-1 text-ink-subtle">
                    · limited history
                  </span>
                )}
              </div>
            </div>

            {/* Action buttons — sticky-ish on mobile via grouping */}
            <div className="flex gap-1.5 shrink-0">
              {data.phone && (
                <a href={`tel:${data.phone}`}>
                  <Button size="sm" variant="outline">
                    <Phone size={13}/> Call
                  </Button>
                </a>
              )}
              <Button
                size="sm"
                onClick={onMarkVisited}
                disabled={pending || justVisited}
              >
                <CheckCircle2 size={13}/> {justVisited ? "Visited" : pending ? "Saving…" : "Mark visited"}
              </Button>
            </div>
          </div>
          {data.last_visit_at && !justVisited && (
            <div className="text-2xs text-ink-subtle mt-2">
              Last visited: {fmtRelative(data.days_since_last_visit)}
            </div>
          )}
        </div>

        {/* Insufficient history warning */}
        {data.confidence === "insufficient" && (
          <div className="bg-warn-soft border border-warn/30 rounded-md px-3 py-2 mb-4 flex items-start gap-2">
            <AlertCircle size={14} className="text-warn shrink-0 mt-0.5"/>
            <div className="text-xs">
              <span className="font-semibold">Limited history.</span>{" "}
              Only {data.order_count} order{data.order_count === 1 ? "" : "s"} so far —
              the numbers below may not reflect a stable pattern.
            </div>
          </div>
        )}

        {/* KPI tiles — wraps gracefully on mobile */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 lg:gap-3 mb-4">
          <KpiCard
            label="Last 30 days"
            value={fmtKg(data.kg_30d)}
            sublabel={
              <span className={
                growthTrend === "up" ? "text-ok" :
                growthTrend === "down" ? "text-danger" :
                "text-ink-subtle"
              }>
                {growthTrend === "up" && <TrendingUp size={11} className="inline mr-0.5"/>}
                {growthTrend === "down" && <TrendingDown size={11} className="inline mr-0.5"/>}
                {growthTrend === "flat" && <Minus size={11} className="inline mr-0.5"/>}
                {data.growth_pct > 0 ? "+" : ""}{data.growth_pct}% vs prev
              </span>
            }
          />
          <KpiCard
            label="Last 90 days"
            value={fmtKg(data.kg_90d)}
            sublabel={`${data.order_count_90d} orders`}
          />
          <KpiCard
            label="Avg basket"
            value={fmtKg(data.avg_basket_kg)}
            sublabel={data.order_count > 0 ? `over ${data.order_count} orders` : "no orders"}
          />
          <KpiCard
            label="Order pattern"
            value={data.avg_gap_days > 0 ? `every ${Math.round(data.avg_gap_days)}d` : "—"}
            sublabel={
              data.last_order_at
                ? `last: ${fmtRelative(data.days_since_last_order)}`
                : "no orders yet"
            }
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Product mix */}
          <section className="bg-paper-card border border-paper-line rounded-md p-3 lg:p-4">
            <h2 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
              <Package size={14} className="text-ink-muted"/>
              Product mix (last 90 days)
            </h2>
            {data.product_mix.length === 0 ? (
              <p className="text-xs text-ink-subtle">No orders in last 90 days.</p>
            ) : (
              (() => {
                const totalKg = data.product_mix.reduce((s, x) => s + Number(x.kg), 0);
                return (
                  <div className="space-y-2">
                    {data.product_mix.map(p => {
                      const pct = totalKg > 0 ? (Number(p.kg) / totalKg) * 100 : 0;
                      return (
                        <div key={p.product_id ?? p.product_name}>
                          <div className="flex justify-between text-xs gap-2">
                            <span className="truncate">{p.product_name}</span>
                            <span className="tabular text-ink-muted shrink-0">
                              {fmtKg(Number(p.kg))} · {pct.toFixed(0)}%
                            </span>
                          </div>
                          <div className="h-1.5 bg-paper-subtle rounded-full overflow-hidden mt-0.5">
                            <div
                              className="h-full bg-accent rounded-full"
                              style={{ width: `${Math.min(100, pct)}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()
            )}
          </section>

          {/* Recent orders */}
          <section className="bg-paper-card border border-paper-line rounded-md p-3 lg:p-4">
            <h2 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
              <ShoppingBag size={14} className="text-ink-muted"/>
              Recent orders
            </h2>
            {data.recent_orders.length === 0 ? (
              <p className="text-xs text-ink-subtle">No orders yet.</p>
            ) : (
              <div className="divide-y divide-paper-line">
                {data.recent_orders.map(o => (
                  <div key={o.order_id} className="py-2 first:pt-0 last:pb-0 flex items-baseline justify-between gap-2 text-xs">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <Calendar size={10} className="text-ink-subtle shrink-0"/>
                        <span className="tabular">{fmtDate(o.order_created_at)}</span>
                      </div>
                      <div className="text-2xs text-ink-subtle">{o.line_count} line{o.line_count === 1 ? "" : "s"}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="tabular font-medium">{o.kg != null ? fmtKg(Number(o.kg)) : "—"}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Lifetime stats */}
        <section className="mt-4 bg-paper-subtle border border-paper-line rounded-md p-3 lg:p-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 lg:gap-3">
            <Sm label="Lifetime kg" value={fmtKg(data.kg_lifetime)} />
            <Sm label="Lifetime orders" value={data.order_count.toString()} />
            <Sm label="Customer since" value={fmtDate(data.created_at)} />
            <Sm label="Last visit" value={fmtRelative(data.days_since_last_visit)} />
          </div>
        </section>
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

function Sm({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-2xs uppercase tracking-wide text-ink-muted">{label}</div>
      <div className="text-sm font-medium tabular">{value}</div>
    </div>
  );
}
