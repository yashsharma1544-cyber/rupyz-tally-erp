import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Cross-project client: reads tally-dashboard-v2's Supabase
 * (project zrdvmgxnmcqnxvlitonz) from inside rupyz-tally-erp.
 *
 * SERVICE ROLE KEY — server-side only. Never import this file
 * from a component marked 'use client'.
 */

let cached: SupabaseClient | null = null;

export function tallyDashboardClient(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.TALLY_DASHBOARD_SUPABASE_URL;
  const key = process.env.TALLY_DASHBOARD_SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'Missing TALLY_DASHBOARD_SUPABASE_URL or TALLY_DASHBOARD_SUPABASE_SERVICE_ROLE_KEY'
    );
  }

  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: 'public' },
    global: { headers: { 'x-client-info': 'rupyz-tally-erp/sales' } },
  });

  return cached;
}
