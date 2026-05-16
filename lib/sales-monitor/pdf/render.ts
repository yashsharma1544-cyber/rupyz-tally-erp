/**
 * Server-side PDF rendering helpers. Node runtime only.
 *
 * Used by:
 *   - /api/sales-monitor/pdf/[type]/[salesmanId]    â€” admin preview/download
 *   - Phase 5 cron jobs (when added)                 â€” generate + upload to Storage
 */

import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import {
  MorningBriefingPDF,
  MiddayReportPDF,
  EveningReportPDF,
} from "./documents";
import type { SalesmanDayStatus } from "@/lib/sales-monitor/format";

export type PdfReportType = "morning" | "midday" | "evening";

export const PDF_REPORT_TYPES: PdfReportType[] = ["morning", "midday", "evening"];

function nowInIst(): string {
  return new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export async function renderSalesmanPdf(
  type: PdfReportType,
  status: SalesmanDayStatus,
): Promise<Buffer> {
  const generatedAt = nowInIst();
  const props = { status, generatedAt };
  const element =
    type === "morning"
      ? React.createElement(MorningBriefingPDF, props)
      : type === "midday"
        ? React.createElement(MiddayReportPDF, props)
        : React.createElement(EveningReportPDF, props);
  return renderToBuffer(element as React.ReactElement<any>);
}

export function pdfFilename(
  type: PdfReportType,
  salesmanName: string,
  date: string,
): string {
  const safeName = salesmanName.replace(/[^a-zA-Z0-9]+/g, "_").slice(0, 32);
  const label =
    type === "morning"
      ? "Morning_Briefing"
      : type === "midday"
        ? "Midday_Update"
        : "Evening_Report";
  return `${safeName}_${label}_${date}.pdf`;
}
