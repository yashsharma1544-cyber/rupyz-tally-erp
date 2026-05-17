"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import {
  sendSalesmanReport,
  getAdminRecipients,
} from "@/lib/sales-monitor/send";
import type { PdfReportType } from "@/lib/sales-monitor/pdf/render";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { data: me } = await supabase
    .from("app_users")
    .select("role, active")
    .eq("id", user.id)
    .single();
  if (!me?.active || me.role !== "admin") throw new Error("Not authorized");
}

export async function retryReport(
  salesmanId: string,
  date: string,
  reportType: PdfReportType,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireAdmin();
    const admins = reportType === "morning" ? [] : await getAdminRecipients();
    const outcome = await sendSalesmanReport({
      salesmanId,
      date,
      reportType,
      admins,
      mode: "default",
    });
    revalidatePath("/sales-monitor/log");
    if (outcome.ok) return { ok: true };
    return { ok: false, error: outcome.error || "Send failed" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Generate a short-lived signed URL for a PDF stored in the sales-reports
 * bucket. Used by the "View PDF" link in the log table.
 */
export async function getPdfSignedUrl(
  salesmanId: string,
  date: string,
  reportType: PdfReportType,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  try {
    await requireAdmin();
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRole) {
      return { ok: false, error: "Supabase env vars not set" };
    }
    const admin = createAdminClient(supabaseUrl, serviceRole, {
      auth: { persistSession: false },
    });

    // Storage path matches what uploadReportPdf writes:
    //   {salesmanId}/{date}/{reportType}.pdf
    const path = `${salesmanId}/${date}/${reportType}.pdf`;
    const { data, error } = await admin.storage
      .from("sales-reports")
      .createSignedUrl(path, 60 * 10); // 10 minutes

    if (error || !data?.signedUrl) {
      return {
        ok: false,
        error: error?.message || "Could not create signed URL",
      };
    }
    return { ok: true, url: data.signedUrl };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
