// =============================================================================
// /beats — sales analytics by beat (merged from old /insights)
//
// Shows all beats with 30-day kg totals, growth vs previous period, customer
// counts, sleeping flags, AI insight, and an Edit button per row.
// Replaces the old /insights index page and the old CRUD-only /beats page.
// =============================================================================

import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowUpRight, ArrowDownRight, Minus, AlertCircle, MapPin } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { BeatsTableClient } from "@/components/ai/beats-table-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export interface BeatSummary {
  beat_id: string;
  beat_name: string;
  beat_city: string | null;
  customer_count: number;
  active_30d_count: number;
  sleeping_count: number;
  this_30d_kg: number;
  prev_30d_kg: number;
  growth_pct: number | null;
}

function formatKg(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0 kg";
  return `${n.toLocaleString("en-IN", { maximumFractionDigits: n >= 100 ? 0 : 1 })} kg`;
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

export default async function BeatsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?from=/beats");

  const { data: me } = await supabase
    .from("app_users")
    .select("role, active")
    .eq("id", user.id)
    .single();
  if (!me?.active || !["admin", "approver", "accounts", "salesman"].includes(me.role)) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <h1 className="text-base font-semibold mb-1">Not authorized</h1>
        <p className="text-sm text-ink-muted">Beats are for admin, approver, accounts, and salesmen.</p>
      </div>
    );
  }

  const isAdmin = ["admin", "accounts"].includes(me.role);

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

  const total30d = beats.reduce((s, b) => s + Number(b.this_30d_kg), 0);
  const totalPrev30d = beats.reduce((s, b) => s + Number(b.prev_30d_kg), 0);
  const overallGrowth = totalPrev30d > 0 ? ((total30d - totalPrev30d) / totalPrev30d) * 100 : null;
  const totalCustomers = beats.reduce((s, b) => s + Number(b.customer_count), 0);
  const totalSleeping = beats.reduce((s, b) => s + Number(b.sleeping_count), 0);

  return (
    <div className="min-h-screen bg-paper">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
          <h1 className="text-xl font-semibold leading-tight">Beats</h1>
          {isAdmin && (
            <Link
              href="/beats/manage-areas"
              className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-paper-line rounded hover:bg-paper-subtle transition-colors whitespace-nowrap"
            >
              <MapPin size={12} className="text-ink-subtle"/> Manage areas
            </Link>
          )}
        </div>
        <p className="text-sm text-ink-muted mb-5">
          30-day rolling sales by beat, measured in kg. Tap a beat to see per-customer detail.
        </p>

        {coveragePct < 80 && (
          <div className="bg-warn-soft border border-warn/30 rounded-md p-3 mb-5 flex items-start gap-2">
            <AlertCircle size={16} className="text-warn shrink-0 mt-0.5"/>
            <div className="text-sm">
              <strong>Product weights are incomplete.</strong>{" "}
              Only <span className="tabular">{productsWithWeightCount}</span> of {totalProducts} products have a weight set ({coveragePct}%). Lines without weights are excluded from kg totals. <Link href="/products" className="underline text-warn">Set weights</Link>
            </div>
          </div>
        )}

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

        {beats.length === 0 ? (
          <div className="bg-paper-card border border-paper-line rounded-md p-6 text-center">
            <p className="text-sm font-semibold mb-0.5">No beats configured</p>
            <p className="text-xs text-ink-muted">Add beats and assign customers to them first.</p>
          </div>
        ) : (
          <BeatsTableClient beats={beats} isAdmin={isAdmin} canManage={isAdmin} />
        )}

        <p className="text-2xs text-ink-subtle mt-4">
          Note: rejected and cancelled orders are excluded. Lines without a product weight set are excluded from kg totals.
        </p>
      </div>
    </div>
  );
}
