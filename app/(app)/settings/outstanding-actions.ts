"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { data: appUser } = await supabase
    .from("app_users").select("id, role, active").eq("id", user.id).single();
  if (!appUser?.active || appUser.role !== "admin") throw new Error("Admin only");
  return appUser.id;
}

// CSV format expected: customer_mobile,outstanding_amount
//                or:   customer_rupyz_code,outstanding_amount
// Header row is auto-detected and skipped.
export async function importOutstandingCSV(csvText: string) {
  try {
    const adminId = await requireAdmin();
    const admin = createAdminClient();

    const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (!lines.length) return { error: "CSV is empty" };

    // Detect & skip header
    let startIdx = 0;
    const firstCellLower = (lines[0].split(",")[0] ?? "").toLowerCase();
    if (
      firstCellLower.includes("mobile") ||
      firstCellLower.includes("code") ||
      firstCellLower.includes("customer") ||
      firstCellLower.includes("name")
    ) startIdx = 1;

    type Row = { key: string; amount: number };
    const parsed: Row[] = [];
    const errors: string[] = [];

    for (let i = startIdx; i < lines.length; i++) {
      const cells = lines[i].split(",").map(c => c.trim().replace(/^"|"$/g, ""));
      if (cells.length < 2) continue;
      const key = cells[0];
      const amt = parseFloat(cells[1].replace(/[^\d.-]/g, ""));
      if (!key || isNaN(amt)) {
        errors.push(`Line ${i + 1}: invalid row "${lines[i]}"`);
        continue;
      }
      parsed.push({ key, amount: amt });
    }

    if (!parsed.length) return { error: `No valid rows. ${errors.slice(0, 3).join("; ")}` };

    // Match each row to a customer (by mobile OR rupyz_code)
    let matched = 0;
    let unmatched = 0;
    const unmatchedSamples: string[] = [];

    for (const row of parsed) {
      const cleanKey = row.key.replace(/\D/g, "");
      // First try: mobile match (if it looks like a phone number)
      let custId: string | null = null;
      if (cleanKey.length >= 10) {
        const { data: c } = await admin.from("customers")
          .select("id").eq("mobile", cleanKey).maybeSingle();
        if (c) custId = c.id;
      }
      // Fallback: rupyz_code match
      if (!custId) {
        const { data: c } = await admin.from("customers")
          .select("id").eq("rupyz_code", row.key).maybeSingle();
        if (c) custId = c.id;
      }

      if (!custId) {
        unmatched++;
        if (unmatchedSamples.length < 5) unmatchedSamples.push(row.key);
        continue;
      }

      // Upsert outstanding
      const { data: existing } = await admin.from("customer_outstanding")
        .select("id").eq("customer_id", custId).maybeSingle();
      if (existing) {
        await admin.from("customer_outstanding").update({
          amount: row.amount,
          source: "tally_csv",
          imported_at: new Date().toISOString(),
          imported_by: adminId,
        }).eq("id", existing.id);
      } else {
        await admin.from("customer_outstanding").insert({
          customer_id: custId,
          amount: row.amount,
          source: "tally_csv",
          imported_by: adminId,
        });
      }
      matched++;
    }

    revalidatePath("/settings");
    return {
      ok: true,
      stats: {
        rowsParsed: parsed.length,
        matched,
        unmatched,
        unmatchedSamples,
        parseErrors: errors,
      },
    };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function clearAllOutstanding() {
  try {
    await requireAdmin();
    const admin = createAdminClient();
    const { error } = await admin.from("customer_outstanding").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) return { error: error.message };
    revalidatePath("/settings");
    return { ok: true };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
