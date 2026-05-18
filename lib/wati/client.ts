/**
 * WATi WhatsApp Business API client.
 *
 * Usage:
 *   const result = await sendTemplateMessage({
 *     whatsappNumber: "919860748060",
 *     templateName: "sales_morning_briefing_v5",
 *     broadcastName: "morning_2026-05-18_akshay",
 *     bodyVariables: ["Akshay", "D Raja", "41", "100"],
 *     headerDocumentUrl: "https://supabase.co/.../signed.pdf",
 *     headerDocumentFilename: "Akshay_Morning_Briefing_2026-05-18.pdf",
 *   });
 *
 * Env:
 *   WATI_API_ENDPOINT  — tenant URL, e.g. https://live-mt-server.wati.io/<tenant-id>
 *   WATI_ACCESS_TOKEN  — bearer token from WATi → API Docs
 *
 * The exact request shape varies a bit across WATi tenants. This client uses
 * the most common v1 sendTemplateMessage pattern with a header_handle for the
 * PDF. If your tenant returns a 4xx with "invalid parameters", capture the
 * raw response (returned in `body`) and we'll adjust the schema.
 */

export interface WatiSendOptions {
  whatsappNumber: string;
  templateName: string;
  broadcastName: string;
  bodyVariables: string[];
  headerDocumentUrl?: string;
  headerDocumentFilename?: string;
  buttonPayloads?: string[]; // For templates with quick reply buttons
}

export interface WatiSendResult {
  ok: boolean;
  status: number;
  messageId: string | null;
  rawResponse: unknown;
  error: string | null;
}

function normalizeEndpoint(endpoint: string): string {
  return endpoint.replace(/\/+$/, "");
}

function normalizePhone(phone: string): string {
  // E.164 without + sign, e.g. 919860748060
  return phone.replace(/[^0-9]/g, "");
}

export async function sendTemplateMessage(
  opts: WatiSendOptions,
): Promise<WatiSendResult> {
  const endpoint = process.env.WATI_API_ENDPOINT;
  const token = process.env.WATI_ACCESS_TOKEN;

  if (!endpoint || !token) {
    return {
      ok: false,
      status: 0,
      messageId: null,
      rawResponse: null,
      error: "WATi credentials not configured (WATI_API_ENDPOINT / WATI_ACCESS_TOKEN)",
    };
  }

  const whatsappNumber = normalizePhone(opts.whatsappNumber);
  if (whatsappNumber.length < 10) {
    return {
      ok: false,
      status: 0,
      messageId: null,
      rawResponse: null,
      error: `Invalid WhatsApp number: ${opts.whatsappNumber}`,
    };
  }

  // Build the parameters array. WATi expects { name: "1", value: "..." } pairs
  // for body variables.
  const parameters = opts.bodyVariables.map((value, i) => ({
    name: String(i + 1),
    value,
  }));

  const body: Record<string, unknown> = {
    template_name: opts.templateName,
    broadcast_name: opts.broadcastName,
    parameters,
  };

  if (opts.headerDocumentUrl) {
    body.header_document = {
      url: opts.headerDocumentUrl,
      filename: opts.headerDocumentFilename ?? "report.pdf",
    };
  }

  const url = `${normalizeEndpoint(endpoint)}/api/v1/sendTemplateMessage?whatsappNumber=${encodeURIComponent(whatsappNumber)}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const rawText = await res.text();
    let parsed: unknown = rawText;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      // Leave as text if not JSON
    }

    // WATi typically returns { result: true, messageId: "..." } on success,
    // or { result: false, info: "..." } on failure. Codes vary.
    const looksOk =
      res.ok &&
      typeof parsed === "object" &&
      parsed !== null &&
      ("result" in parsed ? (parsed as { result: unknown }).result !== false : true);

    const messageId =
      typeof parsed === "object" &&
      parsed !== null &&
      "messageId" in parsed
        ? String((parsed as { messageId: unknown }).messageId)
        : null;

    return {
      ok: looksOk,
      status: res.status,
      messageId,
      rawResponse: parsed,
      error: looksOk
        ? null
        : extractErrorMessage(parsed) || `HTTP ${res.status}`,
    };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      messageId: null,
      rawResponse: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function extractErrorMessage(parsed: unknown): string | null {
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.info === "string") return obj.info;
  if (typeof obj.message === "string") return obj.message;
  if (typeof obj.error === "string") return obj.error;
  return null;
}

/**
 * Template names — single source of truth so we don't typo them across files.
 * Must match exactly what's approved in the WATi dashboard.
 *
 * History:
 *   - v4/v3/v2 templates (sales_morning_briefing_v4 etc.) cached Akshay's
 *     first PDF media-id at Meta level and reused it on every send. Bumped
 *     to fresh template names with a neutral sample PDF on 2026-05-18.
 *   - daily_summary_v1 added so admin summaries use a dedicated template
 *     instead of borrowing the salesman evening template (where the body
 *     text had to be hacked with "Sushil Agencies (Admin)" placeholders).
 */
export const WATI_TEMPLATES = {
  morning: "sales_morning_briefing_v5",
  midday: "sales_midday_update_v4",
  evening: "sales_evening_final_v3",
  daily_summary: "daily_summary_v1",
  coordinator_reminder: "beat_assignment_reminder_v1",
} as const;
