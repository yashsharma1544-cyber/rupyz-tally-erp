"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  TrendingUp, TrendingDown, Minus, ChevronRight, Search,
} from "lucide-react";
import type { ProductsOverviewData, ProductRow, BrandRow } from "./page";

function fmtKg(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0 kg";
  return `${n.toLocaleString("en-IN", { maximumFractionDigits: n >= 100 ? 0 : 1 })} kg`;
}

function fmtRelative(days: number | null): string {
  if (days == null) return "never";
  if (days === 0) return "today";
  if (days === 1) return "1d";
  if (days < 30) return `${days}d`;
  if (days < 365) return `~${Math.round(days/30)}mo`;
  return `${Math.floor(days/365)}y`;
}

function GrowthBadge({ pct }: { pct: number }) {
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
        <TrendingUp size={9}/> +{pct.toFixed(0)}%
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 text-2xs text-danger font-semibold tabular">
      <TrendingDown size={9}/> {pct.toFixed(0)}%
    </span>
  );
}

type SortKey = "kg_30d" | "kg_lifetime" | "growth_pct" | "share_pct_30d" | "name";

export function ProductsInsightsClient({ data }: { data: ProductsOverviewData }) {
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("kg_30d");
  const [brandFilter, setBrandFilter] = useState<string | null>(null);

  const filteredSorted = useMemo(() => {
    let rows = data.products;
    if (brandFilter) rows = rows.filter(p => p.brand_id === brandFilter);
    if (query) {
      const q = query.toLowerCase();
      rows = rows.filter(p =>
        p.product_name.toLowerCase().includes(q) ||
        (p.brand_name ?? "").toLowerCase().includes(q),
      );
    }
    return [...rows].sort((a, b) => {
      if (sortBy === "name") return a.product_name.localeCompare(b.product_name);
      const av = Number(a[sortBy] ?? 0);
      const bv = Number(b[sortBy] ?? 0);
      return bv - av;
    });
  }, [data.products, query, sortBy, brandFilter]);

  const totalKg30 = Number(data.total_kg_30d);

  return (
    <div className="max-w-5xl mx-auto px-3 py-4 lg:px-6 lg:py-6">
      <p className="text-xs text-ink-muted mb-5">
        {fmtKg(totalKg30)} sold across all products in the last 30 days
      </p>

      {/* Brand totals */}
      <section className="mb-5">
        <h2 className="text-xs uppercase tracking-wide text-ink-muted font-semibold mb-2">Brand totals (last 30d)</h2>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-2 lg:gap-3">
          <button
            type="button"
            onClick={() => setBrandFilter(null)}
            className={`text-left bg-paper-card border rounded-md p-3 transition-colors ${
              brandFilter === null
                ? "border-accent bg-accent-soft"
                : "border-paper-line hover:bg-paper-subtle"
            }`}
          >
            <div className="text-2xs uppercase tracking-wide text-ink-muted">All brands</div>
            <div className="text-base lg:text-lg font-bold tabular">{fmtKg(totalKg30)}</div>
            <div className="text-2xs text-ink-muted">{data.brands.length} brands · {data.products.length} SKUs</div>
          </button>

          {data.brands.map(b => (
            <BrandTile
              key={b.brand_id ?? "null"}
              brand={b}
              active={brandFilter === b.brand_id}
              onClick={() => setBrandFilter(brandFilter === b.brand_id ? null : b.brand_id)}
            />
          ))}
        </div>
      </section>

      {/* SKU list controls */}
      <section>
        <div className="flex items-baseline justify-between mb-2 flex-wrap gap-2">
          <h2 className="text-xs uppercase tracking-wide text-ink-muted font-semibold">
            {brandFilter
              ? `${data.brands.find(b => b.brand_id === brandFilter)?.brand_name} SKUs`
              : "All SKUs"}{" "}
            ({filteredSorted.length})
          </h2>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-subtle"/>
              <input
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search…"
                className="pl-6 pr-2 py-1 text-xs border border-paper-line rounded bg-paper-card placeholder:text-ink-subtle focus:outline-none focus:border-accent w-32 lg:w-40"
              />
            </div>
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as SortKey)}
              className="text-xs border border-paper-line rounded bg-paper-card px-2 py-1 focus:outline-none focus:border-accent"
            >
              <option value="kg_30d">Sort: 30d kg</option>
              <option value="kg_lifetime">Sort: Lifetime kg</option>
              <option value="growth_pct">Sort: Growth %</option>
              <option value="share_pct_30d">Sort: Share %</option>
              <option value="name">Sort: Name</option>
            </select>
          </div>
        </div>

        <div className="bg-paper-card border border-paper-line rounded-md overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="bg-paper-subtle/50 border-b border-paper-line">
                <tr className="text-left text-2xs uppercase tracking-wide text-ink-muted">
                  <th className="px-3 py-2 font-medium">Product</th>
                  <th className="px-3 py-2 font-medium">Brand</th>
                  <th className="px-3 py-2 font-medium text-right">30d kg</th>
                  <th className="px-3 py-2 font-medium text-right">vs prev</th>
                  <th className="px-3 py-2 font-medium text-right">Share</th>
                  <th className="px-3 py-2 font-medium text-right">Buyers 30d</th>
                  <th className="px-3 py-2 font-medium text-right">Last sold</th>
                  <th className="px-3 py-2 w-6"/>
                </tr>
              </thead>
              <tbody className="divide-y divide-paper-line">
                {filteredSorted.length === 0 ? (
                  <tr><td colSpan={8} className="px-3 py-8 text-center text-ink-muted text-sm">
                    No products match.
                  </td></tr>
                ) : filteredSorted.map(p => <ProductRowDisplay key={p.product_id} p={p}/>)}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}

