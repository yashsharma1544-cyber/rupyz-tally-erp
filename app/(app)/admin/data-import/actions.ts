"use server";

// =============================================================================
// /admin/data-import — Tally backfill server action
//
// Receives uploaded Tally Day Book Excel, parses it, fuzzy-matches parties
// and items against Supabase customers/products, returns generated SQL +
// audit CSVs. Admin downloads, reviews, runs in Supabase SQL editor.
// =============================================================================

import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// ---------- Types ----------

interface TallyItem {
  nameRaw: string;
  qty: number;
  rate: number | null;
  amount: number | null;
  unitRaw: string | null;
}

interface TallyVoucher {
  date: string;
  voucherNumber: string;
  voucherType: string;
  partyNameRaw: string;
  totalAmount: number;
  items: TallyItem[];
}

interface CustomerRow { id: string; name: string }
interface ProductRow  { id: string; name: string; weight_kg: number | null }

interface CustomerMatch {
  partyRaw: string;
  customerId: string | null;
  newHistorical: boolean;
  score: number;
  matchedName: string | null;
}

interface ProductMatch {
  itemRaw: string;
  productId: string | null;
  score: number;
  matchedName: string | null;
  weightKg: number | null;
  occurrences: number;
}

export interface ImportResult {
  ok: boolean;
  error?: string;
  stats?: {
    vouchersParsed: number;
    itemsParsed: number;
    skippedNonProduct: number;
    earliestDate: string;
    latestDate: string;
    totalAmount: number;
    uniqueParties: number;
    partiesAutoMatched: number;
    partiesReview: number;
    partiesNewHistorical: number;
    uniqueProducts: number;
    productsMatched: number;
    productsUnmatched: number;
    unmatchedItemLines: number;
    plannedOrders: number;
    plannedItems: number;
    plannedNewCustomers: number;
  };
  sql?: string;
  customersCsv?: string;
  productsCsv?: string;
  summaryTxt?: string;
}

// ---------- Non-product filter ----------

const NON_PRODUCT_PATTERNS = [
  /\bGST\b/i, /\bCGST\b/i, /\bSGST\b/i, /\bIGST\b/i,
  /^R\/OFF/i, /^TEA SALES/i,
  /\bDISCOUNT\b/i, /\bSCHEME\b/i, /\bSCHEEM\b/i,
  /\bSCRATCH COUPON\b/i,
  /^OUTPUT[\s-]/i, /^INPUT[\s-]/i,
  /^TCS\b/i, /^FREIGHT/i, /^TRANSPORT/i,
  /\bROUND OFF\b/i, /^T -POS/i, /\bCASH DISCOUNT\b/i,
];

function isNonProduct(name: string): boolean {
  if (!name) return false;
  return NON_PRODUCT_PATTERNS.some(re => re.test(name));
}

// ---------- Fuzzy matching ----------

function normalize(s: string): string {
  if (!s) return "";
  return s.toLowerCase()
    .replace(/\./g, "")
    .replace(/,/g, "")
    .replace(/-/g, " ")
    .replace(/\//g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const v0 = new Array<number>(b.length + 1);
  const v1 = new Array<number>(b.length + 1);
  for (let i = 0; i <= b.length; i++) v0[i] = i;
  for (let i = 0; i < a.length; i++) {
    v1[0] = i + 1;
    for (let j = 0; j < b.length; j++) {
      const cost = a[i] === b[j] ? 0 : 1;
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
    }
    for (let j = 0; j <= b.length; j++) v0[j] = v1[j];
  }
  return v1[b.length];
}

function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(na, nb) / maxLen;
}

function fuzzyMatchOne<T extends { name: string }>(
  query: string,
  candidates: T[],
  minScore: number,
): { match: T | null; score: number } {
  let bestScore = 0;
  let best: T | null = null;
  for (const c of candidates) {
    const s = similarity(query, c.name);
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  }
  return bestScore >= minScore ? { match: best, score: bestScore } : { match: null, score: bestScore };
}

// ---------- Parse Tally Excel ----------

