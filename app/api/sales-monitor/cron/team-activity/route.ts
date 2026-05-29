// =============================================================================
// /api/sales-monitor/cron/team-activity
//
// Pulls Rupyz "team activity" (the MIS / team-activity dashboard) for a date
// and upserts one row per salesman into salesman_daily_activity.
//
// Heartbeat: every successful run (HTTP 200) updates
// rupyz_session.last_team_activity_sync_at = now(), regardless of whether
// any records were upserted. The staleness banner reads from THAT, not from
// max(salesman_daily_activity.synced_at), so quiet days (Rupyz returning
// zero records before any salesman has started) don't trigger a false alarm.
//
// Query params:
//   ?date=YYYY-MM-DD          one day (default: today IST)
//   ?start=YYYY-MM-DD&end=... inclusive range (for backfilling a whole JC)
//
// Auth (either is accepted):
//   1. Authorization: Bearer <CRON_SECRET>      (Vercel cron sends this)
//   2. Logged-in admin session (cookie-based)   (you, hitting the URL in
//      a browser tab while signed in to the app)
// If CRON_SECRET is unset, the route is open — set CRON_SECRET in production.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
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

/**
 * Accept either CRON_SECRET bearer (Vercel cron) OR a logged-in admin session
 * (so you can force a run from a browser tab without hunting for the secret).
 */
async function authOk(req: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET;

  // Path 1: CRON_SECRET bearer
  if (secret) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth === `Bearer ${secret}`) return true;
  } else {
    // No CRON_SECRET configured -> route is open (dev only)
    return true;
  }

  // Path 2: admin session via cookies
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;
    const { data: appUser } = await supabase
      .from("app_users")
      .select("role, active")
      .eq("id", user.id)
      .single();
    return Boolean(appUser?.active && appUser.role === "admin");
  } catch {
    return false;
  }
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
  if (!(await authOk(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const dateParam = url.searchParams.get("date");
  const startParam = url.searchParams.get("start");
  const endParam = url.searchParams.get("end");

  let dates: string[] = [];
  if (isISODate(startParam) && isISODate(endParam)) {
    const s = new Date(startParam + "T00:00:00Z");
    const e = new Date(endParam + "T00:00:00Z");
    if (e < s) return NextResponse.json({ error: "end before start" }, { status: 400 });
    for (let d = new Date(s); d <= e; d.setUTCDate(d.getUTCDate() + 1)) {
      dates.push(d.toISOString().slice(0, 10));
      if (dates.length >= 40) break;
    }
  } else {
    dates = [isISODate(dateParam) ? dateParam : istToday()];
  }

  const admin = createAdminClient();

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

  // Heartbeat — stamp the successful run on rupyz_session so the staleness
  // banner reflects "cron ran" not "data landed".
  await admin
    .from("rupyz_session")
    .update({ last_team_activity_sync_at: new Date().toISOString() })
    .eq("id", 1);

  return NextResponse.json({ ok: true, days: dates.length, totalUpserted, results });
}
