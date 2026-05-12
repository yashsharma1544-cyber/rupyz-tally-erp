/**
 * Context builders.
 *
 * Each function pulls relevant business data from Supabase and shapes it
 * into the typed Context objects that prompts.ts expects.
 *
 * Server-only. Uses service role client (passed in) for unrestricted reads.
 */

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CustomerContext,
  BeatContext,
  ProductContext,
  DailyBriefingContext,
} from "./prompts";

// ============================================================================
// CUSTOMER CONTEXT
// ============================================================================

export async function buildCustomerContext(
  db: SupabaseClient,
  customerId: string,
): Promise<CustomerContext | null> {
  // Customer + beat
  const { data: cust } = await db
    .from("customers")
    .select("id, name, beat_id, beats(name)")
    .eq("id", customerId)
    .maybeSingle();
  if (!cust) return null;

  const sixMonthsAgo = sixMonthsAgoIso();
  const sixtyDaysAgo = daysAgoIso(60);

  // Recent orders (last 6 months)
  const { data: orders } = await db
    .from("orders")
    .select("id, rupyz_created_at, total_amount")
    .eq("customer_id", customerId)
    .gte("rupyz_created_at", sixMonthsAgo)
    .order("rupyz_created_at", { ascending: false });

  const totalOrders = orders?.length ?? 0;
  const totalRevenue = (orders ?? []).reduce((s, o) => s + Number(o.total_amount ?? 0), 0);
  const firstOrderDate = orders && orders.length > 0 ? orders[orders.length - 1].rupyz_created_at : null;
  const lastOrderDate = orders && orders.length > 0 ? orders[0].rupyz_created_at : null;
  const daysSinceLast = lastOrderDate ? daysBetween(new Date(lastOrderDate), new Date()) : null;

  // Line items aggregated
  let totalKg = 0;
  let monthlyMap = new Map<string, { orders: Set<string>; kg: number }>();
  let productMap = new Map<string, { name: string; kg: number; orders: Set<string>; lastBought: string }>();

  if (orders && orders.length > 0) {
    const orderIds = orders.map(o => o.id);
    const orderDateMap = new Map(orders.map(o => [o.id, o.rupyz_created_at as string]));

    const { data: items } = await db
      .from("order_items_kg")
      .select("order_item_id, order_id, product_id, product_name, qty, kg")
      .in("order_id", orderIds);

    for (const it of items ?? []) {
      const orderDate = orderDateMap.get(it.order_id);
      if (!orderDate) continue;
      const month = orderDate.slice(0, 7);
      const kg = Number(it.kg ?? 0);
      totalKg += kg;

      const m = monthlyMap.get(month) ?? { orders: new Set(), kg: 0 };
      m.orders.add(it.order_id);
      m.kg += kg;
      monthlyMap.set(month, m);

      const pkey = it.product_id ?? it.product_name;
      const p = productMap.get(pkey) ?? { name: it.product_name, kg: 0, orders: new Set(), lastBought: orderDate };
      p.kg += kg;
      p.orders.add(it.order_id);
      if (orderDate > p.lastBought) p.lastBought = orderDate;
      productMap.set(pkey, p);
    }
  }

  const monthlyTrend = Array.from(monthlyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({ month, orders: v.orders.size, kg: Math.round(v.kg) }));

  const topProducts = Array.from(productMap.values())
    .sort((a, b) => b.kg - a.kg)
    .slice(0, 5)
    .map(p => ({ name: p.name, kg: Math.round(p.kg), orders: p.orders.size }));

  // Dropped products: bought 2+ times more than 60d ago but not in last 60d
  const droppedProducts = Array.from(productMap.values())
    .filter(p => p.lastBought < sixtyDaysAgo && p.orders.size >= 2)
    .sort((a, b) => b.kg - a.kg)
    .slice(0, 5)
    .map(p => ({
      name: p.name,
      lastBought: p.lastBought.slice(0, 10),
      previousFrequency: p.orders.size,
    }));

  const avgKgPerOrder = totalOrders > 0 ? totalKg / totalOrders : null;

  // Last visit
  const { data: lastVisitRow } = await db
    .from("customer_visits")
    .select("visited_at, visited_by_name")
    .eq("customer_id", customerId)
    .gte("visited_at", sixtyDaysAgo)
    .order("visited_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    name: cust.name,
    beat: (cust.beats as any)?.name ?? null,
    totalOrders,
    totalKg: Math.round(totalKg),
    totalRevenue: Math.round(totalRevenue),
    firstOrderDate: firstOrderDate?.slice(0, 10) ?? null,
    lastOrderDate: lastOrderDate?.slice(0, 10) ?? null,
    daysSinceLast,
    avgKgPerOrder,
    monthlyTrend,
    topProducts,
    droppedProducts,
    lastVisit: lastVisitRow?.visited_at?.slice(0, 10) ?? null,
    lastVisitBy: lastVisitRow?.visited_by_name ?? null,
  };
}

