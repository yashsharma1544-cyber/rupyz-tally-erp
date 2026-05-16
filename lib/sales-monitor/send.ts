/**
 * End-to-end send orchestration for sales monitor reports.
 *
 *   1. Generate PDF via @react-pdf/renderer
 *   2. Upload to Supabase Storage, get a 24h signed URL
 *   3. For each recipient (salesman + admins), call WATi
 *   4. Log every send in daily_sales_reports
 *
 * Used by:
 *   - Server actions (manual "Send now" from admin UI)         — Phase 4
 *   - Cron endpoints (8 AM / 1 PM / 7:30 PM IST)                — Phase 5
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { getSalesmanDayStatus } from "@/lib/sales-monitor/compute";
import { renderSalesmanPdf, pdfFilename, type PdfReportType } from "@/lib/sales-monitor/pdf/render";
import { uploadReportPdf } from "@/lib/sales-monitor/storage";
import { sendTemplateMessage, WATI_TEMPLATES } from "@/lib/wati/client";
import { formatKg, pct } from "@/lib/sales-monitor/format";

let adminClientCache: SupabaseClient | null = null;
function getAdminClient(): SupabaseClient {
  if (adminClientCache) return adminClientCache;
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) throw new Error("Supabase admin client env vars missing");
  adminClientCache = createClient(url, serviceRole, { auth: { persistSession: false } });
  return adminClientCache;
}

export type SendRecipient = {
  role: "salesman" | "admin";
  name: string;
  whatsappNumber: string;
};

export type SendResult = {
  recipient: SendRecipient;
  ok: boolean;
  messageId: string | null;
  error: string | null;
};

export type SendReportOutcome = {
  ok: boolean;
  salesmanId: string;
  date: string;
  reportType: PdfReportType;
  storagePath: string | null;
  signedUrl: string | null;
  recipients: SendResult[];
  error: string | null;
};

/**
 * Build the body variable list for a given template + status.
 *
 * Templates approved with WATi:
 *   sales_morning_briefing   — 4 vars: name, beat, sc, target_kg
 *   sales_midday_update      — 4 vars: name, date, calls_summary, kg_summary
 *   sales_evening_final      — 4 vars: name, date, calls_summary, kg_summary
 */
function buildBodyVariables(
  type: PdfReportType,
  status: Awaited<ReturnType<typeof getSalesmanDayStatus>>,
): string[] | null {
  if (!status) return null;
  const dateLabel = new Date(status.date).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  if (type === "morning") {
    return [
      status.salesman_name,
      status.beat_name || "—",
      String(status.sc),
      status.target_kg != null ? formatKg(status.target_kg) : "—",
    ];
  }

  const callsPct = pct(status.calls_done, status.sc);
  const kgPct = pct(status.kg_done, status.target_kg);
  const callsStr =
    status.sc > 0
      ? `${status.calls_done} of ${status.sc} customers${callsPct !== null ? ` (${callsPct}%)` : ""}`
      : `${status.calls_done} customers`;
  const kgStr =
    status.target_kg != null && status.target_kg > 0
      ? `${formatKg(status.kg_done)} kg of ${formatKg(status.target_kg)} kg target${kgPct !== null ? ` (${kgPct}%)` : ""}`
      : `${formatKg(status.kg_done)} kg`;

  // Mid-day and evening use the same 4-variable shape
  return [status.salesman_name, dateLabel, callsStr, kgStr];
}

function templateNameFor(type: PdfReportType): string {
  return type === "morning"
    ? WATI_TEMPLATES.morning
    : type === "midday"
      ? WATI_TEMPLATES.midday
      : WATI_TEMPLATES.evening;
}

/**
 * Send a single report for a single salesman to all relevant recipients.
 *
 * Morning: salesman only.
 * Mid-day / Evening: salesman + provided admins.
 */
