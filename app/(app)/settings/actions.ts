"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

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

// ============================================================================
// UPDATE RUPYZ TOKEN
// Admin pastes a fresh access token from Rupyz browser DevTools. We validate it
// by hitting Rupyz's order list endpoint, then write it to rupyz_session.
// ============================================================================
const RUPYZ_BASE = "https://newest.rupyz.com";

export async function updateRupyzToken(rawToken: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  const { data: appUser } = await supabase.from("app_users").select("role,active").eq("id", user.id).single();
  if (!appUser?.active || appUser.role !== "admin") return { error: "Admin only" };

  // Strip "Bearer " prefix if user pasted it accidentally
  const token = rawToken.trim().replace(/^bearer\s+/i, "").trim();
  if (!token) return { error: "Empty token" };
  if (token.length < 50) return { error: "That doesn't look like a token (too short)" };

  // Load current session for org_id
  const admin = createAdminClient();
  const { data: session } = await admin.from("rupyz_session").select("org_id").eq("id", 1).maybeSingle();
  if (!session?.org_id) return { error: "rupyz_session not initialized — run sql/05_seed_rupyz_session.sql first" };

  // Validate token by hitting Rupyz's order list endpoint
  try {
    const res = await fetch(`${RUPYZ_BASE}/v2/organization/${session.org_id}/order/?page_no=1&user_id=`, {
      headers: {
        "accept": "application/json",
        "authorization": `Bearer ${token}`,
        "os": "WEB",
        "source": "WEB",
      },
    });
    if (res.status === 401 || res.status === 403) {
      return { error: "Token rejected by Rupyz. Make sure you copied the full token and that you're still logged into Rupyz." };
    }
    if (!res.ok) {
      return { error: `Rupyz returned ${res.status}. The token might be wrong or Rupyz is having issues.` };
    }
  } catch (e: unknown) {
    return { error: `Could not reach Rupyz: ${e instanceof Error ? e.message : String(e)}` };
  }

  // Token works — save it. We don't know the actual expiry from Rupyz, so we
  // optimistically set 24h ahead (most session tokens last at least that long).
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const { error: updErr } = await admin.from("rupyz_session").update({
    access_token: token,
    expires_at: expiresAt,
    last_refreshed_at: new Date().toISOString(),
  }).eq("id", 1);
  if (updErr) return { error: `Failed to save: ${updErr.message}` };

  return { ok: true };
}
