/**
 * Cron dispatcher for daily sales monitor reports.
 *
 * Schedule (all IST):
 *   9:30 AM — runCoordinatorCron()
 *   9:55 AM — runSalesmanCron("morning")  → per-salesman briefings + admin summary
 *   1:00 PM — runSalesmanCron("midday")   → per-salesman updates + admin summary
 *   7:30 PM — runSalesmanCron("evening")  → per-salesman finals + admin summary
 *
 * Idempotency: salesman crons skip recipients that already have a "sent"
 * row in daily_sales_reports for today + this report_type. Safe to retry.
 *
 * The daily summary PDF (Phase 6b) is sent to admins as a separate
 * WhatsApp message after the per-salesman loop. The summary is NOT
 * deduplicated — each cron retry will resend it. Frequency is bounded by
 * Vercel's cron firing schedule, so in practice this is fine.
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import {
  sendSalesmanReport,
  sendCoordinatorReminder,
  getAdminRecipients,
} from "@/lib/sales-monitor/send";
import { runSummaryCron, type SummarySendResult } from "@/lib/sales-monitor/summary";
import type { PdfReportType } from "@/lib/sales-monitor/pdf/render";

let adminClientCache: SupabaseClient | null = null;
function getAdminClient(): SupabaseClient {
  if (adminClientCache) return adminClientCache;
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) throw new Error("Supabase admin client env vars missing");
  adminClientCache = createClient(url, serviceRole, { auth: { persistSession: false } });
  return adminClientCache;
}

/**
 * Today's date in IST as YYYY-MM-DD.
 */
export function todayIST(): string {
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const ist = new Date(Date.now() + istOffsetMs);
  return ist.toISOString().slice(0, 10);
}

export type CronDetail = {
  name: string;
  ok: boolean;
  error?: string | null;
};

export type CronRunSummary = {
  type: "morning" | "midday" | "evening" | "coordinator";
  date: string;
  totalAttempted: number;
  succeeded: number;
  failed: number;
  skipped: number;
  details: CronDetail[];
  summary?: SummarySendResult;
  extra?: Record<string, unknown>;
};

export async function runSalesmanCron(
  reportType: PdfReportType,
): Promise<CronRunSummary> {
  const date = todayIST();
  const admin = getAdminClient();

  // Salesmen with a beat assignment for today
  const { data: assignments, error: assignErr } = await admin
    .from("salesman_beat_assignments")
    .select("salesman_id")
    .eq("assignment_date", date);

  if (assignErr) {
    return {
      type: reportType,
      date,
      totalAttempted: 0,
      succeeded: 0,
      failed: 1,
      skipped: 0,
      details: [{ name: "system", ok: false, error: assignErr.message }],
    };
  }

  const salesmanIds = Array.from(
    new Set((assignments ?? []).map((a) => a.salesman_id)),
  );

  // Idempotency: skip salesmen who already received this report today
  const { data: alreadySent } = await admin
    .from("daily_sales_reports")
    .select("salesman_id")
    .eq("report_date", date)
    .eq("report_type", reportType)
    .eq("status", "sent");
  const sentIds = new Set((alreadySent ?? []).map((r) => r.salesman_id));

  // Admins (recipients for midday + evening per-salesman, AND for the daily summary)
  const admins = reportType === "morning" ? [] : await getAdminRecipients();

  const details: CronDetail[] = [];
  let skipped = 0;
  let succeeded = 0;
  let failed = 0;

  for (const salesmanId of salesmanIds) {
    if (sentIds.has(salesmanId)) {
      skipped++;
      continue;
    }
    try {
      const outcome = await sendSalesmanReport({
        salesmanId,
        date,
        reportType,
        admins,
        mode: "default",
      });
      const salesmanResult = outcome.recipients.find(
        (r) => r.recipient.role === "salesman",
      );
      const name = salesmanResult?.recipient.name || salesmanId.slice(0, 8);
      if (outcome.ok) {
        succeeded++;
        details.push({ name, ok: true });
      } else {
        failed++;
        details.push({ name, ok: false, error: outcome.error });
      }
    } catch (e) {
      failed++;
      details.push({
        name: salesmanId.slice(0, 8),
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // ---- Daily summary to admins ----
  // Fires regardless of whether any salesmen were sent, so admins always
  // get a digest at each scheduled time. Failures here don't fail the run.
  let summary: SummarySendResult | undefined;
  try {
    summary = await runSummaryCron(reportType, date);
  } catch (e) {
    summary = {
      ok: false,
      reportType,
      date,
      adminRecipientsAttempted: 0,
      succeeded: 0,
      failed: 1,
      errors: [{ name: "system", error: e instanceof Error ? e.message : String(e) }],
      storagePath: null,
    };
  }

  return {
    type: reportType,
    date,
    totalAttempted: salesmanIds.length,
    succeeded,
    failed,
    skipped,
    details,
    summary,
    extra: salesmanIds.length === 0
      ? { reason: "no salesmen with beat assignment today" }
      : undefined,
  };
}

export async function runCoordinatorCron(): Promise<CronRunSummary> {
  const date = todayIST();
  try {
    const outcome = await sendCoordinatorReminder({ date });
    const details: CronDetail[] = outcome.recipients.map((r) => ({
      name: r.recipient.name,
      ok: r.ok,
      error: r.error,
    }));
    return {
      type: "coordinator",
      date,
      totalAttempted: outcome.recipients.length,
      succeeded: outcome.recipients.filter((r) => r.ok).length,
      failed: outcome.recipients.filter((r) => !r.ok).length,
      skipped: 0,
      details:
        details.length > 0
          ? details
          : [{ name: "system", ok: false, error: outcome.error }],
      extra: {
        pendingCount: outcome.pendingCount,
        totalActiveSalesmen: outcome.totalActiveSalesmen,
      },
    };
  } catch (e) {
    return {
      type: "coordinator",
      date,
      totalAttempted: 0,
      succeeded: 0,
      failed: 1,
      skipped: 0,
      details: [
        {
          name: "system",
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        },
      ],
    };
  }
}

export function isAuthorizedCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.warn("CRON_SECRET not set — cron auth check is bypassed");
    return false;
  }
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}
