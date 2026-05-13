// =============================================================================
// /beats/[beatId] — per-customer health for one beat
// =============================================================================

import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { NarrativeSection } from "@/components/ai/narrative-section";
import { BeatInsightsTabs } from "./beat-insights-tabs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export interface CustomerHealth {
  customer_id: string;
  customer_name: string;
  customer_city: string;
  customer_mobile: string;
  customer_created_at: string;
  this_30d_kg: number;
  prev_30d_kg: number;
  this_90d_kg: number;
  this_30d_order_count: number;
  this_90d_order_count: number;
  total_order_count: number;
  last_order_at: string | null;
  days_since_last: number | null;
  days_since_created: number;
  growth_pct: number | null;
}

function formatKg(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0 kg";
  return `${n.toLocaleString("en-IN", { maximumFractionDigits: n >= 100 ? 0 : 1 })} kg`;
}

export default async function BeatDetailPage({
  params,
}: {
  params: Promise<{ beatId: string }>;
}) {
  const { beatId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?from=/beats/${beatId}`);

  const { data: me } = await supabase
    .from("app_users")
    .select("role, active")
    .eq("id", user.id)
    .single();
  if (!me?.active || !["admin", "approver", "accounts", "salesman"].includes(me.role)) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <h1 className="text-base font-semibold mb-1">Not authorized</h1>
      </div>
    );
  }

  const { data: beat } = await supabase
    .from("beats")
    .select("id, name")
    .eq("id", beatId)
    .maybeSingle();
  if (!beat) notFound();

  const { data: rows, error } = await supabase.rpc("beat_customer_health", { p_beat_id: beatId });

  if (error) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <Link href="/beats" className="text-xs text-ink-muted hover:text-ink inline-flex items-center gap-1 mb-3">
          <ArrowLeft size={11}/> All beats
        </Link>
        <p className="text-sm font-semibold mb-1">Couldn&apos;t load beat health</p>
        <p className="text-xs text-ink-muted">{error.message}</p>
      </div>
    );
  }

  const customers = (rows ?? []) as CustomerHealth[];

  const total30 = customers.reduce((s, c) => s + Number(c.this_30d_kg), 0);
  const totalPrev30 = customers.reduce((s, c) => s + Number(c.prev_30d_kg), 0);
  const total90 = customers.reduce((s, c) => s + Number(c.this_90d_kg), 0);
  const overallGrowth = totalPrev30 > 0 ? ((total30 - totalPrev30) / totalPrev30) * 100 : null;
  const activeCount = customers.filter(c => Number(c.this_30d_kg) > 0).length;
  const sleepingCount = customers.filter(c => c.last_order_at == null || (c.days_since_last ?? 0) >= 30).length;

  return (
    <div className="min-h-screen bg-paper">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <Link href="/beats" className="text-xs text-ink-muted hover:text-ink inline-flex items-center gap-1 mb-3">
          <ArrowLeft size={11}/> All beats
        </Link>

        <h1 className="text-xl font-semibold leading-tight mb-1">{beat.name}</h1>
        <p className="text-sm text-ink-muted mb-5">
          Per-customer health for this beat. All measurements in kg.
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          <aside className="lg:col-span-1 lg:order-2">
            <div className="lg:sticky lg:top-4">
              <NarrativeSection
                endpoint={`/api/ai/narrative/beat/${beatId}`}
                title="AI insights"
              />
            </div>
          </aside>

          <div className="lg:col-span-2 lg:order-1 space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
              <div className="bg-paper-card border border-paper-line rounded-md p-3">
                <div className="text-2xs uppercase tracking-wide text-ink-muted mb-1">Last 30 days</div>
                <div className="text-lg font-bold tabular">{formatKg(total30)}</div>
                {overallGrowth != null && (
                  <div className={`text-2xs font-semibold tabular mt-1 ${
                    overallGrowth > 0 ? "text-ok" : overallGrowth < 0 ? "text-danger" : "text-ink-muted"
                  }`}>
                    {overallGrowth > 0 ? "+" : ""}{overallGrowth.toFixed(0)}% vs prev
                  </div>
                )}
              </div>
              <div className="bg-paper-card border border-paper-line rounded-md p-3">
                <div className="text-2xs uppercase tracking-wide text-ink-muted mb-1">Last 90 days</div>
                <div className="text-lg font-bold tabular">{formatKg(total90)}</div>
                <div className="text-2xs text-ink-subtle mt-1">3-month rolling</div>
              </div>
              <div className="bg-paper-card border border-paper-line rounded-md p-3">
                <div className="text-2xs uppercase tracking-wide text-ink-muted mb-1">Active 30d</div>
                <div className="text-lg font-bold tabular text-ok">{activeCount}</div>
                <div className="text-2xs text-ink-subtle mt-1">of {customers.length} customers</div>
              </div>
              <div className={`bg-paper-card border ${sleepingCount > 0 ? "border-warn/30" : "border-paper-line"} rounded-md p-3`}>
                <div className="text-2xs uppercase tracking-wide text-ink-muted mb-1">Sleeping</div>
                <div className={`text-lg font-bold tabular ${sleepingCount > 0 ? "text-warn" : ""}`}>
                  {sleepingCount}
                </div>
                <div className="text-2xs text-ink-subtle mt-1">30+ days no order</div>
              </div>
            </div>

            <BeatInsightsTabs customers={customers} />
          </div>

        </div>
      </div>
    </div>
  );
}
