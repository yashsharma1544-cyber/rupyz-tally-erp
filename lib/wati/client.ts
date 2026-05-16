/**
 * WATi WhatsApp Business API client.
 *
 * Usage:
 *   const result = await sendTemplateMessage({
 *     whatsappNumber: "919860748060",
 *     templateName: "sales_morning_briefing_v3",
 *     broadcastName: "morning_2026-05-16_akshay",
 *     bodyVariables: ["Akshay", "Chandan Zira", "41", "100"],
 *     headerDocumentUrl: "https://supabase.co/.../signed.pdf",
 *     headerDocumentFilename: "Akshay_Morning_Briefing_2026-05-16.pdf",
 *   });
 *
 * Env:
 *   WATI_API_ENDPOINT  â€” tenant URL, e.g. https://live-mt-server.wati.io/<tenant-id>
 *   WATI_ACCESS_TOKEN  â€” bearer token from WATi â†’ API Docs
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

  // Compose the request body. WATi's v1 sendTemplateMessage takes the variables
  // as `parameters`. For document headers, the URL goes in the same array under
  // a documented header parameter name; some tenants expect "header_document",
  // others use a "media" or "header" object. We send the most permissive shape
  // and let the user adjust if their tenant rejects.
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
 * Template names â€” single source of truth so we don't typo them across files.
 * Must match exactly what's approved in the WATi dashboard.
 */
export const WATI_TEMPLATES = {
  morning: "sales_morning_briefing_v3",
  midday: "sales_midday_update_v2",
  evening: "sales_evening_final",
} as const;
