/**
 * Daily summary send orchestration.
 *
 * Fires at the end of each runSalesmanCron call (morning/midday/evening)
 * AND from the admin "Test ▾" → "Send all admin summaries" menu.
 *
 * As of 2026-05-18 this uses the dedicated `daily_summary_v1` template
 * (4 vars: report type label, date, salesmen list, status line). Prior to
 * this we borrowed the salesman evening template and stuffed "Sushil
 * Agencies (Admin)" + "see attached PDF" placeholders into salesman-shaped
 * body slots. The dedicated template gives admins a cleaner WhatsApp message.
 *
 * Per request, no aggregate totals appear in the body — the PDF carries
 * the per-salesman breakdown.
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

  const bodyVars = buildSummaryBodyVariables(reportType, date, rows);
  const templateName = WATI_TEMPLATES.daily_summary;
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

/**
 * Body shape — matches the approved `daily_summary_v1` template:
 *   "Daily team summary — *{{1}}*
 *    Date: *{{2}}*
 *    Salesmen: *{{3}}*
 *    Status: *{{4}}*
 *    Full breakdown attached as PDF."
 *
 *   {{1}} report type label   (e.g. "Morning Briefing")
 *   {{2}} date label          (e.g. "18 May 2026")
 *   {{3}} salesmen list       (first names, comma-separated)
 *   {{4}} status line         (neutral, varies by report type — no aggregates)
 */
function buildSummaryBodyVariables(
  type: PdfReportType,
  date: string,
  rows: SalesmanSummaryRow[],
): string[] {
  const dLabel = new Date(date).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });

  const typeLabel: Record<PdfReportType, string> = {
    morning: "Morning Briefing",
    midday: "Mid-day Update",
    evening: "Evening Final",
  };

  // First names of all salesmen in today's summary — keeps the line short
  // and readable on a WhatsApp preview. Falls back to "none today" if empty.
  const firstNames = rows
    .map((r) => {
      const name = (r.salesman_name ?? "").trim();
      if (!name) return null;
      return name.split(/\s+/)[0];
    })
    .filter((n): n is string => n !== null && n.length > 0);
  const salesmenList = firstNames.length > 0 ? firstNames.join(", ") : "none today";

  const statusLine: Record<PdfReportType, string> = {
    morning: "Day begins",
    midday: "Mid-day check-in",
    evening: "Day complete",
  };

  return [typeLabel[type], dLabel, salesmenList, statusLine[type]];
}
