#!/usr/bin/env node
/**
 * Historical orders import script
 *
 * Reads 4 Rupyz CSV exports from a local folder and imports them into Supabase.
 * Run locally with PowerShell — no timeout constraints.
 *
 * Usage:
 *   node scripts/import-historical-orders.js
 *
 * Setup:
 *   1. Copy .env.local.example to .env.local at the repo root
 *   2. Fill in SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 *   3. Confirm CSV_DIR points to your CSV folder
 *
 * What it does:
 *   - Reads all 4 CSV files (Dec 2025 - Mar 2026)
 *   - Groups CSV rows by Order id
 *   - For each unique customer/product/salesman/beat: lookup, create stub if missing
 *   - Upserts orders with app_status='historical'
 *   - Upserts order_items
 *   - Skips orders already present in DB (idempotent — safe to re-run)
 *   - Prints progress to console: "Processed 100/2788 orders (3.6%)"
 */

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

// ---- Config ---------------------------------------------------------------
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env.local") });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CSV_DIR = process.env.CSV_DIR || "C:\\Users\\Yash\\Downloads\\rupyz_export";
const DRY_RUN = process.env.DRY_RUN === "true";

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Set them in .env.local at repo root.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

// ---- CSV parsing helpers --------------------------------------------------

/**
 * Parse CSV — handles quoted fields with commas inside, BOM, \r\n endings.
 * Returns array of objects keyed by header.
 */
function parseCsv(text) {
  // Strip BOM
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lines = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); lines.push(row); row = []; field = ""; }
      else if (c === "\r") { /* skip */ }
      else field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); lines.push(row); }
  const headers = lines[0];
  return lines.slice(1).filter(r => r.length > 1).map(r => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = r[i] !== undefined ? r[i] : ""; });
    return obj;
  });
}

function parseDate(s) {
  if (!s) return null;
  s = s.trim();
  // Formats: "31-Dec-25" or "31 Jan, 2026"
  const months = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5, Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 };
  let m;
  if ((m = s.match(/^(\d{1,2})-([A-Z][a-z]{2})-(\d{2})$/))) {
    const day = parseInt(m[1]);
    const mon = months[m[2]];
    const year = 2000 + parseInt(m[3]);
    return new Date(Date.UTC(year, mon, day));
  }
  if ((m = s.match(/^(\d{1,2})\s+([A-Z][a-z]{2}),\s*(\d{4})$/))) {
    const day = parseInt(m[1]);
    const mon = months[m[2]];
    const year = parseInt(m[3]);
    return new Date(Date.UTC(year, mon, day));
  }
  return null;
}

function parseTime(s) {
  if (!s) return [0, 0, 0];
  s = s.trim();
  // "5:17:29 PM" or "04:48:09 PM"
  const m = s.match(/^(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)?$/i);
  if (!m) return [0, 0, 0];
  let h = parseInt(m[1]);
  const min = parseInt(m[2]);
  const sec = parseInt(m[3]);
  const ampm = m[4];
  if (ampm) {
    if (ampm.toUpperCase() === "PM" && h < 12) h += 12;
    if (ampm.toUpperCase() === "AM" && h === 12) h = 0;
  }
  return [h, min, sec];
}

function combineDateTime(dateStr, timeStr) {
  const d = parseDate(dateStr);
  if (!d) return null;
  const [h, m, s] = parseTime(timeStr);
  // Treat as IST (UTC+5:30) since Rupyz is India
  // Convert to UTC ISO string
  const ist = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, m, s));
  const utc = new Date(ist.getTime() - (5.5 * 60 * 60 * 1000));
  return utc.toISOString();
}

