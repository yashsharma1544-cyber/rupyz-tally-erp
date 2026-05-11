// =============================================================================
// /insights/call-list — operational watchlist (sleeping / shrinking / new stuck)
//
// Admin sees all customers needing attention.
// Salesman (when role exists) sees only their assigned customers.
// Admin can preview as a salesman via ?as_user=<uuid>.
// =============================================================================

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CallListClient } from "./call-list-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export interface CallListRow {
  id: string;
  name: string;
  mobile: string | null;
  city: string | null;
  created_at: string;
  beat_id: string | null;
  beat_name: string | null;
  last_order_at: string | null;
  kg_30d: number;
  kg_prev_30d: number;
  kg_90d: number;
  order_count: number;
  days_since_last_order: number | null;
  growth_pct: number;
  days_since_created: number;
}

export interface CallListData {
  sleeping: CallListRow[];
  shrinking: CallListRow[];
  new_stuck: CallListRow[];
  sleeping_total: number;
  shrinking_total: number;
  new_stuck_total: number;
  scope_user_id: string;
  is_override: boolean;
  error?: string;
}

interface PageProps {
  searchParams: Promise<{ as_user?: string }>;
}

export default async function CallListPage({ searchParams }: PageProps) {
  const { as_user } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?from=/insights/call-list");

  const { data, error } = await supabase.rpc("call_list_summary", {
    p_view_as_user_id: as_user ?? null,
  });

  if (error) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <h1 className="text-base font-semibold mb-1">Couldn&apos;t load call list</h1>
        <p className="text-sm text-ink-muted">{error.message}</p>
      </div>
    );
  }
  if (!data || (data as { error?: string }).error) {
    const err = (data as { error?: string }).error ?? "unknown";
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <h1 className="text-base font-semibold mb-1">Not authorized</h1>
        <p className="text-sm text-ink-muted">{err}</p>
      </div>
    );
  }
  return <CallListClient data={data as CallListData} />;
}