// ============================================================================
// BEAT CONTEXT
// ============================================================================

export async function buildBeatContext(
  db: SupabaseClient,
  beatId: string,
): Promise<BeatContext | null> {
  const { data: beat } = await db
    .from("beats")
    .select("id, name, city")
    .eq("id", beatId)
    .maybeSingle();
  if (!beat) return null;

  const sixMonthsAgo = sixMonthsAgoIso();
  const thirtyDaysAgo = daysAgoIso(30);
  const sixtyDaysAgo = daysAgoIso(60);
  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1); startOfMonth.setUTCHours(0,0,0,0);

  // Customers on this beat
  const { data: customers } = await db
    .from("customers")
    .select("id, name, created_at")
    .eq("beat_id", beatId)
    .eq("active", true);

  const totalCustomers = customers?.length ?? 0;
  const customerIds = (customers ?? []).map(c => c.id);
  const customerNameMap = new Map((customers ?? []).map(c => [c.id, c.name]));

  // New this month
  const newThisMonth = (customers ?? []).filter(c => c.created_at >= startOfMonth.toISOString()).length;

  if (customerIds.length === 0) {
    return {
      name: beat.name,
      city: beat.city,
      totalCustomers: 0,
      activeCount: 0,
      sleepingCount: 0,
      newThisMonth,
      totalOrders: 0,
      totalKg: 0,
      totalRevenue: 0,
      monthlyTrend: [],
      topCustomers: [],
      topBrands: [],
      shrinkingCustomers: [],
    };
  }

  // Orders for these customers (last 6 months)
  const { data: orders } = await db
    .from("orders")
    .select("id, customer_id, rupyz_created_at, total_amount")
    .in("customer_id", customerIds)
    .gte("rupyz_created_at", sixMonthsAgo);

  const totalOrders = orders?.length ?? 0;
  const totalRevenue = (orders ?? []).reduce((s, o) => s + Number(o.total_amount ?? 0), 0);

  // Track per-customer activity
  const custLastOrder = new Map<string, string>();
  const custOrders30 = new Map<string, { kg: number; orders: number }>();
  const custOrdersPrev = new Map<string, { kg: number; orders: number }>();
  const orderById = new Map((orders ?? []).map(o => [o.id, o]));

  for (const o of orders ?? []) {
    const existing = custLastOrder.get(o.customer_id);
    if (!existing || o.rupyz_created_at > existing) custLastOrder.set(o.customer_id, o.rupyz_created_at);
  }

  // Items aggregation
  let totalKg = 0;
  const monthlyMap = new Map<string, { orders: number; kg: number; customers: Set<string> }>();
  const custKg = new Map<string, number>();
  const custOrderCount = new Map<string, Set<string>>();
  const brandMap = new Map<string, number>();

  if ((orders ?? []).length > 0) {
    const orderIds = (orders ?? []).map(o => o.id);
    const { data: items } = await db
      .from("order_items_kg")
      .select("order_id, customer_id, product_name, kg")
      .in("order_id", orderIds);

    // Also get brand info via products join
    const { data: itemsWithBrand } = await db
      .from("order_items")
      .select("order_id, brand, kg:qty, product_name")
      .in("order_id", orderIds);
    // brand summed by kg from order_items_kg (which has product_weight_kg correctly applied)
    // we'll merge brand info per order_item

    for (const it of items ?? []) {
      const order = orderById.get(it.order_id);
      if (!order) continue;
      const kg = Number(it.kg ?? 0);
      totalKg += kg;

      const month = order.rupyz_created_at.slice(0, 7);
      const m = monthlyMap.get(month) ?? { orders: 0, kg: 0, customers: new Set() };
      m.kg += kg;
      m.customers.add(order.customer_id);
      monthlyMap.set(month, m);

      custKg.set(order.customer_id, (custKg.get(order.customer_id) ?? 0) + kg);
      const oset = custOrderCount.get(order.customer_id) ?? new Set();
      oset.add(it.order_id);
      custOrderCount.set(order.customer_id, oset);

      // 30d window vs prior 30d
      if (order.rupyz_created_at >= thirtyDaysAgo) {
        const c = custOrders30.get(order.customer_id) ?? { kg: 0, orders: 0 };
        c.kg += kg;
        custOrders30.set(order.customer_id, c);
      } else if (order.rupyz_created_at >= sixtyDaysAgo) {
        const c = custOrdersPrev.get(order.customer_id) ?? { kg: 0, orders: 0 };
        c.kg += kg;
        custOrdersPrev.set(order.customer_id, c);
      }
    }

    // Count distinct orders per month
    const orderSetByMonth = new Map<string, Set<string>>();
    for (const o of orders ?? []) {
      const m = o.rupyz_created_at.slice(0, 7);
      const s = orderSetByMonth.get(m) ?? new Set();
      s.add(o.id);
      orderSetByMonth.set(m, s);
    }
    for (const [m, s] of orderSetByMonth) {
      const mm = monthlyMap.get(m);
      if (mm) mm.orders = s.size;
    }

    for (const it of itemsWithBrand ?? []) {
      const brand = (it as any).brand;
      if (!brand) continue;
      brandMap.set(brand, (brandMap.get(brand) ?? 0) + Number((it as any).kg ?? 0));
    }
  }

  // Active / sleeping classification
  let activeCount = 0;
  let sleepingCount = 0;
  for (const cid of customerIds) {
    const lo = custLastOrder.get(cid);
    if (lo && lo >= thirtyDaysAgo) activeCount++;
    else if (!lo || lo < sixtyDaysAgo) sleepingCount++;
  }

  const monthlyTrend = Array.from(monthlyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({ month, orders: v.orders, kg: Math.round(v.kg), activeCustomers: v.customers.size }));

  const topCustomers = Array.from(custKg.entries())
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([cid, kg]) => ({
      name: customerNameMap.get(cid) ?? "(unknown)",
      kg: Math.round(kg),
      orders: custOrderCount.get(cid)?.size ?? 0,
    }));

  const topBrands = Array.from(brandMap.entries())
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([name, kg]) => ({ name, kg: Math.round(kg) }));

  // Shrinking: 30d/prev30d drop >30%
  const shrinkingCustomers: { name: string; prevKg: number; recentKg: number }[] = [];
  for (const cid of customerIds) {
    const recent = custOrders30.get(cid)?.kg ?? 0;
    const prev = custOrdersPrev.get(cid)?.kg ?? 0;
    if (prev > 100 && recent < prev * 0.7) {
      shrinkingCustomers.push({
        name: customerNameMap.get(cid) ?? "(unknown)",
        prevKg: Math.round(prev),
        recentKg: Math.round(recent),
      });
    }
  }
  shrinkingCustomers.sort((a, b) => (b.prevKg - b.recentKg) - (a.prevKg - a.recentKg));

  return {
    name: beat.name,
    city: beat.city,
    totalCustomers,
    activeCount,
    sleepingCount,
    newThisMonth,
    totalOrders,
    totalKg: Math.round(totalKg),
    totalRevenue: Math.round(totalRevenue),
    monthlyTrend,
    topCustomers,
    topBrands,
    shrinkingCustomers: shrinkingCustomers.slice(0, 5),
  };
}

