"use server";

import { createClient } from "@/lib/supabase/server";

export async function triggerSync() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  const { data: appUser } = await supabase.from("app_users").select("role,active").eq("id", user.id).single();
  if (!appUser?.active || appUser.role !== "admin") return { error: "Admin only" };

  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey    = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!projectUrl || !anonKey) return { error: "Supabase env not configured" };

  const url = `${projectUrl}/functions/v1/rupyz-sync`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${anonKey}`,
        "content-type": "application/json",
        "x-trigger": "manual",
        ...(process.env.RUPYZ_SYNC_SECRET ? { "x-rupyz-sync-secret": process.env.RUPYZ_SYNC_SECRET } : {}),
      },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { error: body?.error ?? `Edge function returned ${res.status}` };
    }
    const c = body?.counters ?? {};
    const summary = `+${c.orders_inserted ?? 0} new, ${c.orders_updated ?? 0} updated, ${c.orders_skipped ?? 0} skipped`;
    return { ok: true, summary };
  } catch (e: any) {
    return { error: e?.message ?? String(e) };
  }
}
