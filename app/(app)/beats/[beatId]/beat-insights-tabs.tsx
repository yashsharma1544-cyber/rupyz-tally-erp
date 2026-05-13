"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { ArrowUpRight, ArrowDownRight, Minus, Phone, Clock, ChevronRight } from "lucide-react";
import type { CustomerHealth } from "./page";

type TabKey = "all" | "growing" | "shrinking" | "sleeping";

const TABS: Array<{ key: TabKey; label: string; description: string }> = [
  { key: "all",       label: "All",         description: "Every customer in this beat" },
  { key: "growing",   label: "Growing",     description: "+10% kg vs previous 30 days" },
  { key: "shrinking", label: "Shrinking",   description: "−10% kg vs previous 30 days" },
  { key: "sleeping",  label: "Sleeping",    description: "30+ days since last order" },
];

function formatKg(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0 kg";
  return `${n.toLocaleString("en-IN", { maximumFractionDigits: n >= 100 ? 0 : 1 })} kg`;
}

function formatDays(d: number | null, lastOrderAt: string | null): string {
  if (lastOrderAt == null) return "never";
  if (d == null) return "—";
  if (d === 0) return "today";
  if (d === 1) return "1 day";
  if (d < 30) return `${d} days`;
  if (d < 365) return `${Math.round(d / 30)} months`;
  return `${(d / 365).toFixed(1)} years`;
}

function GrowthCell({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-2xs text-ink-subtle">—</span>;
  if (Math.abs(pct) < 1) {
    return (
      <span className="inline-flex items-center gap-0.5 text-2xs text-ink-muted tabular">
        <Minus size={9}/> 0%
      </span>
    );
  }
  if (pct > 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-2xs text-ok font-semibold tabular">
        <ArrowUpRight size={10}/> +{pct.toFixed(0)}%
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 text-2xs text-danger font-semibold tabular">
      <ArrowDownRight size={10}/> {pct.toFixed(0)}%
    </span>
  );
}

export function BeatInsightsTabs({ customers, beatId: _beatId }: { customers: CustomerHealth[]; beatId?: string }) {
  const [tab, setTab] = useState<TabKey>("all");

  const filtered = useMemo(() => {
    switch (tab) {
      case "growing":
        return customers
          .filter(c => c.growth_pct != null && Number(c.growth_pct) >= 10)
          .sort((a, b) => Number(b.growth_pct ?? 0) - Number(a.growth_pct ?? 0));
      case "shrinking":
        return customers
          .filter(c => c.growth_pct != null && Number(c.growth_pct) <= -10)
          .sort((a, b) => Number(a.growth_pct ?? 0) - Number(b.growth_pct ?? 0));
      case "sleeping":
        return customers
          .filter(c => c.last_order_at == null || (c.days_since_last ?? 0) >= 30)
          .sort((a, b) => Number(b.this_90d_kg ?? 0) - Number(a.this_90d_kg ?? 0));
      default:
        return customers;
    }
  }, [tab, customers]);

  const counts = useMemo(() => ({
    all: customers.length,
    growing: customers.filter(c => c.growth_pct != null && Number(c.growth_pct) >= 10).length,
    shrinking: customers.filter(c => c.growth_pct != null && Number(c.growth_pct) <= -10).length,
    sleeping: customers.filter(c => c.last_order_at == null || (c.days_since_last ?? 0) >= 30).length,
  }), [customers]);

  return (
    <>
      <div className="flex items-center gap-1 mb-3 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
        {TABS.map(t => {
          const active = t.key === tab;
          const count = counts[t.key];
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 text-xs rounded-md whitespace-nowrap transition-colors ${
                active
                  ? "bg-accent text-paper-card font-semibold"
                  : "bg-paper-card border border-paper-line text-ink-muted hover:bg-paper-subtle"
              }`}
            >
              {t.label}
              <span className={`ml-1.5 tabular ${active ? "opacity-90" : "opacity-60"}`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <p className="text-2xs text-ink-muted mb-2">
        {TABS.find(t => t.key === tab)?.description}
      </p>

      <div className="bg-paper-card border border-paper-line rounded-md overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="bg-paper-subtle/50 border-b border-paper-line">
              <tr className="text-left text-2xs uppercase tracking-wide text-ink-muted">
                <th className="px-3 py-2 font-medium">Customer</th>
                <th className="px-3 py-2 font-medium text-right">30d kg</th>
                <th className="px-3 py-2 font-medium text-right">vs prev</th>
                <th className="px-3 py-2 font-medium text-right">90d kg</th>
                <th className="px-3 py-2 font-medium text-right">Orders 30d</th>
                <th className="px-3 py-2 font-medium text-right">Last order</th>
                <th className="px-3 py-2 w-6"/>
              </tr>
            </thead>
            <tbody className="divide-y divide-paper-line">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-ink-muted text-sm">
                    {tab === "all"
                      ? "No customers in this beat."
                      : tab === "growing"
                        ? "No customers with +10% growth."
                        : tab === "shrinking"
                          ? "No customers shrinking — all stable."
                          : "No sleeping customers — everyone is active."}
                  </td>
                </tr>
              ) : filtered.map(c => {
                const days = c.days_since_last;
                const isSleeping = c.last_order_at == null || (days ?? 0) >= 30;
                return (
                  <tr key={c.customer_id} className="hover:bg-paper-subtle/30 group">
                    <td className="px-3 py-2.5">
                      <Link
                        href={`/customers/${c.customer_id}`}
                        className="font-medium hover:text-accent hover:underline"
                      >
                        {c.customer_name}
                      </Link>
                      <div className="text-2xs text-ink-muted flex items-center gap-2 flex-wrap mt-0.5">
                        {c.customer_city && <span>{c.customer_city}</span>}
                        {c.customer_mobile && (
                          <a
                            href={`tel:${c.customer_mobile}`}
                            className="inline-flex items-center gap-0.5 text-accent hover:underline"
                          >
                            <Phone size={9}/> {c.customer_mobile}
                          </a>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular font-semibold">
                      <Link href={`/customers/${c.customer_id}`} className="block">
                        {Number(c.this_30d_kg) > 0 ? formatKg(Number(c.this_30d_kg)) : <span className="text-ink-subtle">0</span>}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Link href={`/customers/${c.customer_id}`} className="block">
                        <GrowthCell pct={c.growth_pct} />
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular text-ink-muted">
                      <Link href={`/customers/${c.customer_id}`} className="block">
                        {formatKg(Number(c.this_90d_kg))}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular text-ink-muted">
                      <Link href={`/customers/${c.customer_id}`} className="block">
                        {Number(c.this_30d_order_count)}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Link href={`/customers/${c.customer_id}`} className="block">
                        <span className={`text-2xs inline-flex items-center gap-0.5 tabular ${
                          isSleeping ? "text-warn font-semibold" : "text-ink-muted"
                        }`}>
                          {isSleeping && <Clock size={9}/>}
                          {formatDays(days, c.last_order_at)}
                        </span>
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Link
                        href={`/customers/${c.customer_id}`}
                        className="text-ink-subtle group-hover:text-accent inline-flex"
                        aria-label="Open customer detail"
                      >
                        <ChevronRight size={14}/>
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
