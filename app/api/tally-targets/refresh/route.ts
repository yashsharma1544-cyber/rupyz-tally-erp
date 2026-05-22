// =============================================================================
// /api/tally-targets/refresh — reads Tally Google Sheets (multiple tabs, across
// MULTIPLE spreadsheets) and reloads tally_sales for BOTH companies with
// voucher-type scoping.
//
// Each SOURCE carries its own sheetId:
//   - main sheet (TALLY_SHEET_ID): all 26-27 data + Anjali 25-26
//   - historical sheet (TALLY_SHEET_ID_2526): Sushil 25-26 only
//
// SOURCES (sheet → tab prefix → company / voucher_type):
//   Main sheet:
//     "SUSHIL AGENCIES 26-27 - GST SAL..."  → Sushil / GST SALES
//     "SUSHIL AGENCIES 26-27 - NEW MON..."  → Sushil / NEW MONDHA
//     "Anjali Agency 26-27 - GST SALES"     → Anjali / GST SALES
//     "Anjali Agency 26-27 - GST INTER..."  → Anjali / GST INTERCITY SALES
//     "Anjali Agency 26-27 - NEW MONDH..."  → Anjali / NEW MONDHA
//     "Anjali Agency 25-26 - GST SALES"     → Anjali / GST SALES
//     "Anjali Agency 25-26 - GST INTER..."  → Anjali / GST INTERCITY SALES
//     "Anjali Agency 25-26 - NEW MONDH..."  → Anjali / NEW MONDHA
//   Historical sheet (Sushil 25-26):
//     "SUSHIL AGENCIES 25-26 - GST SAL..."  → Sushil / GST SALES
//     "SUSHIL AGENCIES 25-26 - NEW MON..."  → Sushil / NEW MONDHA
//   (PRIYA SALES is never included.)
//
// Service account (GOOGLE_SHEETS_CLIENT_EMAIL) must have read access to BOTH
// spreadsheets. Tab titles are resolved by PREFIX match against each sheet's
// live metadata. Tabs are read in parallel; inserts run in concurrent batches.
//
// Env: TALLY_SHEET_ID, TALLY_SHEET_ID_2526 (optional override),
//      GOOGLE_SHEETS_CLIENT_EMAIL, GOOGLE_SHEETS_PRIVATE_KEY
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SHEET_ID = process.env.TALLY_SHEET_ID ?? "";
const SHEET_ID_2526 = process.env.TALLY_SHEET_ID_2526 ?? "19Rnz_8o8LNIKf6dFSh0WpMG9uF_y8aCkwFJBDS_y1Ic";
const CLIENT_EMAIL = process.env.GOOGLE_SHEETS_CLIENT_EMAIL ?? "";
const PRIVATE_KEY = (process.env.GOOGLE_SHEETS_PRIVATE_KEY ?? "").replace(/\\n/g, "\n");

const INSERT_CHUNK = 1000;   // rows per insert call
const INSERT_CONCURRENCY = 5; // insert calls in flight at once

