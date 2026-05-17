/**
 * Daily summary send orchestration.
 *
 * Fires at the end of each runSalesmanCron call (morning/midday/evening).
 * Sends a single PDF to each admin recipient (Yash + any other admins) with
 * the full salesman table inside the PDF, and a short aggregate-totals body.
 *
 * Reuses the existing approved WATi templates (morning/midday/evening) — the
 * body just gets aggregate values instead of per-salesman ones. PDF carries
 * the actual breakdown.
 *
 * If you later want a dedicated "Daily Summary" template for cleaner copy,
 * submit one and add it to WATI_TEMPLATES, then point `templateNameFor` here.
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
import { formatKg, type SalesmanSummaryRow } from "@/lib/sales-monitor/format";
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

/**
 * Render the summary PDF for a date+reportType, upload to storage, and send
 * to all admins via WATi.
 */
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

  // Render the PDF
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

  // Upload to storage + sign URL
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

  // Recipients
  const admins = await getAdminRecipients();
  if (admins.length === 0) {
    errors.push({ name: "system", error: "no admin recipients" });
    return { ...baseResult, ok: false, failed: 1, storagePath };
  }

  // Body vars
  const bodyVars = buildSummaryBodyVariables(reportType, rows, date);
  const templateName = templateNameFor(reportType);
  const filename = summaryPdfFilename(reportType, date);
  const broadcastName = `summary_${reportType}_${date}`;

  // Send to each admin
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
    .createSignedUrl(path, 60 * 60 * 24); // 24h
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
 * Build the body variables for the WhatsApp template.
 * Morning template:  name, beat, sc, target_kg
 * Midday/Evening:    name, date, calls_compound, kg_compound
 *
 * For the summary message we put aggregate totals in the per-salesman slots.
 * The body reads slightly oddly ("Your beat today: Daily summary across 5 beats")
 * but it works, and the PDF below has the real breakdown.
 */
function buildSummaryBodyVariables(
  type: PdfReportType,
  rows: SalesmanSummaryRow[],
  date: string,
): string[] {
  const totalSC = rows.reduce((s, r) => s + r.sc, 0);
  const totalCalls = rows.reduce((s, r) => s + r.calls_done, 0);
  const totalTarget = rows.reduce((s, r) => s + Number(r.target_kg || 0), 0);
  const totalKg = rows.reduce((s, r) => s + Number(r.kg_done || 0), 0);
  const beatsCovered = rows.filter((r) => r.beat_id).length;

  const dateLabel = new Date(date).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });

  if (type === "morning") {
    return [
      "Sushil Agencies",
      `Team summary across ${beatsCovered} beat${beatsCovered === 1 ? "" : "s"}`,
      String(totalSC),
      totalTarget > 0 ? formatKg(totalTarget) : "—",
    ];
  }

  // midday / evening
  const callsPct = totalSC > 0 ? Math.round((totalCalls / totalSC) * 100) : null;
  const kgPct = totalTarget > 0 ? Math.round((totalKg / totalTarget) * 100) : null;
  const callsStr =
    totalSC > 0
      ? `${totalCalls} of ${totalSC} customers${callsPct !== null ? ` (${callsPct}%)` : ""}`
      : `${totalCalls} customers`;
  const kgStr =
    totalTarget > 0
      ? `${formatKg(totalKg)} kg of ${formatKg(totalTarget)} kg target${kgPct !== null ? ` (${kgPct}%)` : ""}`
      : `${formatKg(totalKg)} kg`;

  return ["Sushil Agencies (Team)", dateLabel, callsStr, kgStr];
}
