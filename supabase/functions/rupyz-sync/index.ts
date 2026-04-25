// Supabase Edge Function: rupyz-sync
// Runs every 15 minutes via pg_cron; can also be invoked manually.
//
// Flow:
//   1. Load active session token from rupyz_session
//   2. Fetch /order/?page_no=1
//   3. For each order:
//        - if it's NEW (we don't have it) → fetch detail, insert
//        - if it's KNOWN but Rupyz updated_at > our last_synced_at AND not yet delivered → re-fetch detail, update
//        - else → skip
//   4. Continue to next page if any orders on this page were new (heuristic for "new stuff exists")
//   5. On 401: attempt refresh, retry once. If refresh fails → mark log as auth_expired and exit.
//
// deno-lint-ignore-file no-explicit-any

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  refreshAccessToken,
  fetchOrderList,
  fetchOrderDetail,
  RupyzAuthError,
  type RupyzOrderDetail,
} from "../_shared/rupyz.ts";

// ---- env ------------------------------------------------------------------
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SYNC_SECRET  = Deno.env.get("RUPYZ_SYNC_SECRET") ?? "";   // optional shared secret
const MAX_PAGES    = parseInt(Deno.env.get("RUPYZ_MAX_PAGES") ?? "5", 10);

// ---- helpers --------------------------------------------------------------
function db() {
  return createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
}

interface SyncCounters {
  pages_fetched: number;
  orders_inserted: number;
  orders_updated: number;
  orders_skipped: number;
  customers_stubbed: number;
  products_stubbed: number;
  token_refreshed: boolean;
}

interface SessionRow {
  id: number;
  org_id: number;
  user_id: string;
  username: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
}

async function loadSession(): Promise<SessionRow> {
  const { data, error } = await db().from("rupyz_session").select("*").eq("id", 1).single();
  if (error || !data) throw new Error(`No session row in rupyz_session — run sql/05_seed_rupyz_session.sql first. ${error?.message ?? ""}`);
  return data as SessionRow;
}

async function saveRefreshedSession(creds: { access_token: string; refresh_token: string; expires_in: number }) {
  const expiresAt = new Date(Date.now() + creds.expires_in * 1000).toISOString();
  const { error } = await db().from("rupyz_session").update({
    access_token: creds.access_token,
    refresh_token: creds.refresh_token,
    expires_at: expiresAt,
    last_refreshed_at: new Date().toISOString(),
  }).eq("id", 1);
  if (error) throw new Error(`Failed to save refreshed session: ${error.message}`);
}