function num(v) {
  if (v === undefined || v === null || v === "") return 0;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

// ---- Domain logic ---------------------------------------------------------

/**
 * Load CSV files and group rows by Order ID.
 *
 * File list can be overridden via env var CSV_FILES (comma-separated).
 * Example:
 *   $env:CSV_FILES="orders_2026_03_part2.csv"; node scripts/...
 */
function loadAndGroupOrders(csvDir) {
  const envList = process.env.CSV_FILES;
  const files = envList
    ? envList.split(",").map(s => s.trim()).filter(Boolean)
    : [
        "orders_2025_12.csv",
        "orders_2026_01.csv",
        "orders_2026_02.csv",
        "orders_2026_03.csv",
      ];
  const byOrderId = new Map();
  let totalRows = 0;

  for (const fname of files) {
    const p = path.join(csvDir, fname);
    if (!fs.existsSync(p)) {
      console.error(`Missing CSV: ${p}`);
      process.exit(1);
    }
    const text = fs.readFileSync(p, "utf8");
    const rows = parseCsv(text);
    console.log(`Loaded ${rows.length} rows from ${fname}`);
    totalRows += rows.length;
    for (const r of rows) {
      const oid = (r["Order id"] || "").trim();
      if (!oid) continue;
      if (!byOrderId.has(oid)) byOrderId.set(oid, []);
      byOrderId.get(oid).push(r);
    }
  }
  console.log(`Total ${totalRows} rows → ${byOrderId.size} distinct orders\n`);
  return byOrderId;
}

// In-memory caches so we don't query the same lookup repeatedly
const customerCache = new Map();  // rupyz_code -> uuid
const productCache = new Map();   // rupyz_code -> uuid
const salesmanCache = new Map();  // name -> uuid|null
const beatCache = new Map();      // rupyz_code -> uuid

async function ensureCustomer(rupyzCode, name, mobile, city, address) {
  if (customerCache.has(rupyzCode)) return customerCache.get(rupyzCode);

  // Lookup by rupyz_code
  const { data: existing } = await supabase
    .from("customers").select("id").eq("rupyz_code", rupyzCode).maybeSingle();
  if (existing) {
    customerCache.set(rupyzCode, existing.id);
    return existing.id;
  }

  // Lookup by mobile as fallback
  if (mobile) {
    const cleanMobile = mobile.replace(/[^0-9]/g, "");
    if (cleanMobile.length >= 10) {
      const tail = cleanMobile.slice(-10);
      const { data: byMobile } = await supabase
        .from("customers").select("id, rupyz_code").like("mobile", `%${tail}`).maybeSingle();
      if (byMobile) {
        // Update rupyz_code if missing
        if (!byMobile.rupyz_code) {
          await supabase.from("customers").update({ rupyz_code: rupyzCode }).eq("id", byMobile.id);
        }
        customerCache.set(rupyzCode, byMobile.id);
        return byMobile.id;
      }
    }
  }

  // Create stub
  if (DRY_RUN) {
    console.log(`  [DRY] Would create customer stub: ${rupyzCode} / ${name}`);
    customerCache.set(rupyzCode, "DRY-RUN-UUID");
    return "DRY-RUN-UUID";
  }
  const { data: created, error } = await supabase
    .from("customers")
    .insert({
      rupyz_code: rupyzCode,
      name: name || `Customer ${rupyzCode}`,
      mobile: (mobile || "").replace(/[^0-9]/g, "") || null,
      city: city || null,
      address: address || null,
      is_stub: true,
      active: true,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Customer stub failed (${rupyzCode}): ${error.message}`);
  customerCache.set(rupyzCode, created.id);
  return created.id;
}

async function ensureProduct(rupyzCode, name, brand) {
  if (productCache.has(rupyzCode)) return productCache.get(rupyzCode);

  // Fetch both UUID and numeric rupyz_id — we need rupyz_id for order_items
  const { data: existing } = await supabase
    .from("products").select("id, rupyz_id").eq("rupyz_code", rupyzCode).maybeSingle();
  if (existing) {
    const v = { id: existing.id, rupyz_id: existing.rupyz_id };
    productCache.set(rupyzCode, v);
    return v;
  }

  if (DRY_RUN) {
    console.log(`  [DRY] Would create product stub: ${rupyzCode} / ${name}`);
    const v = { id: "DRY-RUN-UUID", rupyz_id: null };
    productCache.set(rupyzCode, v);
    return v;
  }
  const { data: created, error } = await supabase
    .from("products")
    .insert({
      rupyz_code: rupyzCode,
      name: name || `Product ${rupyzCode}`,
      unit: "Kg",
      is_stub: true,
      active: true,
    })
    .select("id, rupyz_id")
    .single();
  if (error) throw new Error(`Product stub failed (${rupyzCode}): ${error.message}`);
  const v = { id: created.id, rupyz_id: created.rupyz_id };
  productCache.set(rupyzCode, v);
  return v;
}

async function ensureSalesman(name) {
  if (!name) return null;
  if (salesmanCache.has(name)) return salesmanCache.get(name);

  // Look up in salesmen table by name. We DO NOT create stubs here because
  // the salesmen table has NOT NULL constraints on fields like phone that
  // the CSV doesn't provide. If a salesman isn't found, we leave
  // salesman_id = null on the order. The name is still preserved in
  // rupyz_created_by_name for analytics.
  const { data: existing } = await supabase
    .from("salesmen").select("id").ilike("name", name).maybeSingle();
  if (existing) {
    salesmanCache.set(name, existing.id);
    return existing.id;
  }

  // Not found, don't create — just record null
  salesmanCache.set(name, null);
  return null;
}

async function ensureBeat(rupyzCode, name, city) {
  if (!rupyzCode) return null;
  if (beatCache.has(rupyzCode)) return beatCache.get(rupyzCode);

  // Lookup by rupyz_code OR by name (since beats table schema isn't fully clear)
  let { data: existing } = await supabase
    .from("beats").select("id").eq("rupyz_code", rupyzCode).maybeSingle();
  if (!existing && name) {
    const { data: byName } = await supabase
      .from("beats").select("id").ilike("name", name).maybeSingle();
    if (byName) existing = byName;
  }
  if (existing) {
    beatCache.set(rupyzCode, existing.id);
    return existing.id;
  }

  if (DRY_RUN) {
    beatCache.set(rupyzCode, null);
    return null;
  }
  const { data: created, error } = await supabase
    .from("beats")
    .insert({
      rupyz_code: rupyzCode,
      name: name || `Beat ${rupyzCode}`,
      city: city || null,
      active: true,
      is_van_beat: false,
    })
    .select("id")
    .single();
  if (error) {
    console.warn(`  Warning: couldn't create beat ${rupyzCode}: ${error.message}`);
    beatCache.set(rupyzCode, null);
    return null;
  }
  beatCache.set(rupyzCode, created.id);
  return created.id;
}

async function upsertOrder(rupyzOrderId, rows) {
  // Check if already imported (idempotent)
  const { data: existing } = await supabase
    .from("orders").select("id").eq("rupyz_order_id", rupyzOrderId).maybeSingle();
  if (existing) {
    return { id: existing.id, isNew: false };
  }

  const first = rows[0];
  const createdAt = combineDateTime(first["Order Received Date"], first["Order Received Time"]);
  if (!createdAt) {
    throw new Error(`Bad date for order ${rupyzOrderId}: ${first["Order Received Date"]} / ${first["Order Received Time"]}`);
  }

  const customerCode = first["Customer Code"];
  const customerId = await ensureCustomer(
    customerCode,
    first["Customer Name"],
    first["Mobile No."],
    first["City"],
    first["Customer Delivery Address"] || null,
  );
  const salesmanId = await ensureSalesman(first["Order taken by"]);
  const beatId = await ensureBeat(first["Beat Codes"], first["Beat Names"], first["City"]);

  if (DRY_RUN) {
    return { id: "DRY-RUN-ORDER-UUID", isNew: true };
  }

  const orderRow = {
    rupyz_order_id: rupyzOrderId,
    customer_id: customerId,
    salesman_id: salesmanId,
    rupyz_created_by_name: first["Order taken by"] || null,
    amount: num(first["Net Amount (₹)"]),
    total_amount: num(first["Net Amount (₹)"]),
    // CSV gives only the net amount INCLUDING GST. We don't know the GST
    // breakdown for historical orders, so set the column to 0. This matters
    // for the NOT NULL constraint but won't affect revenue/kg analytics
    // (those sum total_amount, not gst_amount).
    gst_amount: 0,
    rupyz_created_at: createdAt,
    rupyz_updated_at: createdAt,
    last_synced_at: new Date().toISOString(),
    app_status: "historical",
    delivery_city: first["City"] || null,
    delivery_address_line: first["Customer Delivery Address"] || null,
    source: "csv_import",
  };

  const { data: created, error } = await supabase
    .from("orders").insert(orderRow).select("id").single();
  if (error) throw new Error(`Order insert failed (${rupyzOrderId}): ${error.message}`);
  return { id: created.id, isNew: true };
}

async function upsertItems(orderId, rows) {
  if (DRY_RUN) return;

  // Helper: parse "Kg (1.0 * Kg)" → 1.0 (the size value)
  function parsePackagingSize(s) {
    if (!s) return 1;
    const m = String(s).match(/\(\s*([\d.]+)/);
    if (m) {
      const n = Number(m[1]);
      return Number.isFinite(n) && n > 0 ? n : 1;
    }
    return 1;
  }

  // Dedupe within order by product code
  const seen = new Set();
  const items = [];
  for (const r of rows) {
    const pc = r["Product Code"];
    if (!pc || seen.has(pc)) continue;
    seen.add(pc);
    const product = await ensureProduct(pc, r["Product Name"], r["Product Brand"]);
    items.push({
      order_id: orderId,
      product_id: product.id,
      rupyz_product_id: product.rupyz_id,
      product_code: pc,
      product_name: r["Product Name"] || null,
      brand: r["Product Brand"] || null,
      category: r["Product Category"] || null,
      unit: r["Buyer's Unit"] || "Kg",
      qty: num(r["Quantity"]),
      price: num(r["Net Buyer's Price (Incl. GST)"]),
      total_price: num(r["Net Buyer's Price (Incl. GST)"]) * num(r["Quantity"]),
      packaging_size: parsePackagingSize(r["Packaging Unit (Size x Buyer unit)"]),
      packaging_unit: "Kg",
      measurement_type: r["Measurement Type"] || null,
    });
  }

  if (items.length === 0) return;
  // Bulk insert
  const { error } = await supabase.from("order_items").insert(items);
  if (error) throw new Error(`Item insert failed (order ${orderId}): ${error.message}`);
}

// ---- Main loop ------------------------------------------------------------

async function main() {
  console.log("=== Historical Orders Import ===");
  console.log(`CSV dir: ${CSV_DIR}`);
  console.log(`Supabase: ${SUPABASE_URL}`);
  if (DRY_RUN) console.log("*** DRY RUN MODE *** No writes will be made\n");
  else console.log();

  const orderMap = loadAndGroupOrders(CSV_DIR);
  const allOrderIds = [...orderMap.keys()];
  const total = allOrderIds.length;

  let processed = 0;
  let inserted = 0;
  let skipped = 0;
  let failed = 0;
  const startMs = Date.now();

  for (const oid of allOrderIds) {
    try {
      const rows = orderMap.get(oid);
      const { id: orderId, isNew } = await upsertOrder(oid, rows);
      if (isNew) {
        await upsertItems(orderId, rows);
        inserted++;
      } else {
        skipped++;
      }
    } catch (e) {
      failed++;
      console.error(`  FAIL ${oid}: ${e.message}`);
    }
    processed++;

    if (processed % 25 === 0 || processed === total) {
      const elapsedSec = Math.round((Date.now() - startMs) / 1000);
      const rate = processed / Math.max(1, elapsedSec);
      const etaSec = Math.round((total - processed) / Math.max(0.1, rate));
      const pct = ((processed / total) * 100).toFixed(1);
      console.log(`  ${processed}/${total} (${pct}%) — ${inserted} new, ${skipped} already in DB, ${failed} failed — ETA ${etaSec}s`);
    }
  }

  console.log("\n=== Done ===");
  console.log(`Processed: ${processed}`);
  console.log(`Newly inserted: ${inserted}`);
  console.log(`Already in DB (skipped): ${skipped}`);
  console.log(`Failed: ${failed}`);
  console.log(`Time: ${Math.round((Date.now() - startMs) / 1000)}s`);
  console.log(`Customer stubs created/found: ${customerCache.size}`);
  console.log(`Product stubs created/found: ${productCache.size}`);
  console.log(`Salesman lookups: ${salesmanCache.size}`);
  console.log(`Beat lookups: ${beatCache.size}`);
}

main().catch(e => {
  console.error("Fatal error:", e);
  process.exit(1);
});