// ============================================================================
// PRODUCT CONTEXT
// ============================================================================

export async function buildProductContext(
  db: SupabaseClient,
  productId: string,
): Promise<ProductContext | null> {
  const { data: prod } = await db
    .from("products")
    .select("id, name, brands(name)")
    .eq("id", productId)
    .maybeSingle();
  if (!prod) return null;

  const sixMonthsAgo = sixMonthsAgoIso();
  const sixtyDaysAgo = daysAgoIso(60);

  // Order items for this product (last 6 months) — via order_items_kg view
  const { data: items } = await db
    .from("order_items_kg")
    .select("order_id, customer_id, kg, line_unit")
    .eq("product_id", productId);

  // Need order date and customer name. Fetch them.
  if (!items || items.length === 0) {
    return {
      name: prod.name,
      brand: (prod.brands as any)?.name ?? "—",
      totalKg: 0,
      totalRevenue: 0,
      distinctCustomers: 0,
      totalOrderLines: 0,
      monthlyTrend: [],
      topCustomers: [],
      droppedCustomers: [],
      topCustomerShare: null,
    };
  }

  const orderIds = Array.from(new Set(items.map(it => it.order_id)));
  const { data: orders } = await db
    .from("orders")
    .select("id, rupyz_created_at, customer_id, total_amount")
    .in("id", orderIds)
    .gte("rupyz_created_at", sixMonthsAgo);

  const orderDateMap = new Map((orders ?? []).map(o => [o.id, o.rupyz_created_at as string]));
  const customerIds = Array.from(new Set(items.map(it => it.customer_id).filter(Boolean)));

  const { data: custs } = await db
    .from("customers")
    .select("id, name")
    .in("id", customerIds);
  const custNameMap = new Map((custs ?? []).map(c => [c.id, c.name]));

  // Aggregate
  let totalKg = 0;
  let totalRevenue = 0;  // approximated using line price; we don't have product-level revenue
  const monthlyMap = new Map<string, { kg: number; customers: Set<string> }>();
  const custKg = new Map<string, number>();
  const custLastBought = new Map<string, string>();
  const custOrderCount = new Map<string, number>();

  for (const it of items) {
    const orderDate = orderDateMap.get(it.order_id);
    if (!orderDate) continue;  // outside 6mo window
    const kg = Number(it.kg ?? 0);
    totalKg += kg;
    totalRevenue += Number(it.line_unit ?? 0);

    const month = orderDate.slice(0, 7);
    const mm = monthlyMap.get(month) ?? { kg: 0, customers: new Set() };
    mm.kg += kg;
    if (it.customer_id) mm.customers.add(it.customer_id);
    monthlyMap.set(month, mm);

    if (it.customer_id) {
      custKg.set(it.customer_id, (custKg.get(it.customer_id) ?? 0) + kg);
      custOrderCount.set(it.customer_id, (custOrderCount.get(it.customer_id) ?? 0) + 1);
      const lo = custLastBought.get(it.customer_id);
      if (!lo || orderDate > lo) custLastBought.set(it.customer_id, orderDate);
    }
  }

  const monthlyTrend = Array.from(monthlyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({ month, kg: Math.round(v.kg), customers: v.customers.size }));

  const topCustomerArr = Array.from(custKg.entries())
    .sort(([, a], [, b]) => b - a);
  const topCustomers = topCustomerArr.slice(0, 5).map(([cid, kg]) => ({
    name: custNameMap.get(cid) ?? "(unknown)",
    kg: Math.round(kg),
  }));

  const topCustomerShare = topCustomerArr.length > 0 && totalKg > 0
    ? topCustomerArr[0][1] / totalKg
    : null;

  // Dropped: bought 3+ times but last buy was >60d ago
  const droppedCustomers: { name: string; lastBought: string; previousFrequency: number }[] = [];
  for (const [cid, lastBought] of custLastBought) {
    if (lastBought < sixtyDaysAgo && (custOrderCount.get(cid) ?? 0) >= 3) {
      droppedCustomers.push({
        name: custNameMap.get(cid) ?? "(unknown)",
        lastBought: lastBought.slice(0, 10),
        previousFrequency: custOrderCount.get(cid) ?? 0,
      });
    }
  }
  droppedCustomers.sort((a, b) => b.previousFrequency - a.previousFrequency);

  return {
    name: prod.name,
    brand: (prod.brands as any)?.name ?? "—",
    totalKg: Math.round(totalKg),
    totalRevenue: Math.round(totalRevenue),
    distinctCustomers: custKg.size,
    totalOrderLines: items.length,
    monthlyTrend,
    topCustomers,
    droppedCustomers,
    topCustomerShare,
  };
}

