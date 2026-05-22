// =============================================================================
// /api/tally-targets/refresh — reads the Tally Google Sheet (multiple tabs) and
// reloads tally_sales for BOTH companies with voucher-type scoping.
//
// SOURCES (tab name → company / voucher_type):
//   Sushil Agencies (26-27 only):
//     "SUSHIL AGENCIES 26-27 - GST SAL..."  → GST SALES
//     "SUSHIL AGENCIES 26-27 - NEW MON..."  → NEW MONDHA
//   Anjali Agencies (25-26 + 26-27):
//     "Anjali Agency 26-27 - GST SALES"     → GST SALES
//     "Anjali Agency 26-27 - GST INTER..."  → GST INTERCITY SALES
//     "Anjali Agency 26-27 - NEW MONDH..."  → NEW MONDHA
//     "Anjali Agency 25-26 - GST SALES"     → GST SALES
//     "Anjali Agency 25-26 - GST INTER..."  → GST INTERCITY SALES
//     "Anjali Agency 25-26 - NEW MONDH..."  → NEW MONDHA
//   (PRIYA SALES is never included.)
//
// Tab titles in Google are truncated in the UI but the API needs the FULL title.
// We resolve titles by PREFIX match against the live sheet metadata, so the
// truncated names above are matched to whatever the real full titles are.
//
// Env: TALLY_SHEET_ID, GOOGLE_SHEETS_CLIENT_EMAIL, GOOGLE_SHEETS_PRIVATE_KEY
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SHEET_ID = process.env.TALLY_SHEET_ID ?? "";
const CLIENT_EMAIL = process.env.GOOGLE_SHEETS_CLIENT_EMAIL ?? "";
const PRIVATE_KEY = (process.env.GOOGLE_SHEETS_PRIVATE_KEY ?? "").replace(/\\n/g, "\n");

// Source tabs by PREFIX (the real titles may have more chars after these).
const SOURCES: { company: string; voucher_type: string; fin_year: string; tabPrefix: string }[] = [
  { company: "Sushil Agencies", voucher_type: "GST SALES",           fin_year: "26-27", tabPrefix: "SUSHIL AGENCIES 26-27 - GST SAL" },
  { company: "Sushil Agencies", voucher_type: "NEW MONDHA",          fin_year: "26-27", tabPrefix: "SUSHIL AGENCIES 26-27 - NEW MON" },
  { company: "Anjali Agencies", voucher_type: "GST SALES",           fin_year: "26-27", tabPrefix: "Anjali Agency 26-27 - GST SALES" },
  { company: "Anjali Agencies", voucher_type: "GST INTERCITY SALES", fin_year: "26-27", tabPrefix: "Anjali Agency 26-27 - GST INTER" },
  { company: "Anjali Agencies", voucher_type: "NEW MONDHA",          fin_year: "26-27", tabPrefix: "Anjali Agency 26-27 - NEW MONDH" },
  { company: "Anjali Agencies", voucher_type: "GST SALES",           fin_year: "25-26", tabPrefix: "Anjali Agency 25-26 - GST SALES" },
  { company: "Anjali Agencies", voucher_type: "GST INTERCITY SALES", fin_year: "25-26", tabPrefix: "Anjali Agency 25-26 - GST INTER" },
  { company: "Anjali Agencies", voucher_type: "NEW MONDHA",          fin_year: "25-26", tabPrefix: "Anjali Agency 25-26 - NEW MONDH" },
];

async function requireAdmin(): Promise<boolean> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data: me } = await supabase
    .from("app_users").select("role, active").eq("id", user.id).single();
  return !!me?.active && me.role === "admin";
}

async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const b64url = (obj: object) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const unsigned = `${b64url({ alg: "RS256", typ: "JWT" })}.${b64url({
    iss: CLIENT_EMAIL,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600, iat: now,
  })}`;
  const crypto = await import("node:crypto");
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned); signer.end();
  const jwt = `${unsigned}.${signer.sign(PRIVATE_KEY).toString("base64url")}`;
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt,
    }),
  });
  if (!resp.ok) throw new Error(`Google token error: ${resp.status} ${await resp.text()}`);
  return (await resp.json()).access_token as string;
}

