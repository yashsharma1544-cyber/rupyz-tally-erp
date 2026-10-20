"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { LineRow } from "./out-for-delivery-client";

async function requireAdmin(): Promise<boolean> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data: me } = await supabase
    .from("app_users")
    .select("role, active")
    .eq("id", user.id)
    .single();
  return Boolean(me?.active && me.role === "admin");
}

export async function fetchInvoiceLines(invoiceId: string): Promise<LineRow[]> {
  if (!(await requireAdmin())) return [];
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("tally_invoice_lines")
    .select("line_no, item_name, hsn, qty, qty_kg, qty_raw_text, rate, amount")
    .eq("invoice_id", invoiceId)
    .order("line_no", { ascending: true });
  if (error) return [];
  return (data ?? []).map((r) => ({
    line_no: r.line_no as number | null,
    item_name: r.item_name as string | null,
    hsn: r.hsn as string | null,
    qty: r.qty as number | null,
    qty_kg: r.qty_kg as number | null,
    qty_raw_text: r.qty_raw_text as string | null,
    rate: r.rate as number | null,
    amount: r.amount as number | null,
  }));
}