// ============================================================================
// DAILY BRIEFING CONTEXT
// ============================================================================

export async function buildDailyBriefingContext(
  db: SupabaseClient,
): Promise<DailyBriefingContext> {
  const now = new Date();
  const yesterdayStart = new Date(now); yesterdayStart.setUTCDate(now.getUTCDate() - 1); yesterdayStart.setUTCHours(0,0,0,0);
  const yesterdayEnd = new Date(yesterdayStart); yesterdayEnd.setUTCDate(yesterdayStart.getUTCDate() + 1);
  const sevenDaysAgo = daysAgoIso(7);
  const thirtyDaysAgo = daysAgoIso(30);
  const sixtyDaysAgo = daysAgoIso(60);

  // Yesterday's activity
  const { data: yOrders } = await db
    .from("orders")
    .select("id, total_amount")
    .gte("rupyz_created_at", yesterdayStart.toISOString())
    .lt("rupyz_created_at", yesterdayEnd.toISOString());

  let yKg = 0;
  if (yOrders && yOrders.length > 0) {
    const oIds = yOrders.map(o => o.id);
    const { data: items } = await db.from("order_items_kg").select("kg").in("order_id", oIds);
    yKg = (items ?? []).reduce((s, it) => s + Number(it.kg ?? 0), 0);
  }
  const yRev = (yOrders ?? []).reduce((s, o) => s + Number(o.total_amount ?? 0), 0);

  // 7-day / 30-day averages
  const { data: sevenDayOrders } = await db
    .from("orders")
    .select("id, total_amount")
    .gte("rupyz_created_at", sevenDaysAgo);
  let sevenKg = 0;
  if (sevenDayOrders && sevenDayOrders.length > 0) {
    const { data } = await db.from("order_items_kg").select("kg").in("order_id", sevenDayOrders.map(o => o.id));
    sevenKg = (data ?? []).reduce((s, x) => s + Number(x.kg ?? 0), 0);
  }
  const { data: thirtyDayOrders } = await db
    .from("orders")
    .select("id, total_amount")
    .gte("rupyz_created_at", thirtyDaysAgo);
  let thirtyKg = 0;
  if (thirtyDayOrders && thirtyDayOrders.length > 0) {
    const { data } = await db.from("order_items_kg").select("kg").in("order_id", thirtyDayOrders.map(o => o.id));
    thirtyKg = (data ?? []).reduce((s, x) => s + Number(x.kg ?? 0), 0);
  }

  // Pending / in-transit
  const { count: pendingCount } = await db
    .from("orders").select("*", { count: "exact", head: true })
    .eq("app_status", "received");
  const { count: inTransitCount } = await db
    .from("orders").select("*", { count: "exact", head: true })
    .in("app_status", ["loading", "dispatched", "on_van_trip"]);

  // Sleeping customers (no orders in 60d) — first compute who has orders in last 60d
  const { data: activeCusts } = await db
    .from("orders")
    .select("customer_id")
    .gte("rupyz_created_at", sixtyDaysAgo);
  const activeCustIds = new Set((activeCusts ?? []).map(o => o.customer_id).filter(Boolean));
  // Subtract from total to get sleeping count
  const { count: totalActive } = await db
    .from("customers").select("*", { count: "exact", head: true }).eq("active", true);
  // Sleeping = active customer that's not in activeCustIds
  // sleepingThisWeek is harder — would need to know who *became* sleeping this week. Approximate as count of customers whose last order is between 60-67 days ago
  const sevenWeekAgoEnd = daysAgoIso(60);
  const sevenWeekAgoStart = daysAgoIso(67);
  const { data: sleepingThisWeekData } = await db
    .from("orders")
    .select("customer_id, rupyz_created_at")
    .gte("rupyz_created_at", sevenWeekAgoStart)
    .lt("rupyz_created_at", sevenWeekAgoEnd);
  // Customers whose latest order is in this window
  const candidateMap = new Map<string, string>();
  for (const o of sleepingThisWeekData ?? []) {
    const cid = o.customer_id;
    if (!cid) continue;
    const existing = candidateMap.get(cid);
    if (!existing || o.rupyz_created_at > existing) candidateMap.set(cid, o.rupyz_created_at);
  }
  // Filter to those WITHOUT orders since then
  let sleepingThisWeek = 0;
  for (const [cid, lastOrd] of candidateMap) {
    const { count } = await db
      .from("orders").select("*", { count: "exact", head: true })
      .eq("customer_id", cid)
      .gt("rupyz_created_at", lastOrd);
    if ((count ?? 0) === 0) sleepingThisWeek++;
  }

  // Top sleeping customers by 6mo kg
  // Get customers with no recent order, ranked by 6mo kg
  const { data: allCusts } = await db
    .from("customers")
    .select("id, name")
    .eq("active", true);
  const sixMonthsAgoStr = sixMonthsAgoIso();
  const { data: sixMoOrders } = await db
    .from("orders")
    .select("id, customer_id, rupyz_created_at")
    .gte("rupyz_created_at", sixMonthsAgoStr);
  const oIdToCust = new Map((sixMoOrders ?? []).map(o => [o.id, o.customer_id]));
  const oIdToDate = new Map((sixMoOrders ?? []).map(o => [o.id, o.rupyz_created_at as string]));
  const custLast = new Map<string, string>();
  for (const o of sixMoOrders ?? []) {
    const ex = custLast.get(o.customer_id);
    if (!ex || (o.rupyz_created_at as string) > ex) custLast.set(o.customer_id, o.rupyz_created_at as string);
  }
  const { data: kgData } = await db
    .from("order_items_kg")
    .select("order_id, customer_id, kg")
    .gte("order_id", ""); // returns all; cheaper: query by orderIds set if too big
  const custKg = new Map<string, number>();
  for (const it of kgData ?? []) {
    if (!it.customer_id) continue;
    custKg.set(it.customer_id, (custKg.get(it.customer_id) ?? 0) + Number(it.kg ?? 0));
  }

  const sleepingCands = (allCusts ?? [])
    .map(c => {
      const last = custLast.get(c.id);
      if (!last) return null;
      const daysSince = daysBetween(new Date(last), now);
      if (daysSince < 60) return null;
      return { name: c.name, kg: Math.round(custKg.get(c.id) ?? 0), daysSince };
    })
    .filter((x): x is { name: string; kg: number; daysSince: number } => x !== null)
    .sort((a, b) => b.kg - a.kg)
    .slice(0, 3);

  // Beat alerts (simplified — count of beats with no activity yesterday)
  const { data: allBeats } = await db.from("beats").select("id, name").eq("active", true);
  const totalBeats = allBeats?.length ?? 0;
  const yesterdayBeats = new Set<string>();
  if (yOrders && yOrders.length > 0) {
    const ydOrderIds = yOrders.map(o => o.id);
    const { data } = await db.from("order_items_kg").select("beat_id").in("order_id", ydOrderIds);
    for (const r of data ?? []) if (r.beat_id) yesterdayBeats.add(r.beat_id);
  }
  const beatsWithNoActivity = totalBeats - yesterdayBeats.size;

  return {
    asOfDate: now.toISOString().slice(0, 10),
    yesterday: {
      orders: yOrders?.length ?? 0,
      kg: Math.round(yKg),
      revenue: Math.round(yRev),
    },
    avg7d: {
      orders: ((sevenDayOrders?.length ?? 0) / 7),
      kg: Math.round(sevenKg / 7),
    },
    avg30d: {
      orders: ((thirtyDayOrders?.length ?? 0) / 30),
      kg: Math.round(thirtyKg / 30),
    },
    pendingOrders: pendingCount ?? 0,
    inTransitOrders: inTransitCount ?? 0,
    sleepingThisWeek,
    topSleepingCustomers: sleepingCands,
    beatsWithNoActivity,
    totalBeats,
    worstBeat: null,    // placeholder — would need full beat trend comparison; ship in v2
    worstProduct: null, // placeholder — same
  };
}

