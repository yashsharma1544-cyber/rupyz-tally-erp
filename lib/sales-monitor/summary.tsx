/**
 * Daily summary send orchestration.
 *
 * Fires at the end of each runSalesmanCron call (morning/midday/evening)
 * AND from the admin "Test ▾" → "Send all admin summaries" menu.
 *
 * PDF carries per-salesman info; body vars are generic placeholders since
 * (a) the approved templates expect 4 variables in a per-salesman shape and
 * (b) per request, we don't put aggregate totals in any message.
 */

import React from "react";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { pdf } from "@react-pdf/renderer";
import {
  sendTemplateMessage,
  WATI_TEMPLATES,
} from "@/lib/wati/client";
import { getAdminRecipients } from "@/lib/sales-monitor/send";
import { getSummaryForDate } from "@/lib/sales-monitor/compute";
import type { SalesmanSummaryRow } from "@/lib/sales-monitor/format";
import type { PdfReportType } from "@/lib/sales-monitor/pdf/render";
import { SummaryDocument } from "@/lib/sales-monitor/pdf/summary-document";

let adminClientCache: SupabaseClient | null = null;
function getAdminClient(): SupabaseClient {
  if (adminClientCache) return adminClientCache;
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) throw new Error("Supabase admin client env vars missing");
  adminClientCache = createClient(url, serviceRole, { auth: { persistSession: false } });
  return adminClientCache;
}

export type SummarySendResult = {
  ok: boolean;
  reportType: PdfReportType;
  date: string;
  adminRecipientsAttempted: number;
  succeeded: number;
  failed: number;
  errors: { name: string; error: string }[];
  storagePath: string | null;
};

export async function runSummaryCron(
  reportType: PdfReportType,
  date: string,
): Promise<SummarySendResult> {
  const errors: { name: string; error: string }[] = [];
  const baseResult = {
    reportType,
    date,
    adminRecipientsAttempted: 0,
    succeeded: 0,
    failed: 0,
    errors,
    storagePath: null as string | null,
  };

  let rows: SalesmanSummaryRow[];
  try {
    rows = await getSummaryForDate(date);
  } catch (e) {
    errors.push({
      name: "system",
      error: `summary fetch: ${e instanceof Error ? e.message : String(e)}`,
    });
    return { ...baseResult, ok: false, failed: 1 };
  }

  let pdfBuffer: Buffer;
  try {
    const stream = await pdf(
      <SummaryDocument reportType={reportType} date={date} rows={rows} />,
    ).toBuffer();
    pdfBuffer = await streamToBuffer(stream);
  } catch (e) {
    errors.push({
      name: "system",
      error: `pdf render: ${e instanceof Error ? e.message : String(e)}`,
    });
    return { ...baseResult, ok: false, failed: 1 };
  }

  let storagePath: string;
  let signedUrl: string;
  try {
    const uploaded = await uploadSummaryPdf({ date, reportType, pdf: pdfBuffer });
    storagePath = uploaded.storagePath;
    signedUrl = uploaded.signedUrl;
  } catch (e) {
    errors.push({
      name: "system",
      error: `upload: ${e instanceof Error ? e.message : String(e)}`,
    });
    return { ...baseResult, ok: false, failed: 1 };
  }

  const admins = await getAdminRecipients();
  if (admins.length === 0) {
    errors.push({ name: "system", error: "no admin recipients" });
    return { ...baseResult, ok: false, failed: 1, storagePath };
  }

  const bodyVars = buildSummaryBodyVariables(reportType, date);
  const templateName = templateNameFor(reportType);
  const filename = summaryPdfFilename(reportType, date);
  const broadcastName = `summary_${reportType}_${date}_${Date.now()}`;

  let succeeded = 0;
  let failed = 0;
  for (const a of admins) {
    try {
      const res = await sendTemplateMessage({
        whatsappNumber: a.whatsappNumber,
        templateName,
        broadcastName,
        bodyVariables: bodyVars,
        headerDocumentUrl: signedUrl,
        headerDocumentFilename: filename,
      });
      if (res.ok) {
        succeeded++;
      } else {
        failed++;
        errors.push({ name: a.name, error: res.error || "unknown" });
      }
    } catch (e) {
      failed++;
      errors.push({
        name: a.name,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return {
    ...baseResult,
    ok: failed === 0,
    adminRecipientsAttempted: admins.length,
    succeeded,
    failed,
    storagePath,
  };
}

// ---- Helpers ----

function streamToBuffer(stream: NodeJS.ReadableStream | Buffer): Promise<Buffer> {
  if (Buffer.isBuffer(stream)) return Promise.resolve(stream);
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

async function uploadSummaryPdf(opts: {
  date: string;
  reportType: PdfReportType;
  pdf: Buffer;
}): Promise<{ storagePath: string; signedUrl: string }> {
  const admin = getAdminClient();
  const path = `summary/${opts.date}/${opts.reportType}.pdf`;
  const { error: upErr } = await admin.storage
    .from("sales-reports")
    .upload(path, opts.pdf, {
      contentType: "application/pdf",
      upsert: true,
    });
  if (upErr) throw new Error(upErr.message);

  const { data, error: urlErr } = await admin.storage
    .from("sales-reports")
    .createSignedUrl(path, 60 * 60 * 24);
  if (urlErr || !data?.signedUrl) {
    throw new Error(urlErr?.message || "could not create signed url");
  }
  return { storagePath: path, signedUrl: data.signedUrl };
}

function summaryPdfFilename(reportType: PdfReportType, date: string): string {
  const labels: Record<PdfReportType, string> = {
    morning: "Morning_Briefing",
    midday: "Midday_Update",
    evening: "Evening_Final",
  };
  return `Daily_Summary_${labels[reportType]}_${date}.pdf`;
}

function templateNameFor(type: PdfReportType): string {
  return type === "morning"
    ? WATI_TEMPLATES.morning
    : type === "midday"
      ? WATI_TEMPLATES.midday
      : WATI_TEMPLATES.evening;
}

/**
 * No aggregate values — body slots are filled with generic placeholders.
 * The PDF (document header) carries the per-salesman breakdown.
 *
 * Body reads slightly awkwardly because we're using per-salesman templates
 * for an admin-summary purpose. If you ever want clean copy, submit a
 * dedicated "daily_summary" template to WATi.
 */
function buildSummaryBodyVariables(
  type: PdfReportType,
  date: string,
): string[] {
  const dLabel = new Date(date).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });

  if (type === "morning") {
    // Approved body: "Good morning {{1}}. Your beat today: {{2}} ({{3}} customers). Target: {{4}} kg…"
    return [
      "Sushil Agencies (Admin)",
      "Daily Summary",
      "see attached PDF",
      "see attached PDF",
    ];
  }

  // Midday/Evening approved body: "{Mid-day update | End-of-day} for {{1}} on {{2}}. Calls: {{3}}. Sales: {{4}}…"
  return [
    "Sushil Agencies (Admin)",
    dLabel,
    "see attached PDF",
    "see attached PDF",
  ];
}