// Source tabs by PREFIX (real titles may have more chars after these), each
// tagged with the spreadsheet it lives in.
const SOURCES: { company: string; voucher_type: string; fin_year: string; tabPrefix: string; sheetId: string }[] = [
  { company: "Sushil Agencies", voucher_type: "GST SALES",           fin_year: "26-27", tabPrefix: "SUSHIL AGENCIES 26-27 - GST SAL", sheetId: SHEET_ID },
  { company: "Sushil Agencies", voucher_type: "NEW MONDHA",          fin_year: "26-27", tabPrefix: "SUSHIL AGENCIES 26-27 - NEW MON", sheetId: SHEET_ID },
  { company: "Sushil Agencies", voucher_type: "GST SALES",           fin_year: "25-26", tabPrefix: "SUSHIL AGENCIES 25-26 - GST SAL", sheetId: SHEET_ID_2526 },
  { company: "Sushil Agencies", voucher_type: "NEW MONDHA",          fin_year: "25-26", tabPrefix: "SUSHIL AGENCIES 25-26 - NEW MON", sheetId: SHEET_ID_2526 },
  { company: "Anjali Agencies", voucher_type: "GST SALES",           fin_year: "26-27", tabPrefix: "Anjali Agency 26-27 - GST SALES", sheetId: SHEET_ID },
  { company: "Anjali Agencies", voucher_type: "GST INTERCITY SALES", fin_year: "26-27", tabPrefix: "Anjali Agency 26-27 - GST INTER", sheetId: SHEET_ID },
  { company: "Anjali Agencies", voucher_type: "NEW MONDHA",          fin_year: "26-27", tabPrefix: "Anjali Agency 26-27 - NEW MONDH", sheetId: SHEET_ID },
  { company: "Anjali Agencies", voucher_type: "GST SALES",           fin_year: "25-26", tabPrefix: "Anjali Agency 25-26 - GST SALES", sheetId: SHEET_ID },
  { company: "Anjali Agencies", voucher_type: "GST INTERCITY SALES", fin_year: "25-26", tabPrefix: "Anjali Agency 25-26 - GST INTER", sheetId: SHEET_ID },
  { company: "Anjali Agencies", voucher_type: "NEW MONDHA",          fin_year: "25-26", tabPrefix: "Anjali Agency 25-26 - NEW MONDH", sheetId: SHEET_ID },
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

type Row = {
  company: string; voucher_type: string; fin_year: string; sale_date: string;
  voucher_no: string | null; party_name: string; item: string | null;
  qty: number | null; rate: number | null; amount: number | null;
  qty_kg: number | null; party_group: string | null; root_group: string | null;
  guid: string | null; alter_id: string | null;
};

export async function POST(_req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Admin only" }, { status: 403 });
  if (!SHEET_ID || !CLIENT_EMAIL || !PRIVATE_KEY) {
    return NextResponse.json({ error: "Missing Google Sheets env vars" }, { status: 500 });
  }

  let token: string;
  try { token = await getAccessToken(); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 }); }

  // 1. Resolve full tab titles from EACH distinct spreadsheet's metadata (parallel).
  //    A failure on one sheet is non-fatal: its sources just stay unresolved.
  const sheetIds = [...new Set(SOURCES.map((s) => s.sheetId).filter(Boolean))];
  const titlesBySheet: Record<string, string[]> = {};
  const sheetErrors: Record<string, string> = {};
  await Promise.all(sheetIds.map(async (sid) => {
    try {
      const metaResp = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sid}?fields=sheets.properties.title`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!metaResp.ok) { sheetErrors[sid] = `${metaResp.status} ${await metaResp.text()}`; titlesBySheet[sid] = []; return; }
      const meta = await metaResp.json();
      titlesBySheet[sid] = (meta.sheets ?? []).map((s: { properties: { title: string } }) => s.properties.title);
    } catch (e) {
      sheetErrors[sid] = e instanceof Error ? e.message : String(e);
      titlesBySheet[sid] = [];
    }
  }));

  const resolve = (sid: string, prefix: string): string | null =>
    (titlesBySheet[sid] ?? []).find((t) => t.startsWith(prefix)) ?? null;

  // 2. Read every source tab IN PARALLEL and build rows.
  const perSource = await Promise.all(SOURCES.map(async (src) => {
    const fullTitle = resolve(src.sheetId, src.tabPrefix);
    if (!fullTitle) return { entry: { sheetId: src.sheetId, tab: src.tabPrefix, rows: 0, resolved: false }, rows: [] as Row[] };
    const range = `'${fullTitle.replace(/'/g, "''")}'!A:R`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${src.sheetId}/values/${encodeURIComponent(range)}`;
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!resp.ok) return { entry: { sheetId: src.sheetId, tab: fullTitle, rows: 0, resolved: true }, rows: [] as Row[] };
    const json = await resp.json();
    const values = (json.values ?? []) as string[][];
    if (values.length < 2) return { entry: { sheetId: src.sheetId, tab: fullTitle, rows: 0, resolved: true }, rows: [] as Row[] };

    const hdr = values[0].map((h) => (h ?? "").toString().trim());
    const ci = (name: string) => hdr.indexOf(name);
    const cDate = ci("Date"), cVno = ci("Voucher No"), cParty = ci("Party Name"),
      cItem = ci("Item"), cQty = ci("Qty"), cRate = ci("Rate"), cAmt = ci("Amount"),
      cKg = ci("Qty (Kg)"), cPg = ci("Party Group"), cRg = ci("Root Group"),
      cGuid = ci("GUID"), cAlter = ci("AlterID");

    const rows: Row[] = [];
    for (let i = 1; i < values.length; i++) {
      const r = values[i];
      const d = normDate(r[cDate]);
      if (!d) continue;
      const party = (r[cParty] ?? "").toString().trim();
      if (!party) continue;
      rows.push({
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
    }
    return { entry: { sheetId: src.sheetId, tab: fullTitle, rows: rows.length, resolved: true }, rows };
  }));

  const allRows: Row[] = perSource.flatMap((p) => p.rows);
  const perTab = perSource.map((p) => p.entry);

  if (allRows.length === 0) {
    return NextResponse.json({ error: "No rows parsed from any source tab", perTab, sheetErrors }, { status: 400 });
  }

  // 3. Wipe + reload (inserts run in concurrent waves)
  const admin = createAdminClient();
  const { error: delErr } = await admin.from("tally_sales").delete().neq("id", -1);
  if (delErr) return NextResponse.json({ error: `Clear failed: ${delErr.message}` }, { status: 500 });

  const chunks: Row[][] = [];
  for (let i = 0; i < allRows.length; i += INSERT_CHUNK) chunks.push(allRows.slice(i, i + INSERT_CHUNK));

  let inserted = 0;
  for (let i = 0; i < chunks.length; i += INSERT_CONCURRENCY) {
    const wave = chunks.slice(i, i + INSERT_CONCURRENCY);
    const results = await Promise.all(wave.map((c) => admin.from("tally_sales").insert(c)));
    const failed = results.find((r) => r.error);
    if (failed?.error) return NextResponse.json({ error: `Insert failed: ${failed.error.message}`, inserted, perTab, sheetErrors }, { status: 500 });
    inserted += wave.reduce((a, c) => a + c.length, 0);
  }

  return NextResponse.json({ ok: true, inserted, perTab, sheetErrors });
}

export async function GET() {
  return NextResponse.json({ error: "POST only" }, { status: 405 });
}