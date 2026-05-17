// =============================================================================
// /billing — billing-team queue
// =============================================================================
// Shows orders currently waiting for an invoice (app_status='approved')
// at the top, and recently invoiced orders below for reference / typo fixes.
//
// Filters: search by customer name, date range. Default: all approved + last
// 7 days of invoiced.
// =============================================================================

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BillingClient } from "./billing-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export interface BillingRow {
  id: string;
  rupyz_order_id: string;
  customer_id: string | null;
  customer_name: string;
  total_amount: number;
  approved_at: string | null;
  invoice_number: string | null;
  invoiced_at: string | null;
  invoiced_by_name: string | null;
  app_status: string;
  rupyz_created_at: string;
}

function isoDateOffset(offsetDays: number): string {
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const now = new Date(Date.now() + istOffsetMs);
  now.setUTCDate(now.getUTCDate() + offsetDays);
  return now.toISOString().slice(0, 10);
}

export default async function BillingPage({
  searchParams,
}: {
  searchParams: { q?: string; from?: string; to?: string; show?: string };
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?from=/billing");

  const { data: me } = await supabase
    .from("app_users")
    .select("role, active")
    .eq("id", user.id)
    .single();
  if (!me?.active || (me.role !== "admin" && me.role !== "billing")) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <h1 className="text-base font-semibold mb-1">Not authorized</h1>
        <p className="text-sm text-ink-muted">
          Billing access is restricted to the billing and admin roles.
        </p>
      </div>
    );
  }

  // Filters
  const q = (searchParams.q || "").trim();
  const today = isoDateOffset(0);
  const weekAgo = isoDateOffset(-6);
  const from = searchParams.from && /^\d{4}-\d{2}-\d{2}$/.test(searchParams.from)
    ? searchParams.from
    : weekAgo;
  const to = searchParams.to && /^\d{4}-\d{2}-\d{2}$/.test(searchParams.to)
    ? searchParams.to
    : today;
  const show = searchParams.show === "all"
    ? "all"
    : searchParams.show === "invoiced"
      ? "invoiced"
      : "queue"; // default: approved-only queue

  // ---- Pull awaiting-invoice (always show all, regardless of date filter)
  let approvedQ = supabase
    .from("orders")
    .select(
      "id, rupyz_order_id, customer_id, total_amount, approved_at, invoice_number, invoiced_at, invoiced_by, app_status, rupyz_created_at"
    )
    .eq("app_status", "approved")
    .order("approved_at", { ascending: true });

  const { data: approvedRaw, error: approvedErr } = await approvedQ;
  if (approvedErr) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <h1 className="text-base font-semibold mb-1">Couldn&apos;t load billing queue</h1>
        <p className="text-xs text-ink-muted">{approvedErr.message}</p>
      </div>
    );
  }

  // ---- Pull recent invoiced for reference (filtered by date range)
  let invoicedRows: typeof approvedRaw = [];
  if (show !== "queue") {
    let invoicedQ = supabase
      .from("orders")
      .select(
        "id, rupyz_order_id, customer_id, total_amount, approved_at, invoice_number, invoiced_at, invoiced_by, app_status, rupyz_created_at"
      )
      .in("app_status", show === "all"
        ? ["invoiced", "loading", "loaded", "partially_dispatched", "dispatched", "delivered"]
        : ["invoiced"])
      .not("invoiced_at", "is", null)
      .gte("invoiced_at", `${from}T00:00:00+05:30`)
      .lte("invoiced_at", `${to}T23:59:59+05:30`)
      .order("invoiced_at", { ascending: false })
      .limit(200);
    const { data, error } = await invoicedQ;
    if (error) {
      return (
        <div className="p-6 max-w-2xl mx-auto">
          <h1 className="text-base font-semibold mb-1">Couldn&apos;t load invoiced orders</h1>
          <p className="text-xs text-ink-muted">{error.message}</p>
        </div>
      );
    }
    invoicedRows = data ?? [];
  }

  // ---- Collect IDs needed for lookups
  const allRows = [...(approvedRaw ?? []), ...invoicedRows];
  const customerIds = Array.from(
    new Set(allRows.map((r) => r.customer_id).filter((x): x is string => !!x)),
  );
  const userIds = Array.from(
    new Set(allRows.map((r) => r.invoiced_by).filter((x): x is string => !!x)),
  );

  // ---- Customers in one shot
  let customerName = new Map<string, string>();
  if (customerIds.length > 0) {
    const { data: customers } = await supabase
      .from("customers")
      .select("id, name")
      .in("id", customerIds);
    for (const c of customers ?? []) customerName.set(c.id, c.name);
  }

  // ---- Invoiced-by users
  let userName = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: users } = await supabase
      .from("app_users")
      .select("id, full_name")
      .in("id", userIds);
    for (const u of users ?? []) userName.set(u.id, u.full_name);
  }

  function shape(row: typeof allRows[number]): BillingRow {
    return {
      id: row.id,
      rupyz_order_id: row.rupyz_order_id,
      customer_id: row.customer_id,
      customer_name: row.customer_id ? (customerName.get(row.customer_id) ?? "(unknown)") : "—",
      total_amount: Number(row.total_amount ?? 0),
      approved_at: row.approved_at,
      invoice_number: row.invoice_number,
      invoiced_at: row.invoiced_at,
      invoiced_by_name: row.invoiced_by ? (userName.get(row.invoiced_by) ?? null) : null,
      app_status: row.app_status,
      rupyz_created_at: row.rupyz_created_at,
    };
  }

  let queue = (approvedRaw ?? []).map(shape);
  let invoiced = invoicedRows.map(shape);

  // Apply search filter to both lists
  if (q) {
    const needle = q.toLowerCase();
    const match = (r: BillingRow) =>
      r.customer_name.toLowerCase().includes(needle) ||
      r.rupyz_order_id.toLowerCase().includes(needle) ||
      (r.invoice_number?.toLowerCase().includes(needle) ?? false);
    queue = queue.filter(match);
    invoiced = invoiced.filter(match);
  }

  return (
    <BillingClient
      queue={queue}
      invoiced={invoiced}
      role={me.role as "admin" | "billing"}
      filters={{ q, from, to, show }}
    />
  );
}