function BrandTile({ brand, active, onClick }: { brand: BrandRow; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left bg-paper-card border rounded-md p-3 transition-colors ${
        active
          ? "border-accent bg-accent-soft"
          : "border-paper-line hover:bg-paper-subtle"
      }`}
    >
      <div className="text-2xs uppercase tracking-wide text-ink-muted truncate">{brand.brand_name}</div>
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-base lg:text-lg font-bold tabular">{fmtKg(Number(brand.kg_30d))}</div>
        <GrowthBadge pct={Number(brand.growth_pct)}/>
      </div>
      <div className="text-2xs text-ink-muted">
        {brand.active_sku_count}/{brand.sku_count} SKUs · {Number(brand.share_pct_30d).toFixed(0)}% share
      </div>
    </button>
  );
}

function ProductRowDisplay({ p }: { p: ProductRow }) {
  return (
    <tr className="hover:bg-paper-subtle/30 group">
      <td className="px-3 py-2.5">
        <Link href={`/products/insights/${p.product_id}`} className="font-medium hover:text-accent hover:underline">
          {p.product_name}
        </Link>
      </td>
      <td className="px-3 py-2.5 text-xs text-ink-muted">
        {p.brand_name ?? "—"}
      </td>
      <td className="px-3 py-2.5 text-right tabular font-semibold">
        {Number(p.kg_30d) > 0 ? fmtKg(Number(p.kg_30d)) : <span className="text-ink-subtle">0</span>}
      </td>
      <td className="px-3 py-2.5 text-right">
        <GrowthBadge pct={Number(p.growth_pct)}/>
      </td>
      <td className="px-3 py-2.5 text-right tabular text-ink-muted">
        {Number(p.share_pct_30d).toFixed(1)}%
      </td>
      <td className="px-3 py-2.5 text-right tabular text-ink-muted">
        {Number(p.buyers_30d)}
      </td>
      <td className="px-3 py-2.5 text-right text-2xs tabular text-ink-muted">
        {fmtRelative(p.days_since_last_sold)}
      </td>
      <td className="px-3 py-2.5">
        <Link
          href={`/products/insights/${p.product_id}`}
          className="text-ink-subtle group-hover:text-accent inline-flex"
          aria-label="Open product detail"
        >
          <ChevronRight size={14}/>
        </Link>
      </td>
    </tr>
  );
}
