/**
 * End-to-end send orchestration for sales monitor reports.
 *
 * Variable counts match each approved WATi template:
 *   morning  — 4 vars: name, beat, sc, target_kg
 *   midday   — 4 vars: name, date, calls_str, kg_str (revised 4-var template)
 *   evening  — 6 vars: name, date, calls, kg_sold, percent, kg_target (original 6-var template)
 *
 * If you later resubmit the evening template as a 4-var version for consistency,
 * change buildBodyVariables() to match.
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

export type SendMode = "default" | "admin_only";

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

  // Morning: 4 vars — name, beat, sc, target_kg
  if (type === "morning") {
    return [
      status.salesman_name,
      status.beat_name || "—",
      String(status.sc),
      status.target_kg != null ? formatKg(status.target_kg) : "—",
    ];
  }

  // Midday: 4 vars — name, date, calls_str, kg_str (compound strings)
  if (type === "midday") {
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
    return [status.salesman_name, dateLabel, callsStr, kgStr];
  }

  // Evening: 6 vars — name, date, total_calls, kg_sold, percent, kg_target
  // Matches the approved 6-variable template body:
  //   End-of-day report for {{1}} on {{2}}. Total calls: {{3}}.
  //   Sales: {{4}} kg ({{5}}% of {{6}} kg target). Day statistics attached.
  const kgPct = pct(status.kg_done, status.target_kg);
  return [
    status.salesman_name,                                        // {{1}} name
    dateLabel,                                                   // {{2}} date
    String(status.calls_done),                                   // {{3}} total calls
    formatKg(status.kg_done),                                    // {{4}} kg sold (no unit, template has "kg" literal)
    kgPct !== null ? String(kgPct) : "0",                        // {{5}} percent (no % sign, template has it)
    status.target_kg != null ? formatKg(status.target_kg) : "0", // {{6}} kg target
  ];
}

function templateNameFor(type: PdfReportType): string {
  return type === "morning"
    ? WATI_TEMPLATES.morning
    : type === "midday"
      ? WATI_TEMPLATES.midday
      : WATI_TEMPLATES.evening;
}

export async function sendSalesmanReport(opts: {
  salesmanId: string;
  date: string;
  reportType: PdfReportType;
  admins: { name: string; whatsappNumber: string }[];
  mode?: SendMode;
}): Promise<SendReportOutcome> {
  const { salesmanId, date, reportType, admins } = opts;
  const mode: SendMode = opts.mode || "default";

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

  const recipients: SendRecipient[] = [];

  if (mode === "admin_only") {
    for (const a of admins) {
      if (a.whatsappNumber) {
        recipients.push({ role: "admin", name: a.name, whatsappNumber: a.whatsappNumber });
      }
    }
    if (recipients.length === 0) {
      return {
        ok: false,
        salesmanId,
        date,
        reportType,
        storagePath: null,
        signedUrl: null,
        recipients: [],
        error: "No admin recipients with phone — set phone on your app_users row",
      };
    }
  } else {
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
    recipients.push({
      role: "salesman",
      name: status.salesman_name,
      whatsappNumber: status.salesman_phone,
    });
    if (reportType !== "morning") {
      for (const a of admins) {
        if (a.whatsappNumber) {
          recipients.push({ role: "admin", name: a.name, whatsappNumber: a.whatsappNumber });
        }
      }
    }
  }

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
  const broadcastName = `${reportType}_${date}_${salesmanId.slice(0, 8)}${mode === "admin_only" ? "_test" : ""}`;

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

  if (mode === "default") {
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
  }

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
