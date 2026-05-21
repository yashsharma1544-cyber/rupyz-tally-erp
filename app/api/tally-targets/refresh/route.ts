// =============================================================================
// /api/tally-targets/refresh — re-reads the Tally Google Sheet and reloads
// the tally_sales table. Admin-only. Uses a Google service account (env vars
// GOOGLE_SHEETS_CLIENT_EMAIL, GOOGLE_SHEETS_PRIVATE_KEY, TALLY_SHEET_ID).
//
// Reads the sheet via the Sheets API v4 values endpoint. Parses the same column
// layout as the manual import: Date, Voucher No, Party Name, Item, Qty, Rate,
// Amount, ... Qty (Kg) [idx 15], Party Group [idx 16], Root Group [idx 17].
// Only rows with a real date + a sales layout are loaded.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SHEET_ID = process.env.TALLY_SHEET_ID ?? "";
const CLIENT_EMAIL = process.env.GOOGLE_SHEETS_CLIENT_EMAIL ?? "";
const PRIVATE_KEY = (process.env.GOOGLE_SHEETS_PRIVATE_KEY ?? "").replace(/\\n/g, "\n");
// Tab + range. A1 across the columns we need. Default first tab.
const RANGE = process.env.TALLY_SHEET_RANGE ?? "A:R";

async function requireAdmin(): Promise<boolean> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data: me } = await supabase
    .from("app_users").select("role, active").eq("id", user.id).single();
  return !!me?.active && me.role === "admin";
}

// ---- Minimal Google JWT → access token (no SDK needed) ---------------------
async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: CLIENT_EMAIL,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };
  const b64url = (obj: object) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  const unsigned = `${b64url(header)}.${b64url(claim)}`;

  const crypto = await import("node:crypto");
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(PRIVATE_KEY).toString("base64url");
  const jwt = `${unsigned}.${signature}`;

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!resp.ok) {
    throw new Error(`Google token error: ${resp.status} ${await resp.text()}`);
  }
  const json = await resp.json();
  return json.access_token as string;
}

function toNum(s: string | undefined): number | null {
  if (s == null || s === "") return null;
  const n = Number(String(s).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export async function POST(_req: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  if (!SHEET_ID || !CLIENT_EMAIL || !PRIVATE_KEY) {
    return NextResponse.json(
      { error: "Missing Google Sheets env vars (TALLY_SHEET_ID, GOOGLE_SHEETS_CLIENT_EMAIL, GOOGLE_SHEETS_PRIVATE_KEY)" },
      { status: 500 },
    );
  }

  let rowsRaw: string[][];
  try {
    const token = await getAccessToken();
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(RANGE)}`;
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!resp.ok) {
      return NextResponse.json({ error: `Sheets read failed: ${resp.status} ${await resp.text()}` }, { status: 502 });
    }
    const json = await resp.json();
    rowsRaw = (json.values ?? []) as string[][];
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }

  // Parse: keep rows whose col 0 is a YYYY-MM-DD date and that have a Party Group.
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  type Row = {
    sale_date: string; voucher_no: string | null; party_name: string;
    item: string | null; qty: number | null; rate: number | null;
    amount: number | null; qty_kg: number | null;
    party_group: string | null; root_group: string | null;
    guid: string | null; alter_id: string | null; source_row: number;
  };
  const rows: Row[] = [];
  rowsRaw.forEach((r, i) => {
    if (!r || !dateRe.test((r[0] ?? "").trim())) return;
    // Sales layout has Party Group at index 16. Skip short receipt rows.
    const partyGroup = (r[16] ?? "").trim();
    const partyName = (r[2] ?? "").trim();
    if (!partyName) return;
    rows.push({
      sale_date: r[0].trim(),
      voucher_no: (r[1] ?? "").trim() || null,
      party_name: partyName,
      item: (r[3] ?? "").trim() || null,
      qty: toNum(r[4]),
      rate: toNum(r[5]),
      amount: toNum(r[6]),
      qty_kg: toNum(r[15]),
      party_group: partyGroup || null,
      root_group: (r[17] ?? "").trim() || null,
      guid: (r[13] ?? "").trim() || null,
      alter_id: (r[14] ?? "").trim() || null,
      source_row: i + 1,
    });
  });

  if (rows.length === 0) {
    return NextResponse.json({ error: "No sales rows parsed from sheet — check the tab/range and column layout." }, { status: 400 });
  }

  const admin = createAdminClient();
  // Wipe + reload (snapshot semantics)
  const { error: delErr } = await admin.from("tally_sales").delete().neq("id", -1);
  if (delErr) return NextResponse.json({ error: `Clear failed: ${delErr.message}` }, { status: 500 });

  // Insert in chunks of 500
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await admin.from("tally_sales").insert(chunk);
    if (error) return NextResponse.json({ error: `Insert failed at row ${i}: ${error.message}`, inserted }, { status: 500 });
    inserted += chunk.length;
  }

  return NextResponse.json({ ok: true, inserted, sheet_rows: rowsRaw.length });
}

export async function GET() {
  return NextResponse.json({ error: "POST only" }, { status: 405 });
}
