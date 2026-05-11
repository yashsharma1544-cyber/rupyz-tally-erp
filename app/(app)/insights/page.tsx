// =============================================================================
// /insights — entry point for the analytics surface
//
// Layer 1: shows all beats with 30-day kg totals, growth/shrinkage %, and a
// simple "X sleeping customers" count. Tap a beat to drill down into per-
// customer detail.
//
// Future layers will add /insights/customers, /insights/products, and AI
// summaries on each page.
// =============================================================================

import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowUpRight, ArrowDownRight, Minus, MapPin, AlertCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface BeatSummary {
  beat_id: string;
  beat_name: string;
  customer_count: number;
  active_30d_count: number;
  sleeping_count: number;
  this_30d_kg: number;
  prev_30d_kg: number;
  growth_pct: number | null;
}

function formatKg(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0 kg";
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")} t`;
  return `${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })} kg`;
}

function GrowthBadge({ pct }: { pct: number | null }) {
  if (pct == null) {
    return (
      <span className="inline-flex items-center gap-0.5 text-2xs text-ink-subtle">
        <Minus size={9}/> no baseline
      </span>
    );
  }
  if (Math.abs(pct) < 1) {
    return (
      <span className="inline-flex items-center gap-0.5 text-2xs text-ink-muted">
        <Minus size={9}/> flat
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

export default async function InsightsIndexPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?from=/insights");

  const { data: me } = await supabase
    .from("app_users")
    .select("role, active")
    .eq("id", user.id)
    .single();
  if (!me?.active || !["admin", "approver", "accounts", "salesman"].includes(me.role)) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <h1 className="text-base font-semibold mb-1">Not authorized</h1>
        <p className="text-sm text-ink-muted">Insights are for admin, approver, accounts, and salesmen.</p>
      </div>
    );
  }

  // Coverage check on weight_kg setup — warn if mostly missing
  const [
    { count: productCount },
    { count: productsWithWeight },
    { data: beatRows, error: beatErr },
  ] = await Promise.all([
    supabase.from("products").select("id", { count: "exact", head: true }),
    supabase.from("products").select("id", { count: "exact", head: true }).not("weight_kg", "is", null),
    supabase.rpc("beats_health_summary"),
  ]);

  const beats = (beatRows ?? []) as BeatSummary[];
  const totalProducts = productCount ?? 0;
  const productsWithWeightCount = productsWithWeight ?? 0;
  const coveragePct = totalProducts > 0 ? Math.round((productsWithWeightCount / totalProducts) * 100) : 0;

  // Aggregate totals
  const total30d = beats.reduce((s, b) => s + Number(b.this_30d_kg), 0);
  const totalPrev30d = beats.reduce((s, b) => s + Number(b.prev_30d_kg), 0);
  const overallGrowth = totalPrev30d > 0 ? ((total30d - totalPrev30d) / totalPrev30d) * 100 : null;
  const totalCustomers = beats.reduce((s, b) => s + Number(b.customer_count), 0);
  const totalSleeping = beats.reduce((s, b) => s + Number(b.sleeping_count), 0);

  return (
    <div className="min-h-screen bg-paper">
      <div className="max-w-5xl mx-auto px-4 py-6">
        <h1 className="text-xl font-semibold leading-tight mb-1">Sales insights</h1>
        <p className="text-sm text-ink-muted mb-5">
          30-day rolling sales by beat, measured in kg. Tap a beat to see per-customer detail.
        </p>

        {/* Coverage warning if weights aren't set */}
        {coveragePct < 80 && (
          <div className="bg-warn-soft border border-warn/30 rounded-md p-3 mb-5 flex items-start gap-2">
            <AlertCircle size={16} className="text-warn shrink-0 mt-0.5"/>
            <div className="text-sm">
              <strong>Product weights are incomplete.</strong>{" "}
              Only <span className="tabular">{productsWithWeightCount}</span> of {totalProducts} products have a weight set ({coveragePct}%). Lines without weights are excluded from kg totals. <Link href="/products" className="underline text-warn">Set weights</Link>
            </div>
          </div>
        )}

        {/* Top-level KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3 mb-6">
          <div className="bg-paper-card border border-paper-line rounded-md p-3">
            <div className="text-2xs uppercase tracking-wide text-ink-muted mb-1">Last 30 days</div>
            <div className="text-lg font-bold tabular">{formatKg(total30d)}</div>
            <div className="mt-1"><GrowthBadge pct={overallGrowth}/></div>
          </div>
          <div className="bg-paper-card border border-paper-line rounded-md p-3">
            <div className="text-2xs uppercase tracking-wide text-ink-muted mb-1">Previous 30d</div>
            <div className="text-lg font-bold tabular">{formatKg(totalPrev30d)}</div>
            <div className="text-2xs text-ink-subtle mt-1">baseline</div>
          </div>
          <div className="bg-paper-card border border-paper-line rounded-md p-3">
            <div className="text-2xs uppercase tracking-wide text-ink-muted mb-1">Customers</div>
            <div className="text-lg font-bold tabular">{totalCustomers.toLocaleString("en-IN")}</div>
            <div className="text-2xs text-ink-subtle mt-1">across {beats.length} beats</div>
          </div>
          <div className={`bg-paper-card border ${totalSleeping > 0 ? "border-warn/30" : "border-paper-line"} rounded-md p-3`}>
            <div className="text-2xs uppercase tracking-wide text-ink-muted mb-1">Sleeping</div>
            <div className={`text-lg font-bold tabular ${totalSleeping > 0 ? "text-warn" : ""}`}>
              {totalSleeping.toLocaleString("en-IN")}
            </div>
            <div className="text-2xs text-ink-subtle mt-1">no order in 30+ days</div>
          </div>
        </div>

        {beatErr && (
          <div className="bg-danger-soft border border-danger/30 rounded-md p-3 mb-5">
            <p className="text-sm text-danger">Couldn&apos;t load beat summary: {beatErr.message}</p>
          </div>
        )}

        {/* Beat list */}
        <h2 className="text-2xs uppercase tracking-[0.2em] text-ink-subtle mb-2.5">Beats</h2>
        {beats.length === 0 ? (
          <div className="bg-paper-card border border-paper-line rounded-md p-6 text-center">
            <p className="text-sm font-semibold mb-0.5">No beats configured</p>
            <p className="text-xs text-ink-muted">Add beats and assign customers to them first.</p>
          </div>
        ) : (
          <div className="bg-paper-card border border-paper-line rounded-md overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-paper-subtle/50 border-b border-paper-line">
                <tr className="text-left text-2xs uppercase tracking-wide text-ink-muted">
                  <th className="px-3 py-2 font-medium">Beat</th>
                  <th className="px-3 py-2 font-medium text-right">Last 30d (kg)</th>
                  <th className="px-3 py-2 font-medium text-right">vs prev</th>
                  <th className="px-3 py-2 font-medium text-right">Customers</th>
                  <th className="px-3 py-2 font-medium text-right">Active</th>
                  <th className="px-3 py-2 font-medium text-right">Sleeping</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-paper-line">
                {beats.map(b => (
                  <tr key={b.beat_id} className="hover:bg-paper-subtle/40">
                    <td className="px-3 py-2.5">
                      <Link
                        href={`/insights/beats/${b.beat_id}`}
                        className="font-medium text-accent hover:underline inline-flex items-center gap-1"
                      >
                        <MapPin size={11}/> {b.beat_name}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular font-semibold">{formatKg(Number(b.this_30d_kg))}</td>
                    <td className="px-3 py-2.5 text-right"><GrowthBadge pct={b.growth_pct}/></td>
                    <td className="px-3 py-2.5 text-right tabular text-ink-muted">{Number(b.customer_count)}</td>
                    <td className="px-3 py-2.5 text-right tabular text-ok">{Number(b.active_30d_count)}</td>
                    <td className="px-3 py-2.5 text-right tabular">
                      {Number(b.sleeping_count) > 0 ? (
                        <span className="text-warn font-semibold">{Number(b.sleeping_count)}</span>
                      ) : (
                        <span className="text-ink-subtle">0</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-2xs text-ink-subtle mt-4">
          Note: rejected and cancelled orders are excluded. Lines without a product weight set are excluded from kg totals.
        </p>
      </div>
    </div>
  );
}
