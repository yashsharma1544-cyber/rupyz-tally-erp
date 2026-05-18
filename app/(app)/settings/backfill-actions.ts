"use server";

import { createClient } from "@/lib/supabase/server";

// This file extends the existing app/(app)/settings/actions.ts.
// If you have an existing actions.ts there, MERGE these exports into it
// instead of replacing the whole file.

interface BackfillResponse {
  ok: boolean;
  finalStatus: string;
  counters: { inserted: number; updated: number; skipped: number };
  pagesThisRun: number;
  resumeAt?: number;
  error?: string;
}

export async function triggerBackfill(): Promise<{ ok: true; result: BackfillResponse } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated" };
  
  // Restrict to admin
  const { data: appUser } = await supabase
    .from("app_users")
    .select("role")
    .eq("id", user.id)
    .single();
  if (appUser?.role !== "admin") return { ok: false, error: "Admin only" };

  // Invoke the Edge Function
  const { data, error } = await supabase.functions.invoke("rupyz-backfill", {
    body: {},
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true, result: data as BackfillResponse };
}

export async function resetBackfill(): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const { data: appUser } = await supabase
    .from("app_users")
    .select("role")
    .eq("id", user.id)
    .single();
  if (appUser?.role !== "admin") return { ok: false, error: "Admin only" };

  const { error } = await supabase.rpc("rupyz_backfill_reset");
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function setBackfillConfig(opts: {
  cutoff_date?: string | null;
  max_pages?: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const { data: appUser } = await supabase
    .from("app_users")
    .select("role")
    .eq("id", user.id)
    .single();
  if (appUser?.role !== "admin") return { ok: false, error: "Admin only" };

  const update: Record<string, unknown> = {};
  if (opts.cutoff_date !== undefined) update.cutoff_date = opts.cutoff_date;
  if (opts.max_pages !== undefined) update.max_pages = opts.max_pages;
  if (Object.keys(update).length === 0) return { ok: true };

  const { error } = await supabase
    .from("rupyz_backfill_state")
    .update(update)
    .eq("id", 1);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
