// =============================================================================
// /pipeline — kanban view of orders across all live workflow stages
//
// Shows 7 columns: Received → Approved → Loading → Loaded → On VAN →
// Dispatched → Delivered. Each column capped at 50 cards with a "View all"
// link to /orders pre-filtered to that stage.
//
// Excludes 'historical' orders (Tally backfill from prior periods).
// Excludes 'rejected', 'cancelled', 'closed', 'partially_dispatched' for
// clarity — those are accessible via /orders with the status filter.
// =============================================================================

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PipelineClient } from "./pipeline-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const STAGE_LIMIT = 50;

const STAGES = [
  "received",
  "approved",
  "loading",
  "loaded",
  "on_van_trip",
  "dispatched",
  "delivered",
] as const;

type Stage = typeof STAGES[number];

interface PipelineOrderRow {
  id: string;
  rupyz_order_id: string;
  total_amount: number;
  app_status: string;
  rupyz_created_at: string;
  customer: { id: string; name: string; city: string | null; beat: { name: string } | { name: string }[] | null } | { id: string; name: string; city: string | null; beat: { name: string } | { name: string }[] | null }[] | null;
  items: { qty: number; unit: string | null; packaging_size: number | null; packaging_unit: string | null }[];
}

function kgForItems(items: PipelineOrderRow["items"]): number {
  let total = 0;
  for (const it of items) {
    const qty = Number(it.qty);
    if (qty <= 0) continue;
    const unit = (it.unit ?? "").toLowerCase();
    const pUnit = (it.packaging_unit ?? "").toLowerCase();
    const pSize = Number(it.packaging_size ?? 0);
    if (unit === "kg") total += qty;
    else if (unit === "g" || unit === "gm" || unit.startsWith("gram")) total += qty / 1000;
    else if (pUnit === "kg") total += qty * pSize;
    else if (pUnit === "g" || pUnit === "gm" || pUnit.startsWith("gram")) total += (qty * pSize) / 1000;
  }
  return total;
}

export default async function PipelinePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?from=/pipeline");

  const { data: me } = await supabase
    .from("app_users")
    .select("full_name, role, active")
    .eq("id", user.id)
    .single();
  if (!me?.active) redirect("/login");

  // Total counts per stage. Run as a single query per stage for accurate
  // counts even when we cap the rendered list at STAGE_LIMIT.
  const totals: Record<string, number> = {};
  for (const s of STAGES) {
    const { count } = await supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("app_status", s);
    totals[s] = count ?? 0;
  }

  // Card-level data per stage (capped at STAGE_LIMIT). Newest first.
  const cardsByStage: Record<Stage, Array<{
    id: string;
    rupyzOrderId: string;
    customerName: string;
    customerCity: string | null;
    beatName: string | null;
    totalAmount: number;
    kg: number;
    createdAt: string;
  }>> = {
    received: [],
    approved: [],
    loading: [],
    loaded: [],
    on_van_trip: [],
    dispatched: [],
    delivered: [],
  };

  for (const stage of STAGES) {
    const { data, error } = await supabase
      .from("orders")
      .select(`
        id, rupyz_order_id, total_amount, app_status, rupyz_created_at,
        customer:customers(id, name, city, beat:beats(name)),
        items:order_items(qty, unit, packaging_size, packaging_unit)
      `)
      .eq("app_status", stage)
      .order("rupyz_created_at", { ascending: false })
      .limit(STAGE_LIMIT);

    if (error) continue;
    const rows = (data ?? []) as unknown as PipelineOrderRow[];
    for (const r of rows) {
      const customer = Array.isArray(r.customer) ? r.customer[0] : r.customer;
      const beatRel = customer?.beat;
      const beat = Array.isArray(beatRel) ? beatRel[0] : beatRel;
      cardsByStage[stage].push({
        id: r.id,
        rupyzOrderId: r.rupyz_order_id,
        customerName: customer?.name ?? "—",
        customerCity: customer?.city ?? null,
        beatName: beat?.name ?? null,
        totalAmount: Number(r.total_amount),
        kg: kgForItems(r.items ?? []),
        createdAt: r.rupyz_created_at,
      });
    }
  }

  return (
    <PipelineClient
      totals={totals}
      cardsByStage={cardsByStage}
      stageLimit={STAGE_LIMIT}
    />
  );
}
