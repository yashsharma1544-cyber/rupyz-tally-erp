import { createClient } from "@/lib/supabase/server";

/**
 * Sales monitor compute layer — TypeScript wrappers around the SQL RPCs.
 * Used by the admin Sales Monitor page, the per-salesman detail page, and
 * (Phase 3+) the PDF report generators and Phase 5 cron jobs.
 */

export type SalesmanSummaryRow = {
  salesman_id: string;
  salesman_name: string;
  salesman_phone: string | null;
  beat_id: string | null;
  beat_name: string | null;
  beat_city: string | null;
  sc: number;
  target_kg: number | null;
  calls_done: number;
  kg_done: number;
  checked_in_at: string | null;
};

export type FocusCustomer = {
  id: string;
  name: string;
  mobile: string | null;
  city: string | null;
  last_order_date?: string | null;
  days_since_last_order?: number | null;
};

export type SalesmanDayStatus = {
  salesman_id: string;
  salesman_name: string;
  salesman_phone: string | null;
  date: string;
  has_assignment: boolean;
  beat_id: string | null;
  beat_name: string | null;
  beat_city: string | null;
  sc: number;
  target_kg: number | null;
  calls_done: number;
  kg_done: number;
  checked_in_at: string | null;
  last_beat_date: string | null;
  focus_no_order_last_visit: FocusCustomer[];
  focus_no_order_in_15_days: FocusCustomer[];
};

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

/** Format a kg number for display (no decimals when whole, 1 decimal otherwise). */
export function formatKg(n: number | null | undefined): string {
  if (n == null) return "—";
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return Number.isInteger(v) ? v.toLocaleString("en-IN") : v.toLocaleString("en-IN", { maximumFractionDigits: 1 });
}

/** Percentage (0-100), null-safe; returns null if denominator missing/zero. */
export function pct(numerator: number | null | undefined, denominator: number | null | undefined): number | null {
  if (numerator == null || denominator == null || denominator <= 0) return null;
  return Math.round((Number(numerator) / Number(denominator)) * 100);
}
