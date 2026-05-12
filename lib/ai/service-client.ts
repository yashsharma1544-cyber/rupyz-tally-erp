/**
 * Service-role Supabase client.
 *
 * For server-side use only. Bypasses RLS — never expose this client to
 * client code. Use sparingly: only when you genuinely need to bypass
 * user-level permissions (e.g. writing AI cache entries that admins
 * generated, or reading data that the user wouldn't normally have
 * permission for but is needed for an admin-authorized AI feature).
 *
 * Auth checks should happen BEFORE using this client, via the regular
 * user-context client in @/lib/supabase/server.
 */

import "server-only";
import { createClient } from "@supabase/supabase-js";

export function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env. " +
      "Set both in Vercel env vars."
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
