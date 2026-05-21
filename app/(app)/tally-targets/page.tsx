// =============================================================================
// /tally-targets — STANDALONE target system driven by imported Tally sales.
// Independent of Rupyz orders and the journey-cycle distribute flow.
// =============================================================================

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { TallyTargetsClient } from "./tally-targets-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function TallyTargetsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?from=/tally-targets");

  const { data: me } = await supabase
    .from("app_users").select("role, active").eq("id", user.id).single();
  if (!me?.active || me.role !== "admin") {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <h1 className="text-base font-semibold mb-1">Not authorized</h1>
        <p className="text-sm text-ink-muted">Tally Targets are admin-only.</p>
      </div>
    );
  }

  const admin = createAdminClient();
  const { data: groups } = await admin.rpc("tally_party_groups");
  const partyGroups = (groups ?? []) as {
    party_group: string; root_group: string; parties: number; total_kg: number;
  }[];

  const { count: salesCount } = await admin
    .from("tally_sales").select("id", { count: "exact", head: true });

  return (
    <div className="min-h-screen bg-paper">
      <div className="max-w-5xl mx-auto px-4 py-6">
        <h1 className="text-xl font-semibold leading-tight mb-1">Tally Targets</h1>
        <p className="text-sm text-ink-muted mb-5">
          Independent target system built from Tally sales. Pick a beat (party group),
          enter a kg target, and it splits across shops by their Tally sales share — all
          editable. Separate from Rupyz and journey-cycle targets.
        </p>
        <TallyTargetsClient
          partyGroups={partyGroups}
          salesRowCount={salesCount ?? 0}
        />
      </div>
    </div>
  );
}
