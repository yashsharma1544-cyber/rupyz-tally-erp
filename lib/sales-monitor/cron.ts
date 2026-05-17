/**
 * Cron dispatcher for daily sales monitor reports.
 *
 * Schedule (all IST):
 *   9:30 AM — runCoordinatorCron()
 *   9:55 AM — runSalesmanCron("morning")
 *   1:00 PM — runSalesmanCron("midday")
 *   7:30 PM — runSalesmanCron("evening")
 *
 * Idempotency: salesman crons skip recipients that already have a "sent"
 * row in daily_sales_reports for today + this report_type. Safe to retry.
 *
 * Coordinator cron is logged informationally but not deduplicated by the
 * daily_sales_reports table (different shape). If it runs twice the
 * coordinator gets two WhatsApp messages.
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import {
  sendSalesmanReport,
  sendCoordinatorReminder,
  getAdminRecipients,
} from "@/lib/sales-monitor/send";
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
 * Today's date in IST as YYYY-MM-DD. The system runs from UTC servers but
 * the business day is IST.
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

  if (salesmanIds.length === 0) {
    return {
      type: reportType,
      date,
      totalAttempted: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      details: [],
      extra: { reason: "no salesmen with beat assignment today" },
    };
  }

  // Idempotency: skip salesmen who already received this report today
  const { data: alreadySent } = await admin
    .from("daily_sales_reports")
    .select("salesman_id")
    .eq("report_date", date)
    .eq("report_type", reportType)
    .eq("status", "sent");
  const sentIds = new Set((alreadySent ?? []).map((r) => r.salesman_id));

  // Admins (recipients for midday + evening)
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

  return {
    type: reportType,
    date,
    totalAttempted: salesmanIds.length,
    succeeded,
    failed,
    skipped,
    details,
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
      details: details.length > 0
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

/**
 * Verify the incoming request is from Vercel's cron pinger.
 *
 * Vercel sends `Authorization: Bearer <CRON_SECRET>` automatically. The
 * secret is set in the project env. If unset, allow only when the request
 * has Vercel's user-agent (defensive default but not strictly required).
 */
export function isAuthorizedCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.warn("CRON_SECRET not set — cron auth check is bypassed");
    return false;
  }
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}
