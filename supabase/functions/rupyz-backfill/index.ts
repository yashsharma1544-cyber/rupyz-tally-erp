// Supabase Edge Function: rupyz-backfill
//
// One-shot historical backfill of Rupyz orders. Resumable across timeouts.
//
// Differences from rupyz-sync:
//   - Reads/writes rupyz_backfill_state to track progress
//   - Does NOT stop on "no new work this page" — paginates exhaustively
//   - Time-budget aware: stops itself at ~45 seconds to avoid hitting the
//     60s Edge Function ceiling, marks status='paused' so next call resumes
//   - Honors cutoff_date — if the page we just processed has all orders
//     older than cutoff, stops with status='completed'
//
// Trigger: POST to this function. No body needed.
// To start over: call rupyz_backfill_reset() via SQL first.
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

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SYNC_SECRET  = Deno.env.get("RUPYZ_SYNC_SECRET") ?? "";

// Time budget in milliseconds. Edge Functions free-tier limit is 60s; leave
// headroom for the final state update + auto-resume invocation.
const TIME_BUDGET_MS = 50_000;

function db() {
  return createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
}

interface BackfillState {
  id: number;
  status: string;
  last_completed_page: number;
  max_pages: number;
  cutoff_date: string | null;
  total_orders_processed: number;
  total_orders_inserted: number;
  total_orders_updated: number;
  total_orders_skipped: number;
  last_page_orders_count: number | null;
  last_page_oldest_at: string | null;
  started_at: string | null;
  last_run_at: string | null;
  finished_at: string | null;
  error_message: string | null;
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

// ============================================================================
// State helpers
// ============================================================================

async function loadState(): Promise<BackfillState> {
  const { data, error } = await db()
    .from("rupyz_backfill_state").select("*").eq("id", 1).single();
  if (error || !data) {
    throw new Error(`Could not load backfill state. Run sql/36 first. ${error?.message ?? ""}`);
  }
  return data as BackfillState;
}

async function updateState(patch: Partial<BackfillState>) {
  const { error } = await db()
    .from("rupyz_backfill_state").update(patch).eq("id", 1);
  if (error) throw new Error(`Failed to update backfill state: ${error.message}`);
}

async function loadSession(): Promise<SessionRow> {
  const { data, error } = await db().from("rupyz_session").select("*").eq("id", 1).single();
  if (error || !data) throw new Error(`No session row in rupyz_session. ${error?.message ?? ""}`);
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

// ============================================================================
// Stub creators (duplicated from rupyz-sync — we want this function fully
// independent so a sync code change can't accidentally break backfills mid-run)
// ============================================================================

interface Counters {
  inserted: number;
  updated: number;
  skipped: number;
}

async function ensureCustomer(detail: RupyzOrderDetail): Promise<string | null> {
  const supabase = db();
  const rid = detail.customer.id;
  const { data: existing } = await supabase
    .from("customers").select("id").eq("rupyz_id", rid).maybeSingle();
  if (existing) return existing.id;

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
  return created.id;
}

async function ensureSalesman(detail: RupyzOrderDetail): Promise<string | null> {
  if (!detail.created_by?.id) return null;
  const supabase = db();
  const rid = detail.created_by.id;
  const { data: existing } = await supabase
    .from("salesmen").select("id").eq("rupyz_id", rid).maybeSingle();
  if (existing) return existing.id;
  const fullName = `${detail.created_by.first_name ?? ""} ${detail.created_by.last_name ?? ""}`.trim();
  if (fullName) {
    const { data: byName } = await supabase
      .from("salesmen").select("id").ilike("name", fullName).maybeSingle();
    if (byName) {
      await supabase.from("salesmen").update({ rupyz_id: rid }).eq("id", byName.id);
      return byName.id;
    }
  }
  return null;
}

async function ensureProduct(item: any): Promise<string | null> {
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
  return created.id;
}

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

async function upsertItems(orderId: string, detail: RupyzOrderDetail) {
  const supabase = db();
  // Upsert by (order_id, rupyz_product_id) — handles concurrent runs and
  // true Rupyz-side duplicates idempotently. Last writer wins.

  // Dedupe items by rupyz_product_id within the same Rupyz payload (defensive)
  const seen = new Set<number>();
  const uniqueItems = [];
  for (const item of detail.items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    uniqueItems.push(item);
  }

  for (const item of uniqueItems) {
    const productId = await ensureProduct(item);
    const { error } = await supabase.from("order_items").upsert({
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
    }, {
      onConflict: "order_id,rupyz_product_id",
    });
    if (error) throw new Error(`Item upsert failed (order ${orderId}, product ${item.id}): ${error.message}`);
  }
}

// ============================================================================
// Main backfill loop
// ============================================================================

async function runBackfill(): Promise<{ ok: boolean; finalStatus: string; counters: Counters; pagesThisRun: number; resumeAt?: number; error?: string }> {
  const state = await loadState();

  // Don't restart if already completed (use reset() to start over)
  if (state.status === "completed") {
    return { ok: true, finalStatus: "completed", counters: { inserted: 0, updated: 0, skipped: 0 }, pagesThisRun: 0 };
  }

  // Mark as running, set started_at if first run
  await updateState({
    status: "running",
    last_run_at: new Date().toISOString(),
    started_at: state.started_at ?? new Date().toISOString(),
    error_message: null,
  });

  const counters: Counters = { inserted: 0, updated: 0, skipped: 0 };
  let pagesThisRun = 0;
  const startedAtMs = Date.now();

  let currentPage = state.last_completed_page + 1;
  const maxPages = state.max_pages;
  const cutoffDate = state.cutoff_date ? new Date(state.cutoff_date) : null;

  try {
    let session = await loadSession();
    let token = session.access_token;
    const orgId = session.org_id;
    let tokenRefreshed = false;

    async function withAuth<T>(f: (tok: string) => Promise<T>): Promise<T> {
      try {
        return await f(token);
      } catch (e) {
        if (!(e instanceof RupyzAuthError)) throw e;
        const creds = await refreshAccessToken(session.refresh_token);
        await saveRefreshedSession(creds);
        token = creds.access_token;
        session = { ...session, access_token: creds.access_token, refresh_token: creds.refresh_token };
        tokenRefreshed = true;
        return await f(token);
      }
    }

    while (currentPage <= maxPages) {
      // Time budget check before fetching the next page
      if (Date.now() - startedAtMs > TIME_BUDGET_MS) {
        await updateState({
          status: "paused",
          last_completed_page: currentPage - 1,
          total_orders_inserted: state.total_orders_inserted + counters.inserted,
          total_orders_updated:  state.total_orders_updated  + counters.updated,
          total_orders_skipped:  state.total_orders_skipped  + counters.skipped,
          total_orders_processed: state.total_orders_processed + counters.inserted + counters.updated + counters.skipped,
        });
        return {
          ok: true,
          finalStatus: "paused",
          counters,
          pagesThisRun,
          resumeAt: currentPage,
        };
      }

      const list = await withAuth((tok) => fetchOrderList(orgId, currentPage, tok));
      const orders = list.data ?? [];
      pagesThisRun++;

      if (orders.length === 0) {
        // No more pages — backfill complete
        await updateState({
          status: "completed",
          last_completed_page: currentPage - 1,
          finished_at: new Date().toISOString(),
          last_page_orders_count: 0,
          total_orders_inserted: state.total_orders_inserted + counters.inserted,
          total_orders_updated:  state.total_orders_updated  + counters.updated,
          total_orders_skipped:  state.total_orders_skipped  + counters.skipped,
          total_orders_processed: state.total_orders_processed + counters.inserted + counters.updated + counters.skipped,
        });
        return { ok: true, finalStatus: "completed", counters, pagesThisRun };
      }

      // Find the oldest order on this page (for diagnostics + cutoff check)
      let oldestAtMs = Infinity;
      for (const o of orders) {
        const t = new Date(o.created_at).getTime();
        if (t < oldestAtMs) oldestAtMs = t;
      }
      const oldestAt = new Date(oldestAtMs).toISOString();

      // Bulk check for existing orders on this page (1 query instead of 30)
      const rupyzIds = orders.map((o: any) => o.id);
      const { data: existingRows } = await db()
        .from("orders")
        .select("rupyz_id, last_synced_at, app_status")
        .in("rupyz_id", rupyzIds);
      const existingMap = new Map(
        (existingRows ?? []).map((r: any) => [r.rupyz_id, r])
      );

      // Process each order
      for (const summary of orders) {
        const existing = existingMap.get(summary.id);

        if (existing) {
          // Skip if already terminal — don't re-pull
          if (["delivered", "closed", "rejected", "cancelled"].includes(existing.app_status)) {
            counters.skipped++;
            continue;
          }
          // Skip if Rupyz hasn't updated since we last synced
          if (existing.last_synced_at && new Date(summary.updated_at) <= new Date(existing.last_synced_at)) {
            counters.skipped++;
            continue;
          }
        }

        // Fetch detail and upsert
        const detailResp = await withAuth((tok) => fetchOrderDetail(orgId, summary.id, tok));
        const detail = detailResp.data;
        const customerId = await ensureCustomer(detail);
        const salesmanId = await ensureSalesman(detail);
        const { id: orderId, isNew } = await upsertOrder(detail, customerId, salesmanId);
        await upsertItems(orderId, detail);
        if (isNew) counters.inserted++; else counters.updated++;
      }

      // Page processed. Save progress before moving on.
      await updateState({
        last_completed_page: currentPage,
        last_page_orders_count: orders.length,
        last_page_oldest_at: oldestAt,
        total_orders_inserted: state.total_orders_inserted + counters.inserted,
        total_orders_updated:  state.total_orders_updated  + counters.updated,
        total_orders_skipped:  state.total_orders_skipped  + counters.skipped,
        total_orders_processed: state.total_orders_processed + counters.inserted + counters.updated + counters.skipped,
      });

      // Cutoff check — if all orders on this page are older than cutoff, stop
      if (cutoffDate && oldestAtMs < cutoffDate.getTime()) {
        // We've reached / passed the cutoff. Check if newest order on page is also older — if so we're done.
        let newestAtMs = -Infinity;
        for (const o of orders) {
          const t = new Date(o.created_at).getTime();
          if (t > newestAtMs) newestAtMs = t;
        }
        if (newestAtMs < cutoffDate.getTime()) {
          // Entire page is below cutoff — backfill complete
          await updateState({
            status: "completed",
            finished_at: new Date().toISOString(),
          });
          return { ok: true, finalStatus: "completed", counters, pagesThisRun };
        }
        // Mixed page (some new, some old): we already processed everything,
        // but next page will be fully old. Stop on next iteration via oldestAt check.
      }

      currentPage++;
    }

    // Hit max_pages safety cap
    await updateState({
      status: "paused",
      last_completed_page: currentPage - 1,
      error_message: `Hit max_pages safety cap (${maxPages}). Increase max_pages and resume if more data exists.`,
    });
    return { ok: true, finalStatus: "paused", counters, pagesThisRun, resumeAt: currentPage };

  } catch (e: any) {
    const msg = e?.message ?? String(e);
    await updateState({
      status: "failed",
      error_message: msg,
      total_orders_inserted: state.total_orders_inserted + counters.inserted,
      total_orders_updated:  state.total_orders_updated  + counters.updated,
      total_orders_skipped:  state.total_orders_skipped  + counters.skipped,
      total_orders_processed: state.total_orders_processed + counters.inserted + counters.updated + counters.skipped,
    });
    return { ok: false, finalStatus: "failed", counters, pagesThisRun, error: msg };
  }
}

// ============================================================================
// HTTP entry
// ============================================================================

// Self-invoke for auto-resume. Sends a fetch to /functions/v1/rupyz-backfill
// and intentionally does NOT await the response (we want this run to return
// immediately so the chained call starts in a fresh context).
function selfInvoke(): Promise<void> {
  const url = `${SUPABASE_URL}/functions/v1/rupyz-backfill`;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "authorization": `Bearer ${SERVICE_ROLE}`,
    "x-trigger": "auto-resume",
  };
  if (SYNC_SECRET) headers["x-rupyz-sync-secret"] = SYNC_SECRET;
  return fetch(url, { method: "POST", headers, body: "{}" })
    .then(() => undefined)
    .catch(() => undefined);
}

Deno.serve(async (req) => {
  if (SYNC_SECRET) {
    const header = req.headers.get("x-rupyz-sync-secret");
    if (header !== SYNC_SECRET) {
      return new Response("forbidden", { status: 403 });
    }
  }

  const result = await runBackfill();

  // Auto-resume: if we paused, kick off the next run. We use EdgeRuntime.waitUntil
  // so Supabase keeps the function context alive long enough for the outbound
  // fetch to be initiated, even after we return the response below.
  if (result.ok && result.finalStatus === "paused") {
    const invocation = selfInvoke();
    try {
      // @ts-expect-error: EdgeRuntime is provided by the Supabase runtime
      if (typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime.waitUntil === "function") {
        // @ts-expect-error
        EdgeRuntime.waitUntil(invocation);
      }
      // Whether or not waitUntil is supported, the fetch has already been
      // initiated — even without await, the request will complete.
    } catch (_e) {
      // ignore
    }
  }

  return new Response(JSON.stringify(result, null, 2), {
    status: result.ok ? 200 : 500,
    headers: { "content-type": "application/json" },
  });
});
