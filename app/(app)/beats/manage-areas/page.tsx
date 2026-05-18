// =============================================================================
// /beats/manage-areas — create/rename/delete areas + assign each beat to one
// =============================================================================
// Areas are first-class entities (table: areas). Beats reference an area via
// beats.area_id. Used downstream by the JC target-distribution tool.
// =============================================================================

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ManageAreasClient } from "./manage-areas-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export interface AreaRow {
  id: string;
  name: string;
  beat_count: number;
}

export interface BeatRow {
  id: string;
  name: string;
  city: string | null;
  area_id: string | null;
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
  if (!me?.active || !["admin", "accounts"].includes(me.role)) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <h1 className="text-base font-semibold mb-1">Not authorized</h1>
        <p className="text-sm text-ink-muted">Only admins can manage areas.</p>
      </div>
    );
  }

  const [areasResult, beatsResult] = await Promise.all([
    supabase
      .from("areas")
      .select("id, name")
      .order("name", { ascending: true }),
    supabase
      .from("beats")
      .select("id, name, city, area_id")
      .order("name", { ascending: true }),
  ]);

  if (areasResult.error) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <h1 className="text-base font-semibold mb-1">
          Couldn&apos;t load areas
        </h1>
        <p className="text-xs text-ink-muted">{areasResult.error.message}</p>
        <p className="text-xs text-ink-muted mt-2">
          If the areas table doesn&apos;t exist, run migration{" "}
          <code>sql/46_areas_table.sql</code> in Supabase first.
        </p>
      </div>
    );
  }
  if (beatsResult.error) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <h1 className="text-base font-semibold mb-1">
          Couldn&apos;t load beats
        </h1>
        <p className="text-xs text-ink-muted">{beatsResult.error.message}</p>
      </div>
    );
  }

  const beats = (beatsResult.data ?? []) as BeatRow[];

  // Aggregate beat counts per area from the loaded beats list
  const countByArea = new Map<string, number>();
  for (const b of beats) {
    if (b.area_id) {
      countByArea.set(b.area_id, (countByArea.get(b.area_id) ?? 0) + 1);
    }
  }
  const areas: AreaRow[] = (areasResult.data ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    beat_count: countByArea.get(a.id) ?? 0,
  }));

  return <ManageAreasClient areas={areas} beats={beats} />;
}