function parseQtyField(raw: unknown): { qty: number; unit: string | null } {
  if (raw == null) return { qty: 0, unit: null };
  if (typeof raw === "number") return { qty: raw, unit: null };
  const s = String(raw).trim();
  if (!s) return { qty: 0, unit: null };
  const m = s.match(/^([\d.]+)/);
  if (!m) return { qty: 0, unit: null };
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return { qty: 0, unit: null };
  const unit = s.slice(m[0].length).replace(/^[-\s]+/, "").trim() || null;
  return { qty: n, unit };
}

function excelDateToISO(raw: unknown): string | null {
  if (raw instanceof Date) {
    const y = raw.getFullYear();
    const m = String(raw.getMonth() + 1).padStart(2, "0");
    const d = String(raw.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof raw === "number") {
    const ms = (raw - 25569) * 86400 * 1000;
    const d = new Date(ms);
    if (!Number.isFinite(d.getTime())) return null;
    return excelDateToISO(d);
  }
  if (typeof raw === "string") {
    const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return excelDateToISO(d);
  }
  return null;
}

function parseTallyExcel(buffer: ArrayBuffer): { vouchers: TallyVoucher[]; skippedNonProduct: number } {
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });

  const vouchers: TallyVoucher[] = [];
  let current: TallyVoucher | null = null;
  let skippedNonProduct = 0;

  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const col0 = row[0]; const col1 = row[1]; const col2 = row[2];
    const col3 = row[3]; const col4 = row[4]; const col5 = row[5]; const col6 = row[6];

    if (col0 != null && col4 != null) {
      const dateISO = excelDateToISO(col0);
      if (!dateISO) { current = null; continue; }
      const party = col1 ? String(col1).trim() : "";
      const vchNum = col5 ? String(col5).trim() : "";
      const total = col6 != null ? Number(col6) : 0;
      if (!party || !vchNum) { current = null; continue; }
      current = {
        date: dateISO,
        voucherNumber: vchNum,
        voucherType: String(col4).trim(),
        partyNameRaw: party,
        totalAmount: Number.isFinite(total) ? total : 0,
        items: [],
      };
      vouchers.push(current);
      continue;
    }

    if (col0 == null && col1 != null && current) {
      const lineName = String(col1).trim();
      if (isNonProduct(lineName)) { skippedNonProduct++; continue; }
      if (col2 == null || col3 == null || col4 == null) continue;
      const { qty, unit } = parseQtyField(col2);
      if (qty <= 0) continue;
      const rate = Number(col3);
      const amount = Number(col4);
      if (!Number.isFinite(rate) || !Number.isFinite(amount)) continue;
      current.items.push({ nameRaw: lineName, qty, rate, amount, unitRaw: unit });
    }
  }

  return {
    vouchers: vouchers.filter(v => v.items.length > 0),
    skippedNonProduct,
  };
}

// ---------- SQL generation ----------

