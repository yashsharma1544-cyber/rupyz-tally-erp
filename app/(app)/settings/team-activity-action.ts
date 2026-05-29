"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { data: appUser } = await supabase
    .from("app_users")
    .select("role, active")
    .eq("id", user.id)
    .single();
  if (!appUser?.active || appUser.role !== "admin") throw new Error("Not authorized");
}

export async function runTeamActivitySyncNow(): Promise<
  | { ok: true; totalUpserted: number; days: number }
  | { ok: false; error: string }
> {
  try {
    await requireAdmin();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Auth failed" };
  }

  const secret = process.env.CRON_SECRET;
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://rupyz-tally-erp.vercel.app");

  try {
    const res = await fetch(
      `${baseUrl}/api/sales-monitor/cron/team-activity?triggered_by=manual`,
      {
        headers: secret ? { Authorization: `Bearer ${secret}` } : {},
        cache: "no-store",
      },
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: body?.error ?? `HTTP ${res.status}` };
    }
    revalidatePath("/sales-monitor");
    return {
      ok: true,
      totalUpserted: Number(body?.totalUpserted ?? 0),
      days: Number(body?.days ?? 0),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
