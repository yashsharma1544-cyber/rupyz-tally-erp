import { createClient } from "@/lib/supabase/server";
import type { SalesmanSummaryRow, SalesmanDayStatus } from "./format";

/**
 * Sales monitor compute layer — server-side wrappers around the SQL RPCs.
 *
 * THIS FILE IS SERVER-ONLY. It imports the server supabase client which
 * pulls in next/headers. Client components must NOT import from here —
 * use ./format instead for types and formatting utilities.
 *
 * Re-exports types from ./format so callers that need everything can keep
 * a single import path if they're server components.
 */

export type { SalesmanSummaryRow, SalesmanDayStatus, FocusCustomer } from "./format";

export async function getSummaryForDate(date: string): Promise<SalesmanSummaryRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("sales_monitor_summary", { p_date: date });
  if (error) throw new Error(`sales_monitor_summary failed: ${error.message}`);
  return (data ?? []).map((r: SalesmanSummaryRow) => ({
    ...r,
    target_kg: r.target_kg != null ? Number(r.target_kg) : null,
    kg_done: Number(r.kg_done ?? 0),
  }));
}

export async function getSalesmanDayStatus(
  salesmanId: string,
  date: string,
): Promise<SalesmanDayStatus | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("sales_monitor_status", {
    p_salesman_id: salesmanId,
    p_date: date,
  });
  if (error) throw new Error(`sales_monitor_status failed: ${error.message}`);
  if (!data || (data as { error?: string }).error) return null;
  const d = data as SalesmanDayStatus;
  return {
    ...d,
    target_kg: d.target_kg != null ? Number(d.target_kg) : null,
    kg_done: Number(d.kg_done ?? 0),
    focus_no_order_last_visit: d.focus_no_order_last_visit ?? [],
    focus_no_order_in_15_days: d.focus_no_order_in_15_days ?? [],
  };
}