export async function sendSalesmanReport(opts: {
  salesmanId: string;
  date: string;
  reportType: PdfReportType;
  admins: { name: string; whatsappNumber: string }[];
}): Promise<SendReportOutcome> {
  const { salesmanId, date, reportType, admins } = opts;
  const admin = getAdminClient();

  // 1. Status data
  const status = await getSalesmanDayStatus(salesmanId, date);
  if (!status) {
    return {
      ok: false,
      salesmanId,
      date,
      reportType,
      storagePath: null,
      signedUrl: null,
      recipients: [],
      error: "Salesman not found",
    };
  }

  if (!status.salesman_phone) {
    return {
      ok: false,
      salesmanId,
      date,
      reportType,
      storagePath: null,
      signedUrl: null,
      recipients: [],
      error: "Salesman has no phone — cannot send WhatsApp",
    };
  }

  // Build recipient list. Morning = salesman only. Mid-day + evening = salesman + admins.
  const recipients: SendRecipient[] = [
    { role: "salesman", name: status.salesman_name, whatsappNumber: status.salesman_phone },
  ];
  if (reportType !== "morning") {
    for (const a of admins) {
      if (a.whatsappNumber) {
        recipients.push({ role: "admin", name: a.name, whatsappNumber: a.whatsappNumber });
      }
    }
  }

  // 2. PDF + upload
  let storagePath = "";
  let signedUrl = "";
  try {
    const pdf = await renderSalesmanPdf(reportType, status);
    const uploaded = await uploadReportPdf({ salesmanId, date, reportType, pdf });
    storagePath = uploaded.storagePath;
    signedUrl = uploaded.signedUrl;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logReport({ salesmanId, date, reportType, status: "failed", error: msg });
    return {
      ok: false,
      salesmanId,
      date,
      reportType,
      storagePath: null,
      signedUrl: null,
      recipients: [],
      error: `PDF/upload failed: ${msg}`,
    };
  }

  // 3. WATi sends
  const bodyVars = buildBodyVariables(reportType, status);
  if (!bodyVars) {
    return {
      ok: false,
      salesmanId,
      date,
      reportType,
      storagePath,
      signedUrl,
      recipients: [],
      error: "Could not build body variables",
    };
  }

  const templateName = templateNameFor(reportType);
  const filename = pdfFilename(reportType, status.salesman_name, date);
  const broadcastName = `${reportType}_${date}_${salesmanId.slice(0, 8)}`;

  const results: SendResult[] = [];
  for (const r of recipients) {
    const send = await sendTemplateMessage({
      whatsappNumber: r.whatsappNumber,
      templateName,
      broadcastName,
      bodyVariables: bodyVars,
      headerDocumentUrl: signedUrl,
      headerDocumentFilename: filename,
    });
    results.push({
      recipient: r,
      ok: send.ok,
      messageId: send.messageId,
      error: send.error,
    });
  }

  const allOk = results.every((r) => r.ok);
  const someFailed = results.some((r) => !r.ok);

  // 4. Log to daily_sales_reports — one row per (salesman, date, type).
  //    Status reflects the salesman-recipient outcome (the primary one).
  const salesmanResult = results.find((r) => r.recipient.role === "salesman");
  await logReport({
    salesmanId,
    date,
    reportType,
    status: salesmanResult?.ok ? "sent" : "failed",
    storagePath,
    messageId: salesmanResult?.messageId ?? null,
    error: someFailed
      ? results.filter((r) => !r.ok).map((r) => `${r.recipient.role}: ${r.error}`).join("; ")
      : null,
  });

  return {
    ok: allOk,
    salesmanId,
    date,
    reportType,
    storagePath,
    signedUrl,
    recipients: results,
    error: allOk ? null : "Some recipients failed",
  };
}

async function logReport(opts: {
  salesmanId: string;
  date: string;
  reportType: PdfReportType;
  status: "sent" | "failed" | "pending";
  storagePath?: string | null;
  messageId?: string | null;
  error?: string | null;
}): Promise<void> {
  const admin = getAdminClient();
  await admin.from("daily_sales_reports").upsert(
    {
      salesman_id: opts.salesmanId,
      report_date: opts.date,
      report_type: opts.reportType,
      status: opts.status,
      sent_at: opts.status === "sent" ? new Date().toISOString() : null,
      pdf_storage_path: opts.storagePath ?? null,
      wati_message_id: opts.messageId ?? null,
      error_message: opts.error ?? null,
    },
    { onConflict: "salesman_id,report_date,report_type" },
  );

  // Bump attempts via a small RPC-less update (read + write).
  // Simpler: increment via .update with arithmetic done client-side.
  const { data: existing } = await admin
    .from("daily_sales_reports")
    .select("attempts")
    .eq("salesman_id", opts.salesmanId)
    .eq("report_date", opts.date)
    .eq("report_type", opts.reportType)
    .single();
  if (existing) {
    await admin
      .from("daily_sales_reports")
      .update({ attempts: (existing.attempts ?? 0) + 1 })
      .eq("salesman_id", opts.salesmanId)
      .eq("report_date", opts.date)
      .eq("report_type", opts.reportType);
  }
}

/**
 * Fetch all admin recipients (app_users with role='admin' and phone set).
 */
export async function getAdminRecipients(): Promise<
  { name: string; whatsappNumber: string }[]
> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from("app_users")
    .select("full_name, phone")
    .eq("role", "admin")
    .eq("active", true)
    .not("phone", "is", null);
  if (error) {
    console.error("Failed to fetch admin recipients:", error.message);
    return [];
  }
  return (data ?? [])
    .filter((u) => u.phone && u.phone.trim().length >= 10)
    .map((u) => ({ name: u.full_name, whatsappNumber: u.phone as string }));
}
