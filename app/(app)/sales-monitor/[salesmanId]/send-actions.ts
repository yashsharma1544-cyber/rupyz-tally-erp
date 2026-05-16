"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { sendSalesmanReport, getAdminRecipients } from "@/lib/sales-monitor/send";
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

export type SendActionResult =
  | {
      ok: true;
      reportType: PdfReportType;
      recipients: { role: "salesman" | "admin"; name: string; ok: boolean; error: string | null }[];
    }
  | { ok: false; error: string };

export async function sendReportNow(
  salesmanId: string,
  date: string,
  reportType: PdfReportType,
): Promise<SendActionResult> {
  try {
    await requireAdmin();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return { ok: false, error: "Invalid date" };
    }
    if (!["morning", "midday", "evening"].includes(reportType)) {
      return { ok: false, error: "Invalid report type" };
    }

    const admins = await getAdminRecipients();
    const outcome = await sendSalesmanReport({
      salesmanId,
      date,
      reportType,
      admins,
    });

    revalidatePath(`/sales-monitor/${salesmanId}`);
    revalidatePath("/sales-monitor");

    if (!outcome.ok && outcome.recipients.length === 0) {
      return { ok: false, error: outcome.error || "Send failed" };
    }

    return {
      ok: outcome.ok,
      reportType,
      recipients: outcome.recipients.map((r) => ({
        role: r.recipient.role,
        name: r.recipient.name,
        ok: r.ok,
        error: r.error,
      })),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