// ============================================================================
// Chat context — light snapshot of the business for the chat assistant
// ============================================================================

/**
 * Returns a compact summary of the business state. Used as system context
 * for the chat assistant. Keep this small — gets prepended to every chat
 * turn so we don't burn tokens.
 */
export async function buildChatSnapshot(db: SupabaseClient): Promise<string> {
  const now = new Date();
  const thirtyDaysAgo = daysAgoIso(30);

  const { count: totalCustomers } = await db
    .from("customers").select("*", { count: "exact", head: true }).eq("active", true);
  const { count: totalProducts } = await db
    .from("products").select("*", { count: "exact", head: true }).eq("active", true);
  const { count: totalBeats } = await db
    .from("beats").select("*", { count: "exact", head: true }).eq("active", true);

  const { data: recentOrders } = await db
    .from("orders").select("id, total_amount")
    .gte("rupyz_created_at", thirtyDaysAgo);
  const recentRev = (recentOrders ?? []).reduce((s, o) => s + Number(o.total_amount ?? 0), 0);

  let recentKg = 0;
  if (recentOrders && recentOrders.length > 0) {
    const oIds = recentOrders.map(o => o.id);
    const { data } = await db.from("order_items_kg").select("kg").in("order_id", oIds);
    recentKg = (data ?? []).reduce((s, x) => s + Number(x.kg ?? 0), 0);
  }

  return [
    `Today: ${now.toISOString().slice(0, 10)}`,
    `Active customers: ${totalCustomers}`,
    `Active products (SKUs): ${totalProducts}`,
    `Active beats: ${totalBeats}`,
    `Last 30 days: ${recentOrders?.length ?? 0} orders, ${Math.round(recentKg).toLocaleString("en-IN")} kg, ₹${Math.round(recentRev).toLocaleString("en-IN")} revenue`,
  ].join("\n");
}

// ============================================================================
// Date helpers
// ============================================================================

function sixMonthsAgoIso(): string {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - 6);
  return d.toISOString();
}

function daysAgoIso(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString();
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / 86400000);
}
