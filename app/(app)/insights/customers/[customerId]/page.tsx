// =============================================================================
// /insights/customers/[customerId] — customer detail page
//
// Server-fetches everything via the customer_detail RPC, hands to client UI.
// =============================================================================

import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CustomerDetailClient } from "./customer-detail-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface PageProps { params: Promise<{ customerId: string }> }

export default async function CustomerDetailPage({ params }: PageProps) {
  const { customerId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?from=/insights/customers/${customerId}`);

  const { data, error } = await supabase.rpc("customer_detail", { p_customer_id: customerId });
  if (error) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <h1 className="text-base font-semibold mb-1">Couldn't load customer</h1>
        <p className="text-sm text-ink-muted">{error.message}</p>
      </div>
    );
  }
  if (!data || (data as { error?: string }).error === "not_found") notFound();
  if ((data as { error?: string }).error === "not_authorized") {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <h1 className="text-base font-semibold mb-1">Not authorized</h1>
        <p className="text-sm text-ink-muted">This customer isn't in your scope.</p>
      </div>
    );
  }

  return <CustomerDetailClient data={data as CustomerDetailData} />;
}

// Shared shape. Repeated in the client; declared here for the page to type the cast.
export interface CustomerDetailData {
  id: string;
  name: string;
  mobile: string | null;
  city: string | null;
  beat_id: string | null;
  beat_name: string | null;
  created_at: string;
  kg_30d: number;
  kg_prev_30d: number;
  kg_90d: number;
  kg_lifetime: number;
  growth_pct: number;
  order_count: number;
  order_count_90d: number;
  last_order_at: string | null;
  days_since_last_order: number | null;
  last_visit_at: string | null;
  days_since_last_visit: number | null;
  avg_basket_kg: number;
  avg_gap_days: number;
  product_mix: Array<{ product_name: string; product_id: string | null; kg: number; line_count: number }>;
  recent_orders: Array<{
    order_id: string;
    order_created_at: string;
    kg: number | null;
    line_count: number;
    app_status: string | null;
  }>;
  confidence: "high" | "medium" | "low" | "insufficient";
}
