"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { sendSalesmanReport, getAdminRecipients, type SendMode } from "@/lib/sales-monitor/send";
import type { PdfReportType } from "@/lib/sales-monitor/pdf/render";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { data: appUser } = await supabase
    .from("app_users")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!appUser || appUser.role !== "admin") throw new Error("Not authorized");
}

export type SendActionRecipient = {
  role: "salesman" | "admin";
  name: string;
  ok: boolean;
  error: string | null;
};

export type SendActionResult = {
  ok: boolean;
  reportType?: PdfReportType;
  mode?: SendMode;
  recipients?: SendActionRecipient[];
  error?: string;
};

export async function sendReportNow(
  salesmanId: string,
  date: string,
  reportType: PdfReportType,
  mode: SendMode = "default",
): Promise<SendActionResult> {
  try {
    await requireAdmin();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return { ok: false, error: "Invalid date" };
    }
    if (!["morning", "midday", "evening"].includes(reportType)) {
      return { ok: false, error: "Invalid report type" };
    }
    if (!["default", "admin_only"].includes(mode)) {
      return { ok: false, error: "Invalid send mode" };
    }

    const admins = await getAdminRecipients();
    const outcome = await sendSalesmanReport({
      salesmanId,
      date,
      reportType,
      admins,
      mode,
    });

    revalidatePath(`/sales-monitor/${salesmanId}`);
    revalidatePath("/sales-monitor");

    if (outcome.recipients.length === 0) {
      return { ok: false, error: outcome.error || "Send failed", reportType, mode };
    }

    return {
      ok: outcome.ok,
      reportType,
      mode,
      recipients: outcome.recipients.map((r) => ({
        role: r.recipient.role,
        name: r.recipient.name,
        ok: r.ok,
        error: r.error,
      })),
      error: outcome.ok ? undefined : (outcome.error || undefined),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