async function startLog(trigger: string): Promise<string> {
  const { data, error } = await db()
    .from("rupyz_sync_log")
    .insert({ status: "running", trigger })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Failed to create sync log: ${error?.message}`);
  return data.id as string;
}

async function finishLog(logId: string, status: string, c: SyncCounters, errorMsg?: string, details?: any) {
  await db().from("rupyz_sync_log").update({
    finished_at: new Date().toISOString(),
    status,
    pages_fetched:     c.pages_fetched,
    orders_inserted:   c.orders_inserted,
    orders_updated:    c.orders_updated,
    orders_skipped:    c.orders_skipped,
    customers_stubbed: c.customers_stubbed,
    products_stubbed:  c.products_stubbed,
    token_refreshed:   c.token_refreshed,
    error_message:     errorMsg ?? null,
    details:           details ?? null,
  }).eq("id", logId);
}

// ---- stub creators --------------------------------------------------------
async function ensureCustomer(detail: RupyzOrderDetail, c: SyncCounters): Promise<string | null> {
  const supabase = db();
  const rid = detail.customer.id;
  const { data: existing } = await supabase
    .from("customers").select("id").eq("rupyz_id", rid).maybeSingle();
  if (existing) return existing.id;

  // Try matching by rupyz_code as text fallback (legacy import compatibility)
  const { data: byCode } = await supabase
    .from("customers").select("id").eq("rupyz_code", String(rid)).maybeSingle();
  if (byCode) {
    await supabase.from("customers").update({ rupyz_id: rid }).eq("id", byCode.id);
    return byCode.id;
  }

  const { data: created, error } = await supabase.from("customers").insert({
    rupyz_id: rid,
    rupyz_code: String(rid),
    name: detail.customer.name,
    mobile: detail.customer.mobile?.replace(/[^0-9]/g, "") || null,
    customer_type: detail.customer.customer_type || null,
    customer_level: detail.customer.customer_level || null,
    gstin: detail.customer.gstin || null,
    city: detail.address?.city || null,
    pincode: detail.address?.pincode || null,
    address: detail.address?.address_line_1 || null,
    is_stub: true,
    active: true,
  }).select("id").single();
  if (error) throw new Error(`Customer stub insert failed for ${rid}: ${error.message}`);
  c.customers_stubbed++;
  return created.id;
}

async function ensureSalesman(detail: RupyzOrderDetail): Promise<string | null> {
  if (!detail.created_by?.id) return null;
  const supabase = db();
  const rid = detail.created_by.id;
  const { data: existing } = await supabase
    .from("salesmen").select("id").eq("rupyz_id", rid).maybeSingle();
  if (existing) return existing.id;
  // Try matching by name as fallback (Phase 1 seeded salesmen by name only)
  const fullName = `${detail.created_by.first_name ?? ""} ${detail.created_by.last_name ?? ""}`.trim();
  if (fullName) {
    const { data: byName } = await supabase
      .from("salesmen").select("id").ilike("name", fullName).maybeSingle();
    if (byName) {
      await supabase.from("salesmen").update({ rupyz_id: rid }).eq("id", byName.id);
      return byName.id;
    }
  }
  return null; // don't stub salesmen — admin should add them manually for control
}

async function ensureProduct(item: any, c: SyncCounters): Promise<string | null> {
  const supabase = db();
  const rid = item.id as number;
  const { data: existing } = await supabase
    .from("products").select("id").eq("rupyz_id", rid).maybeSingle();
  if (existing) return existing.id;

  const { data: byCode } = await supabase
    .from("products").select("id").eq("rupyz_code", String(rid)).maybeSingle();
  if (byCode) {
    await supabase.from("products").update({ rupyz_id: rid }).eq("id", byCode.id);
    return byCode.id;
  }

  const { data: created, error } = await supabase.from("products").insert({
    rupyz_id:       rid,
    rupyz_code:     String(rid),
    name:           item.name,
    mrp:            item.mrp_price ?? 0,
    base_price:     item.original_price ?? item.price ?? 0,
    unit:           item.unit || "Kg",
    gst_percent:    item.gst ?? 0,
    hsn_code:       item.hsn_code || null,
    is_stub:        true,
    active:         true,
  }).select("id").single();
  if (error) throw new Error(`Product stub insert failed for ${rid}: ${error.message}`);
  c.products_stubbed++;
  return created.id;
}

// ---- order upsert ---------------------------------------------------------
async function upsertOrder(
  detail: RupyzOrderDetail,
  customerId: string | null,
  salesmanId: string | null,
): Promise<{ id: string; isNew: boolean }> {
  const supabase = db();

  const orderRow = {
    rupyz_id:                detail.id,
    rupyz_order_id:          detail.order_id,
    customer_id:             customerId,
    rupyz_customer_id:       detail.customer_id,
    salesman_id:             salesmanId,
    rupyz_created_by_id:     detail.created_by?.id ?? null,
    rupyz_created_by_name:   `${detail.created_by?.first_name ?? ""} ${detail.created_by?.last_name ?? ""}`.trim() || null,
    amount:                  detail.amount,
    gst_amount:              detail.gst_amount,
    cgst_amount:             detail.taxes_info?.cgst_amount ?? 0,
    sgst_amount:             detail.taxes_info?.sgst_amount ?? 0,
    igst_amount:             detail.taxes_info?.igst_amount ?? 0,
    discount_amount:         detail.discount_amount ?? 0,
    delivery_charges:        detail.delivery_charges ?? 0,
    round_off_amount:        detail.round_off_amount ?? 0,
    total_amount:            detail.total_amount,
    rupyz_delivery_status:   detail.delivery_status,
    rupyz_tally_status:      detail.tally_status,
    payment_option_check:    detail.payment_option_check,
    remaining_payment_days:  detail.remaining_payment_days,
    payment_status:          detail.payment_status,
    is_paid:                 detail.is_paid,
    delivery_name:           detail.address?.name ?? null,
    delivery_mobile:         detail.address?.mobile ?? null,
    delivery_address_line:   detail.address?.address_line_1 ?? null,
    delivery_city:           detail.address?.city ?? null,
    delivery_state:          detail.address?.state ?? null,
    delivery_pincode:        detail.address?.pincode ?? null,
    is_rejected:             detail.is_rejected,
    reject_reason:           detail.reject_reason,
    is_closed:               detail.is_closed,
    is_archived:             detail.is_archived,
    is_telephonic:           detail.is_telephonic,
    source:                  detail.source,
    purchase_order_url:      detail.purchase_order_url,
    comment:                 detail.comment,
    geo_location:            detail.geo_location,
    rupyz_created_at:        detail.created_at,
    rupyz_updated_at:        detail.updated_at,
    expected_delivery_date:  detail.expected_delivery_date,
    last_synced_at:          new Date().toISOString(),
  };

  const { data: existing } = await supabase
    .from("orders").select("id").eq("rupyz_id", detail.id).maybeSingle();

  if (existing) {
    const { error } = await supabase.from("orders").update(orderRow).eq("id", existing.id);
    if (error) throw new Error(`Order update failed (${detail.order_id}): ${error.message}`);
    return { id: existing.id, isNew: false };
  } else {
    const { data: created, error } = await supabase
      .from("orders").insert({ ...orderRow, app_status: "received" })
      .select("id").single();
    if (error) throw new Error(`Order insert failed (${detail.order_id}): ${error.message}`);
    return { id: created.id, isNew: true };
  }
}

async function upsertItems(
  orderId: string,
  detail: RupyzOrderDetail,
  c: SyncCounters,
) {
  const supabase = db();
  // Wipe existing items for this order, then insert fresh. Simpler than diffing.
  // Safe because order_items.id is regenerated; downstream Phase 3 dispatch tables
  // will reference orders, not items.
  await supabase.from("order_items").delete().eq("order_id", orderId);

  for (const item of detail.items) {
    const productId = await ensureProduct(item, c);
    const { error } = await supabase.from("order_items").insert({
      order_id:                  orderId,
      product_id:                productId,
      rupyz_product_id:          item.id,
      product_name:              item.name,
      product_code:              item.code,
      hsn_code:                  item.hsn_code,
      brand:                     item.brand,
      category:                  item.category,
      unit:                      item.unit,
      qty:                       item.qty,
      price:                     item.price,
      mrp:                       item.mrp_price,
      original_price:            item.original_price,
      gst_percent:               item.gst,
      gst_amount:                item.gst_amount,
      total_gst_amount:          item.total_gst_amount,
      total_price:               item.total_price,
      total_price_without_gst:   item.total_price_without_gst,
      discount_value:            item.discount_value ?? 0,
      packaging_size:            item.packaging_size,
      packaging_unit:            item.packaging_unit,
      measurement_type:          item.measurement_type,
      dispatch_qty:              item.dispatch_qty ?? 0,
      total_dispatched_qty:      item.total_dispatched_qty ?? 0,
      rupyz_raw:                 item,
    });
    if (error) throw new Error(`Item insert failed (order ${orderId}, product ${item.id}): ${error.message}`);
  }
}

// ---- main sync loop -------------------------------------------------------
async function runSync(
  trigger: string,
  opts: { backfill?: boolean; maxPages?: number } = {},
): Promise<{ ok: boolean; counters: SyncCounters; error?: string }> {
  const effectiveMaxPages = opts.maxPages ?? MAX_PAGES;
  const counters: SyncCounters = {
    pages_fetched: 0,
    orders_inserted: 0,
    orders_updated: 0,
    orders_skipped: 0,
    customers_stubbed: 0,
    products_stubbed: 0,
    token_refreshed: false,
  };

  const logId = await startLog(trigger);

  try {
    let session = await loadSession();
    let token = session.access_token;
    const orgId = session.org_id;

    // Helper: call function `f`, retry once after refresh on auth error
    async function withAuth<T>(f: (tok: string) => Promise<T>): Promise<T> {
      try {
        return await f(token);
      } catch (e) {
        if (!(e instanceof RupyzAuthError)) throw e;
        // Try refresh
        const creds = await refreshAccessToken(session.refresh_token);
        await saveRefreshedSession(creds);
        token = creds.access_token;
        session = { ...session, access_token: creds.access_token, refresh_token: creds.refresh_token };
        counters.token_refreshed = true;
        return await f(token);
      }
    }

    // Track all rupyz_ids on the current page; if none are new AND none are stale, stop paginating.
    let page = 1;
    let pageHadWork = true;

    while ((pageHadWork || opts.backfill) && page <= effectiveMaxPages) {
      const list = await withAuth((tok) => fetchOrderList(orgId, page, tok));
      counters.pages_fetched++;
      pageHadWork = false;

      const orders = list.data ?? [];
      if (orders.length === 0) break;

      // Bulk fetch existing rows for this page's rupyz_ids
      const rupyzIds = orders.map((o: any) => o.id);
      const { data: existingRows } = await db()
        .from("orders").select("rupyz_id, last_synced_at, app_status")
        .in("rupyz_id", rupyzIds);
      const existingMap = new Map((existingRows ?? []).map((r: any) => [r.rupyz_id, r]));

      for (const summary of orders) {
        const existing = existingMap.get(summary.id);
        // Skip if already delivered/closed in our app — no need to re-pull
        if (existing && ["delivered", "closed", "rejected", "cancelled"].includes(existing.app_status)) {
          counters.orders_skipped++;
          continue;
        }
        // Skip if Rupyz hasn't updated since we last synced
        if (existing && new Date(summary.updated_at) <= new Date(existing.last_synced_at)) {
          counters.orders_skipped++;
          continue;
        }

        // Fetch detail and upsert
        const detailResp = await withAuth((tok) => fetchOrderDetail(orgId, summary.id, tok));
        const detail = detailResp.data;
        const customerId = await ensureCustomer(detail, counters);
        const salesmanId = await ensureSalesman(detail);
        const { id: orderId, isNew } = await upsertOrder(detail, customerId, salesmanId);
        await upsertItems(orderId, detail, counters);
        if (isNew) counters.orders_inserted++; else counters.orders_updated++;
        pageHadWork = true;
      }

      page++;
    }

    await finishLog(logId, "success", counters);
    return { ok: true, counters };
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    await finishLog(logId, "failed", counters, msg);
    return { ok: false, counters, error: msg };
  }
}

// ---- HTTP entry -----------------------------------------------------------
Deno.serve(async (req) => {
  // Optional shared-secret check (only enforced if env var is set)
  if (SYNC_SECRET) {
    const header = req.headers.get("x-rupyz-sync-secret");
    if (header !== SYNC_SECRET) {
      return new Response("forbidden", { status: 403 });
    }
  }

  const url      = new URL(req.url);
  const backfill = url.searchParams.get("backfill") === "true";
  const maxPagesParam = url.searchParams.get("max_pages");
  const trigger  = req.headers.get("x-trigger") ?? (backfill ? "backfill" : "manual");

  const result = await runSync(trigger, { backfill, maxPages: maxPagesParam ? parseInt(maxPagesParam, 10) : undefined });
  return new Response(JSON.stringify(result, null, 2), {
    status: result.ok ? 200 : 500,
    headers: { "content-type": "application/json" },
  });
});