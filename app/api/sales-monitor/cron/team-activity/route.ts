// =============================================================================
// /api/sales-monitor/cron/team-activity
//
// Pulls Rupyz "team activity" (the MIS / team-activity dashboard) for a date
// and upserts one row per salesman into salesman_daily_activity.
//
// Source endpoint (same API + token your order sync uses):
//   GET {RUPYZ_BASE}/v2/organization/{orgId}/activity/team/dashboard/
//        ?page_no=1&by_date_range=CUSTOM&start_date=<d>&end_date=<d>
//   headers: accept, authorization: Bearer <token>, os: WEB, source: WEB
//
// Token: read from rupyz_session (id=1). There is NO auto-refresh — if Rupyz
// rejects the token, an admin must paste a fresh one in Settings (same as the
// order sync). We surface a clear 401 in that case.
//
// Query params:
//   ?date=YYYY-MM-DD          one day (default: today IST)
//   ?start=YYYY-MM-DD&end=... inclusive range (for backfilling a whole JC)
//
// Auth: if CRON_SECRET is set, require Authorization: Bearer <CRON_SECRET>
// (Vercel cron sends this automatically). If unset, the route is open — set
// CRON_SECRET in production.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RUPYZ_BASE = "https://newest.rupyz.com";

function istToday(): string {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

function isISODate(s: string | null): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

interface RupyzBeat {
  id: number;
  name: string;
  sc_count?: number;
  distributor_id?: number;
  distributor_name?: string;
  distributor_customer_level?: string;
}

interface RupyzRecord {
  user_id: number;
  staff_id?: number;
  name?: string;
  mobile?: string;
  roles?: string[];
  manager?: string | null;
  beat_list?: RupyzBeat[];
  tc_count?: number;
  pc_count?: number;
  nc_count?: number;
  sc_count?: number;
  lead_count?: number;
  telephonic_order_count?: number;
  order_value?: number;
  order_count?: number;
  weight?: number;
  volume?: number;
  productivity_percent?: number;
  coverage_percent?: number;
  total_retailing_time?: number;
  start_day?: string | null;
  first_activity?: string | null;
  last_activity?: string | null;
  end_day?: string | null;
  distance_travelled?: number;
  is_fake_location_detected?: boolean;
}

async function syncDate(
  admin: ReturnType<typeof createAdminClient>,
  orgId: number,
  token: string,
  date: string,
  byRupyz: Map<number, string>,
): Promise<{ date: string; records?: number; upserted?: number; error?: string; auth_failed?: boolean }> {
  const endpoint =
    `${RUPYZ_BASE}/v2/organization/${orgId}/activity/team/dashboard/` +
    `?page_no=1&by_date_range=CUSTOM&start_date=${date}&end_date=${date}`;

  let res: Response;
  try {
    res = await fetch(endpoint, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        os: "WEB",
        source: "WEB",
      },
    });
  } catch (e) {
    return { date, error: `fetch failed: ${e instanceof Error ? e.message : String(e)}` };
  }

  if (res.status === 401 || res.status === 403) {
    return { date, error: "Rupyz token rejected", auth_failed: true };
  }
  if (!res.ok) {
    return { date, error: `Rupyz returned ${res.status}` };
  }

  const body = await res.json().catch(() => null);
  const records: RupyzRecord[] = body?.data?.records ?? [];

  let upserted = 0;
  let firstError: string | null = null;
  for (const r of records) {
    const rupyzUserId = Number(r.user_id);
    const salesmanId = byRupyz.get(rupyzUserId) ?? null;
    const rolesText = Array.isArray(r.roles) ? r.roles.join(", ") : null;

    const { error } = await admin
      .from("salesman_daily_activity")
      .upsert(
        {
          activity_date: date,
          rupyz_user_id: rupyzUserId,
          salesman_id: salesmanId,
          name: r.name ?? null,
          mobile: r.mobile ?? null,
          roles: rolesText,
          manager: r.manager ?? null,
          sc_count: r.sc_count ?? 0,
          tc_count: r.tc_count ?? 0,
          pc_count: r.pc_count ?? 0,
          nc_count: r.nc_count ?? 0,
          lead_count: r.lead_count ?? 0,
          telephonic_order_count: r.telephonic_order_count ?? 0,
          order_value: r.order_value ?? 0,
          order_count: r.order_count ?? 0,
          weight_kg: r.weight ?? 0,
          volume: r.volume ?? 0,
          productivity_percent: r.productivity_percent ?? 0,
          coverage_percent: r.coverage_percent ?? 0,
          total_retailing_time: r.total_retailing_time ?? 0,
          beat_list: r.beat_list ?? null,
          start_day: r.start_day ?? null,
          first_activity: r.first_activity ?? null,
          last_activity: r.last_activity ?? null,
          end_day: r.end_day ?? null,
          distance_travelled: r.distance_travelled ?? 0,
          is_fake_location_detected: r.is_fake_location_detected ?? false,
          raw: r as unknown as Record<string, unknown>,
          synced_at: new Date().toISOString(),
        },
        { onConflict: "activity_date,rupyz_user_id" },
      );
    if (!error) upserted++;
    else if (!firstError) firstError = error.message;
  }

  return { date, records: records.length, upserted, error: firstError ?? undefined };
}

export async function GET(req: NextRequest) {
  // Auth (Vercel cron sends Authorization: Bearer <CRON_SECRET>)
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const url = new URL(req.url);
  const dateParam = url.searchParams.get("date");
  const startParam = url.searchParams.get("start");
  const endParam = url.searchParams.get("end");

  // Build the list of dates to sync
  let dates: string[] = [];
  if (isISODate(startParam) && isISODate(endParam)) {
    const s = new Date(startParam + "T00:00:00Z");
    const e = new Date(endParam + "T00:00:00Z");
    if (e < s) return NextResponse.json({ error: "end before start" }, { status: 400 });
    // Cap to 40 days to avoid runaway loops
    for (let d = new Date(s); d <= e; d.setUTCDate(d.getUTCDate() + 1)) {
      dates.push(d.toISOString().slice(0, 10));
      if (dates.length >= 40) break;
    }
  } else {
    dates = [isISODate(dateParam) ? dateParam : istToday()];
  }

  const admin = createAdminClient();

  // Token + org from rupyz_session
  const { data: session } = await admin
    .from("rupyz_session")
    .select("org_id, access_token")
    .eq("id", 1)
    .maybeSingle();
  if (!session?.access_token || !session.org_id) {
    return NextResponse.json(
      { error: "rupyz_session not configured (no token/org). Set the Rupyz token in Settings." },
      { status: 503 },
    );
  }

  // salesmen map: rupyz_id -> salesman uuid
  const { data: salesmen } = await admin.from("salesmen").select("id, rupyz_id");
  const byRupyz = new Map<number, string>();
  for (const s of (salesmen ?? []) as Array<{ id: string; rupyz_id: number | null }>) {
    if (s.rupyz_id != null) byRupyz.set(Number(s.rupyz_id), s.id);
  }

  const results = [];
  let totalUpserted = 0;
  for (const date of dates) {
    const r = await syncDate(admin, Number(session.org_id), session.access_token, date, byRupyz);
    if (r.auth_failed) {
      return NextResponse.json(
        { error: "Rupyz token rejected — refresh it in Settings.", failedOn: date, partial: results },
        { status: 401 },
      );
    }
    if (typeof r.upserted === "number") totalUpserted += r.upserted;
    results.push(r);
  }

  return NextResponse.json({ ok: true, days: dates.length, totalUpserted, results });
}