function sqlEscape(s: string | null | undefined): string {
  if (s == null) return "NULL";
  return "'" + s.replace(/'/g, "''") + "'";
}

function uuidv4(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;
}

interface SqlGenInput {
  vouchers: TallyVoucher[];
  customerMatches: Map<string, CustomerMatch>;
  productMatches: Map<string, ProductMatch>;
  company: string;
  voucherTypeTag: string;
}

function generateSql(input: SqlGenInput): { sql: string; nOrders: number; nItems: number; nNewCustomers: number } {
  const { vouchers, customerMatches, productMatches } = input;
  const newCustomerUuids = new Map<string, string>();
  for (const [party, m] of customerMatches) {
    if (m.newHistorical) newCustomerUuids.set(party, uuidv4());
  }

  const lines: string[] = [];
  lines.push("-- ====================================================================");
  lines.push(`-- Tally backfill SQL — generated ${new Date().toISOString()}`);
  lines.push(`-- Company: ${input.company}`);
  lines.push(`-- Voucher type: ${input.voucherTypeTag}`);
  lines.push(`-- Vouchers: ${vouchers.length}`);
  lines.push(`-- New historical customers: ${newCustomerUuids.size}`);
  lines.push("-- ====================================================================");
  lines.push("");
  lines.push("begin;");
  lines.push("");

  if (newCustomerUuids.size > 0) {
    lines.push("-- ---- New historical-only customers ----");
    lines.push("insert into customers (id, name, is_historical_only) values");
    const custRows: string[] = [];
    const sortedParties = Array.from(newCustomerUuids.keys()).sort();
    for (const party of sortedParties) {
      const cid = newCustomerUuids.get(party)!;
      custRows.push(`  ('${cid}', ${sqlEscape(party)}, true)`);
    }
    lines.push(custRows.join(",\n"));
    lines.push("on conflict (id) do nothing;");
    lines.push("");
  }

  function resolvedCustomerId(partyRaw: string): string | null {
    const m = customerMatches.get(partyRaw);
    if (!m) return null;
    if (m.newHistorical) return newCustomerUuids.get(partyRaw) ?? null;
    return m.customerId;
  }

  const orderUuids = new Map<string, string>();
  const orderRows: string[] = [];
  let nOrders = 0;
  for (const v of vouchers) {
    const custId = resolvedCustomerId(v.partyNameRaw);
    if (!custId) continue;
    const orderId = uuidv4();
    orderUuids.set(`${v.voucherNumber}|${v.date}`, orderId);
    orderRows.push(
      `  ('${orderId}', ${sqlEscape(v.voucherNumber)}, '${v.date}', ` +
      `${sqlEscape(v.voucherType)}, '${custId}', ${sqlEscape(v.partyNameRaw)}, ` +
      `${v.totalAmount.toFixed(2)}, ${v.items.length})`,
    );
    nOrders++;
  }

  if (orderRows.length > 0) {
    lines.push("-- ---- Historical orders ----");
    for (let i = 0; i < orderRows.length; i += 500) {
      lines.push("insert into historical_orders");
      lines.push("  (id, voucher_number, voucher_date, voucher_type, customer_id, party_name_raw, total_amount, line_count)");
      lines.push("values");
      const chunk = orderRows.slice(i, i + 500);
      lines.push(chunk.join(",\n"));
      lines.push("on conflict (voucher_number, voucher_date) do nothing;");
      lines.push("");
    }
  }

  const itemRows: string[] = [];
  let nItems = 0;
  for (const v of vouchers) {
    const orderId = orderUuids.get(`${v.voucherNumber}|${v.date}`);
    if (!orderId) continue;
    for (const item of v.items) {
      const pm = productMatches.get(item.nameRaw);
      const productIdSql = pm?.productId ? `'${pm.productId}'` : "NULL";
      let kgVal = "NULL";
      if (pm?.productId && pm.weightKg != null) {
        kgVal = (item.qty * pm.weightKg).toFixed(4);
      }
      const rateSql = item.rate != null ? item.rate.toFixed(4) : "NULL";
      const amountSql = item.amount != null ? item.amount.toFixed(2) : "NULL";
      itemRows.push(
        `  ('${orderId}', ${productIdSql}, ${sqlEscape(item.nameRaw)}, ` +
        `${item.qty.toFixed(3)}, ${rateSql}, ${amountSql}, ${kgVal}, ${sqlEscape(item.unitRaw)})`,
      );
      nItems++;
    }
  }

  if (itemRows.length > 0) {
    lines.push("-- ---- Historical order items ----");
    for (let i = 0; i < itemRows.length; i += 500) {
      lines.push("insert into historical_order_items");
      lines.push("  (historical_order_id, product_id, item_name_raw, qty, rate, amount, kg, unit_raw)");
      lines.push("values");
      const chunk = itemRows.slice(i, i + 500);
      lines.push(chunk.join(",\n"));
      lines.push(";");
      lines.push("");
    }
  }

  lines.push("commit;");

  return { sql: lines.join("\n"), nOrders, nItems, nNewCustomers: newCustomerUuids.size };
}

// ---------- CSV ----------

function csvEscape(s: string | number | null | undefined): string {
  if (s == null) return "";
  const str = String(s);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function customersCsv(matches: Map<string, CustomerMatch>): string {
  const rows: string[] = ["party_raw,match_status,matched_to,similarity_score,customer_id"];
  const sorted = Array.from(matches.values()).sort((a, b) => {
    const orderA = !a.newHistorical && a.score < 0.95 ? 0 : a.newHistorical ? 1 : 2;
    const orderB = !b.newHistorical && b.score < 0.95 ? 0 : b.newHistorical ? 1 : 2;
    if (orderA !== orderB) return orderA - orderB;
    return b.score - a.score;
  });
  for (const m of sorted) {
    const status = m.newHistorical ? "NEW (historical-only)"
      : m.score >= 0.95 ? "AUTO-MATCH" : "REVIEW";
    rows.push([
      csvEscape(m.partyRaw),
      csvEscape(status),
      csvEscape(m.matchedName ?? ""),
      m.score.toFixed(3),
      csvEscape(m.customerId ?? ""),
    ].join(","));
  }
  return rows.join("\n");
}

function productsCsv(matches: Map<string, ProductMatch>): string {
  const rows: string[] = ["item_raw,occurrences,matched_to,product_id,weight_kg,similarity_score,status"];
  const sorted = Array.from(matches.values()).sort((a, b) => {
    const oA = a.productId ? 1 : 0;
    const oB = b.productId ? 1 : 0;
    if (oA !== oB) return oA - oB;
    return b.occurrences - a.occurrences;
  });
  for (const m of sorted) {
    rows.push([
      csvEscape(m.itemRaw),
      m.occurrences,
      csvEscape(m.matchedName ?? ""),
      csvEscape(m.productId ?? ""),
      m.weightKg != null ? m.weightKg.toFixed(4) : "",
      m.score.toFixed(3),
      csvEscape(m.productId ? "MATCHED" : "UNMATCHED — kg will be NULL"),
    ].join(","));
  }
  return rows.join("\n");
}

// ---------- Main entry ----------

export async function importTallyExcel(formData: FormData): Promise<ImportResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };
  const { data: me } = await supabase.from("app_users").select("role, active").eq("id", user.id).single();
  if (!me?.active || me.role !== "admin") return { ok: false, error: "Admin only" };

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file uploaded" };
  const company = String(formData.get("company") ?? "").trim();
  const voucherTypeTag = String(formData.get("voucher_type") ?? "").trim();
  if (!company) return { ok: false, error: "Company name is required" };
  if (!voucherTypeTag) return { ok: false, error: "Voucher type is required" };

  if (file.size > 4_000_000) {
    return { ok: false, error: `File too large (${(file.size/1024/1024).toFixed(1)} MB). Limit ~4 MB on this endpoint. Split into smaller date ranges.` };
  }

  try {
    const buffer = await file.arrayBuffer();
    const { vouchers, skippedNonProduct } = parseTallyExcel(buffer);

    if (vouchers.length === 0) {
      return { ok: false, error: "No vouchers parsed. Is this a Day Book export with line items?" };
    }

    const admin = createAdminClient();
    const [{ data: custData }, { data: prodData }] = await Promise.all([
      admin.from("customers").select("id, name").order("name"),
      admin.from("products").select("id, name, weight_kg").order("name"),
    ]);
    const dbCustomers: CustomerRow[] = (custData ?? []) as CustomerRow[];
    const dbProducts: ProductRow[]  = (prodData ?? []) as ProductRow[];

    // Customer matches
    const partySet = new Set(vouchers.map(v => v.partyNameRaw));
    const customerMatches = new Map<string, CustomerMatch>();
    for (const party of partySet) {
      const { match: best, score } = fuzzyMatchOne(party, dbCustomers, 0.80);
      if (best) {
        customerMatches.set(party, {
          partyRaw: party, customerId: best.id, newHistorical: false, score, matchedName: best.name,
        });
      } else {
        customerMatches.set(party, {
          partyRaw: party, customerId: null, newHistorical: true, score, matchedName: null,
        });
      }
    }

    // Item occurrences + matches
    const itemOccurrences = new Map<string, number>();
    for (const v of vouchers) {
      for (const it of v.items) {
        itemOccurrences.set(it.nameRaw, (itemOccurrences.get(it.nameRaw) ?? 0) + 1);
      }
    }
    const productMatches = new Map<string, ProductMatch>();
    for (const itemRaw of itemOccurrences.keys()) {
      const { match: best, score } = fuzzyMatchOne(itemRaw, dbProducts, 0.75);
      productMatches.set(itemRaw, {
        itemRaw,
        productId: best?.id ?? null,
        score,
        matchedName: best?.name ?? null,
        weightKg: best?.weight_kg ?? null,
        occurrences: itemOccurrences.get(itemRaw) ?? 0,
      });
    }

    // Stats
    const partiesAutoMatched = Array.from(customerMatches.values()).filter(m => !m.newHistorical && m.score >= 0.95).length;
    const partiesReview = Array.from(customerMatches.values()).filter(m => !m.newHistorical && m.score < 0.95).length;
    const partiesNewHistorical = Array.from(customerMatches.values()).filter(m => m.newHistorical).length;
    const productsMatched = Array.from(productMatches.values()).filter(m => m.productId).length;
    const productsUnmatched = Array.from(productMatches.values()).filter(m => !m.productId).length;
    const unmatchedItemLines = vouchers.reduce(
      (s, v) => s + v.items.filter(it => !productMatches.get(it.nameRaw)?.productId).length, 0,
    );
    const dates = vouchers.map(v => v.date).sort();
    const totalAmount = vouchers.reduce((s, v) => s + v.totalAmount, 0);
    const itemsParsed = vouchers.reduce((s, v) => s + v.items.length, 0);

    const sqlOut = generateSql({ vouchers, customerMatches, productMatches, company, voucherTypeTag });

    // Summary text
    const summaryLines: string[] = [];
    summaryLines.push("=".repeat(60));
    summaryLines.push("TALLY BACKFILL IMPORT SUMMARY");
    summaryLines.push("=".repeat(60));
    summaryLines.push("");
    summaryLines.push(`Company:                  ${company}`);
    summaryLines.push(`Voucher type:             ${voucherTypeTag}`);
    summaryLines.push(`Vouchers parsed:          ${vouchers.length}`);
    summaryLines.push(`Line items parsed:        ${itemsParsed}`);
    summaryLines.push(`Skipped non-product rows: ${skippedNonProduct}`);
    summaryLines.push(`Date range:               ${dates[0]} to ${dates[dates.length-1]}`);
    summaryLines.push(`Total amount:             Rs ${totalAmount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);
    summaryLines.push("");
    summaryLines.push("--- Customer matching ---");
    summaryLines.push(`Unique parties:           ${partySet.size}`);
    summaryLines.push(`  Auto-matched (>=95%):   ${partiesAutoMatched}`);
    summaryLines.push(`  Review (80-95%):        ${partiesReview}`);
    summaryLines.push(`  New historical-only:    ${partiesNewHistorical}`);
    summaryLines.push("");
    summaryLines.push("--- Product matching ---");
    summaryLines.push(`Unique items:             ${itemOccurrences.size}`);
    summaryLines.push(`  Matched:                ${productsMatched}`);
    summaryLines.push(`  Unmatched (kg=NULL):    ${productsUnmatched}`);
    summaryLines.push(`Line items unmatched:     ${unmatchedItemLines} / ${itemsParsed}`);
    summaryLines.push("");
    summaryLines.push("--- SQL output ---");
    summaryLines.push(`Would insert ${sqlOut.nOrders} historical orders`);
    summaryLines.push(`Would insert ${sqlOut.nItems} line items`);
    summaryLines.push(`Would create ${sqlOut.nNewCustomers} new historical-only customers`);
    summaryLines.push("");
    summaryLines.push("Next: download the SQL, review the customer/product CSVs,");
    summaryLines.push("then run the SQL in Supabase SQL editor.");

    return {
      ok: true,
      stats: {
        vouchersParsed: vouchers.length,
        itemsParsed,
        skippedNonProduct,
        earliestDate: dates[0],
        latestDate: dates[dates.length - 1],
        totalAmount,
        uniqueParties: partySet.size,
        partiesAutoMatched,
        partiesReview,
        partiesNewHistorical,
        uniqueProducts: itemOccurrences.size,
        productsMatched,
        productsUnmatched,
        unmatchedItemLines,
        plannedOrders: sqlOut.nOrders,
        plannedItems: sqlOut.nItems,
        plannedNewCustomers: sqlOut.nNewCustomers,
      },
      sql: sqlOut.sql,
      customersCsv: customersCsv(customerMatches),
      productsCsv: productsCsv(productMatches),
      summaryTxt: summaryLines.join("\n"),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Parsing failed" };
  }
}
