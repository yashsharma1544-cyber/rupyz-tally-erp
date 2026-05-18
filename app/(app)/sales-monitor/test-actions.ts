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
  if (!me?.active || !["admin", "accounts"].includes(me.role)) throw new Error("Not authorized — admin or accounts only");
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
 * Idempotent: salesmen who already got today's report for this type are
 * skipped — re-clicking is safe.
 *
 * WARNING: Sends real WhatsApp messages to all salesmen with beat assignments.
 */
export async function testSalesmanCron(
  reportType: PdfReportType,
): Promise<TestResult> {
  try {
    await requireAdmin();
    const r = await runSalesmanCron(reportType);

    const lines: string[] = [];

    // Per-salesman tally
    if (r.totalAttempted === 0) {
      lines.push(
        `⚠ No salesmen have a beat assigned for ${r.date}. ` +
          `Check /sales-monitor/journey-cycles or salesman_beat_assignments.`,
      );
    } else {
      if (r.succeeded > 0) {
        const names = r.details
          .filter((d) => d.ok)
          .map((d) => d.name)
          .slice(0, 6)
          .join(", ");
        const more = r.succeeded > 6 ? ` (+${r.succeeded - 6} more)` : "";
        lines.push(
          `✓ Salesmen sent: ${r.succeeded}/${r.totalAttempted}${names ? ` — ${names}${more}` : ""}`,
        );
      }
      if (r.skipped > 0) {
        lines.push(`↷ Skipped ${r.skipped} (already sent today; idempotent)`);
      }
      if (r.failed > 0) {
        const errs = r.details.filter((d) => !d.ok);
        const sample = errs
          .slice(0, 3)
          .map((d) => `${d.name}: ${d.error ?? "?"}`)
          .join("; ");
        lines.push(
          `✗ Failed ${r.failed}: ${sample}${errs.length > 3 ? ` …(+${errs.length - 3} more)` : ""}`,
        );
      }
    }

    // Admin summary tally
    if (r.summary) {
      const s = r.summary;
      if (s.adminRecipientsAttempted === 0) {
        lines.push(`⚠ Admin summary skipped (no admins resolved)`);
      } else if (s.ok && s.succeeded > 0) {
        lines.push(
          `✓ Admin summary: ${s.succeeded}/${s.adminRecipientsAttempted} admin${s.adminRecipientsAttempted === 1 ? "" : "s"}`,
        );
      } else {
        const firstErr = s.errors[0]?.error ?? "unknown";
        lines.push(
          `✗ Admin summary: ${s.succeeded}/${s.adminRecipientsAttempted} — ${firstErr}`,
        );
      }
    }

    // Overall ok: nothing failed, and at least one channel had a real send
    // (or there was genuinely nothing to do today)
    const anyPerSalesmanOk = r.succeeded > 0;
    const anyAdminOk = (r.summary?.succeeded ?? 0) > 0;
    const allClean = r.failed === 0 && (r.summary?.failed ?? 0) === 0;

    return {
      ok: allClean && (anyPerSalesmanOk || anyAdminOk || r.totalAttempted === 0),
      summary: lines.join("\n"),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
