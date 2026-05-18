"use server";

import { createClient } from "@/lib/supabase/server";
import { sendCoordinatorReminder } from "@/lib/sales-monitor/send";
import { runSummaryCron } from "@/lib/sales-monitor/summary";
import { runSalesmanCron, todayIST } from "@/lib/sales-monitor/cron";
import type { PdfReportType } from "@/lib/sales-monitor/pdf/render";

/**
 * Server actions to fire cron-style sends from the admin UI.
 *
 * These bypass CRON_SECRET because they're authenticated by the user's
 * Supabase session (admin role required). Useful when you can't see the
 * cron secret in Vercel's "sensitive" env masking but still want to test
 * what the scheduled cron will do at 9:30 AM / 9:55 AM / 1 PM / 7:30 PM.
 */

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const { data: me } = await supabase
    .from("app_users")
    .select("role, active")
    .eq("id", user.id)
    .single();
  if (!me?.active || me.role !== "admin") throw new Error("Not authorized — admin only");
}

export type TestResult = {
  ok: boolean;
  summary?: string;
  error?: string;
};

/**
 * Fire the coordinator reminder right now. Same call the 9:30 AM cron makes.
 */
export async function testCoordinatorReminder(): Promise<TestResult> {
  try {
    await requireAdmin();
    const result = await sendCoordinatorReminder({ date: todayIST() });

    const successful = result.recipients.filter((r) => r.ok);
    const failed = result.recipients.filter((r) => !r.ok);

    const lines: string[] = [];
    if (successful.length > 0) {
      lines.push(
        `Sent to ${successful.map((r) => r.recipient.name).join(", ")}`,
      );
    }
    if (failed.length > 0) {
      lines.push(
        `Failed: ${failed.map((r) => `${r.recipient.name} (${r.error})`).join(", ")}`,
      );
    }
    if (result.recipients.length === 0) {
      lines.push(result.error || "No coordinator recipients found");
    }
    lines.push(
      `${result.pendingCount} of ${result.totalActiveSalesmen} salesmen still need a beat for today`,
    );

    return {
      ok: result.ok && successful.length > 0,
      summary: lines.join("\n"),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Fire all three daily summary sends (morning + midday + evening) sequentially.
 * Each admin receives 3 WhatsApp messages — so two admins = 6 messages total.
 */
export async function testAllAdminSummaries(): Promise<TestResult> {
  try {
    await requireAdmin();
    const date = todayIST();
    const types: PdfReportType[] = ["morning", "midday", "evening"];
    const lines: string[] = [];
    let allOk = true;

    for (const type of types) {
      const r = await runSummaryCron(type, date);
      if (r.ok && r.succeeded > 0) {
        lines.push(
          `✓ ${type}: sent to ${r.succeeded} admin${r.succeeded === 1 ? "" : "s"}`,
        );
      } else {
        allOk = false;
        const firstErr = r.errors[0]?.error || "unknown error";
        lines.push(`✗ ${type}: ${firstErr}`);
      }
    }

    return {
      ok: allOk,
      summary: lines.join("\n"),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Fire the full salesman cron for one report type — exactly what runs at the
 * scheduled time. Sends a per-salesman PDF to every active salesman with a
 * beat assigned today, plus the admin daily summary at the end.
 *
 * Use this to:
 *   - Validate the cron pipeline end-to-end (middleware → handler → compute → WATi)
 *   - Resend a briefing if the morning cron silently failed
 *
 * WARNING: Sends real WhatsApp messages to all salesmen with beat assignments.
 */
export async function testSalesmanCron(
  reportType: PdfReportType,
): Promise<TestResult> {
  try {
    await requireAdmin();

    // The cron handler reads runSalesmanCron's return shape; we mirror that
    // here defensively (the shape is { reportType, date, recipients[], summary? }
    // or similar — handled via untyped destructure to avoid coupling).
    const r = (await runSalesmanCron(reportType)) as unknown as {
      reportType?: string;
      date?: string;
      recipients?: { name?: string; ok?: boolean; error?: string }[];
      succeeded?: number;
      failed?: number;
      attempted?: number;
      errors?: { name: string; error: string }[];
      summary?: {
        ok?: boolean;
        succeeded?: number;
        failed?: number;
        adminRecipientsAttempted?: number;
      };
    };

    const lines: string[] = [];

    // Per-salesman tally — prefer explicit counts, fall back to recipients array
    let succ = r.succeeded ?? 0;
    let fail = r.failed ?? 0;
    let att = r.attempted ?? 0;
    if (Array.isArray(r.recipients)) {
      const recipients = r.recipients;
      att = att || recipients.length;
      if (!r.succeeded) succ = recipients.filter((x) => x.ok).length;
      if (!r.failed) fail = recipients.filter((x) => !x.ok).length;
    }

    if (att === 0) {
      lines.push(
        `⚠ No salesmen to send to. ` +
          `Check beat assignments for today (/sales-monitor/journey-cycles).`,
      );
    } else if (succ > 0) {
      lines.push(`✓ Salesmen: ${succ}/${att} received PDF`);
    } else {
      lines.push(`✗ Salesmen: 0/${att} sent`);
    }

    // Surface first few per-salesman errors if any
    const errs =
      r.errors ??
      (Array.isArray(r.recipients)
        ? r.recipients
            .filter((x) => !x.ok && x.error)
            .map((x) => ({ name: x.name ?? "?", error: x.error ?? "?" }))
        : []);
    if (errs.length > 0) {
      const sample = errs.slice(0, 3).map((e) => `${e.name}: ${e.error}`).join("; ");
      lines.push(
        `Errors: ${sample}${errs.length > 3 ? ` …(+${errs.length - 3} more)` : ""}`,
      );
    }

    // Admin summary tally
    if (r.summary) {
      const sSucc = r.summary.succeeded ?? 0;
      const sAtt = r.summary.adminRecipientsAttempted ?? 0;
      const sOk = r.summary.ok ?? (r.summary.failed === 0);
      if (sAtt === 0) {
        lines.push(`⚠ Admin summary skipped (no admins resolved).`);
      } else if (sOk && sSucc > 0) {
        lines.push(`✓ Admin summary: ${sSucc}/${sAtt} admin${sAtt === 1 ? "" : "s"}`);
      } else {
        lines.push(`✗ Admin summary: ${sSucc}/${sAtt} admin${sAtt === 1 ? "" : "s"}`);
      }
    }

    return {
      ok: fail === 0 && succ > 0,
      summary: lines.join("\n"),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