function toNum(s: unknown): number | null {
  if (s == null || s === "") return null;
  const n = Number(String(s).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}
function normDate(s: unknown): string | null {
  if (s == null) return null;
  const m = String(s).match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

export async function POST(_req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Admin only" }, { status: 403 });
  if (!SHEET_ID || !CLIENT_EMAIL || !PRIVATE_KEY) {
    return NextResponse.json({ error: "Missing Google Sheets env vars" }, { status: 500 });
  }

  let token: string;
  try { token = await getAccessToken(); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 }); }

  // 1. Resolve full tab titles from sheet metadata
  let titles: string[];
  try {
    const metaResp = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?fields=sheets.properties.title`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!metaResp.ok) return NextResponse.json({ error: `Sheet metadata failed: ${metaResp.status} ${await metaResp.text()}` }, { status: 502 });
    const meta = await metaResp.json();
    titles = (meta.sheets ?? []).map((s: { properties: { title: string } }) => s.properties.title);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }

  const resolve = (prefix: string): string | null =>
    titles.find((t) => t.startsWith(prefix)) ?? null;

  // 2. Read each source tab and build rows
  type Row = {
    company: string; voucher_type: string; fin_year: string; sale_date: string;
    voucher_no: string | null; party_name: string; item: string | null;
    qty: number | null; rate: number | null; amount: number | null;
    qty_kg: number | null; party_group: string | null; root_group: string | null;
    guid: string | null; alter_id: string | null;
  };
  const allRows: Row[] = [];
  const perTab: { tab: string; rows: number; resolved: boolean }[] = [];

  for (const src of SOURCES) {
    const fullTitle = resolve(src.tabPrefix);
    if (!fullTitle) { perTab.push({ tab: src.tabPrefix, rows: 0, resolved: false }); continue; }
    const range = `'${fullTitle.replace(/'/g, "''")}'!A:R`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}`;
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!resp.ok) { perTab.push({ tab: fullTitle, rows: 0, resolved: true }); continue; }
    const json = await resp.json();
    const values = (json.values ?? []) as string[][];
    if (values.length < 2) { perTab.push({ tab: fullTitle, rows: 0, resolved: true }); continue; }

    // header → column index
    const hdr = values[0].map((h) => (h ?? "").toString().trim());
    const ci = (name: string) => hdr.indexOf(name);
    const cDate = ci("Date"), cVno = ci("Voucher No"), cParty = ci("Party Name"),
      cItem = ci("Item"), cQty = ci("Qty"), cRate = ci("Rate"), cAmt = ci("Amount"),
      cKg = ci("Qty (Kg)"), cPg = ci("Party Group"), cRg = ci("Root Group"),
      cGuid = ci("GUID"), cAlter = ci("AlterID");

    let n = 0;
    for (let i = 1; i < values.length; i++) {
      const r = values[i];
      const d = normDate(r[cDate]);
      if (!d) continue;
      const party = (r[cParty] ?? "").toString().trim();
      if (!party) continue;
      allRows.push({
        company: src.company, voucher_type: src.voucher_type, fin_year: src.fin_year, sale_date: d,
        voucher_no: (r[cVno] ?? "").toString().trim() || null,
        party_name: party,
        item: (r[cItem] ?? "").toString().trim() || null,
        qty: toNum(r[cQty]), rate: toNum(r[cRate]), amount: toNum(r[cAmt]),
        qty_kg: toNum(r[cKg]),
        party_group: (r[cPg] ?? "").toString().trim() || null,
        root_group: (r[cRg] ?? "").toString().trim() || null,
        guid: (r[cGuid] ?? "").toString().trim() || null,
        alter_id: (r[cAlter] ?? "").toString().trim() || null,
      });
      n++;
    }
    perTab.push({ tab: fullTitle, rows: n, resolved: true });
  }

  if (allRows.length === 0) {
    return NextResponse.json({ error: "No rows parsed from any source tab", perTab }, { status: 400 });
  }

  // 3. Wipe + reload
  const admin = createAdminClient();
  const { error: delErr } = await admin.from("tally_sales").delete().neq("id", -1);
  if (delErr) return NextResponse.json({ error: `Clear failed: ${delErr.message}` }, { status: 500 });

  let inserted = 0;
  for (let i = 0; i < allRows.length; i += 500) {
    const chunk = allRows.slice(i, i + 500);
    const { error } = await admin.from("tally_sales").insert(chunk);
    if (error) return NextResponse.json({ error: `Insert failed at ${i}: ${error.message}`, inserted }, { status: 500 });
    inserted += chunk.length;
  }

  return NextResponse.json({ ok: true, inserted, perTab });
}

export async function GET() {
  return NextResponse.json({ error: "POST only" }, { status: 405 });
}
