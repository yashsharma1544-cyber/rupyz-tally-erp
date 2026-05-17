// =============================================================================
// /beats/manage-areas — bulk-assign an `area` to each beat
// =============================================================================
// Used to group beats into areas (e.g. Jalna, Mehkar, Lonar). The area field
// powers the Phase 8 target-distribution tool: admin enters a JC target for
// an area and the system splits it across that area's beats by historical
// share.
// =============================================================================

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ManageAreasClient } from "./manage-areas-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export interface BeatRow {
  id: string;
  name: string;
  city: string | null;
  area: string | null;
}

export default async function ManageAreasPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?from=/beats/manage-areas");

  const { data: me } = await supabase
    .from("app_users")
    .select("role, active")
    .eq("id", user.id)
    .single();
  if (!me?.active || me.role !== "admin") {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <h1 className="text-base font-semibold mb-1">Not authorized</h1>
        <p className="text-sm text-ink-muted">
          Only admins can manage beat areas.
        </p>
      </div>
    );
  }

  const { data: beats, error } = await supabase
    .from("beats")
    .select("id, name, city, area")
    .order("name", { ascending: true });

  if (error) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <h1 className="text-base font-semibold mb-1">Couldn&apos;t load beats</h1>
        <p className="text-xs text-ink-muted">{error.message}</p>
        <p className="text-xs text-ink-muted mt-2">
          If the error mentions the column &quot;area&quot;, run the migration
          first:
          <code className="ml-1 px-1 py-0.5 bg-paper-subtle rounded">
            alter table beats add column area text;
          </code>
        </p>
      </div>
    );
  }

  return <ManageAreasClient beats={(beats ?? []) as BeatRow[]} />;
}
