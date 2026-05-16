/**
 * Sales monitor — client-safe types and formatting utilities.
 *
 * IMPORTANT: This file must NOT import anything that uses next/headers, the
 * server supabase client, or other server-only modules. It's imported from
 * client components ("use client") and pulling in server-only code breaks
 * the Next.js build.
 *
 * Server-side data fetchers live in ./compute.ts.
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

/** Format a kg number for display (no decimals when whole, 1 decimal otherwise). */
export function formatKg(n: number | null | undefined): string {
  if (n == null) return "—";
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return Number.isInteger(v)
    ? v.toLocaleString("en-IN")
    : v.toLocaleString("en-IN", { maximumFractionDigits: 1 });
}

/** Percentage (0-100), null-safe; returns null if denominator missing/zero. */
export function pct(
  numerator: number | null | undefined,
  denominator: number | null | undefined,
): number | null {
  if (numerator == null || denominator == null || denominator <= 0) return null;
  return Math.round((Number(numerator) / Number(denominator)) * 100);
}
