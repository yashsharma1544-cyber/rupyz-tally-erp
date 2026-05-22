// =============================================================================
// /tally-targets — STANDALONE multi-company target system from Tally sales.
// Companies: Sushil Agencies, Anjali Agencies. Independent of Rupyz/distribute.
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
  const { data: groups } = await admin.rpc("tally_party_groups", { p_company: null });
  const partyGroups = (groups ?? []) as {
    company: string; party_group: string; root_group: string; parties: number; total_kg: number;
  }[];
  const { data: companies } = await admin.rpc("tally_companies");
  const companyList = (companies ?? []) as { company: string; rows: number; total_kg: number }[];

  const { count: salesCount } = await admin
    .from("tally_sales").select("id", { count: "exact", head: true });

  return (
    <div className="min-h-screen bg-paper">
      <div className="max-w-5xl mx-auto px-4 py-6">
        <h1 className="text-xl font-semibold leading-tight mb-1">Tally Targets</h1>
        <p className="text-sm text-ink-muted mb-5">
          Independent target system from Tally sales, per company. Pick a company and beat,
          enter a kg target, and it splits across shops by Tally sales share — all editable.
          Sushil: GST Sales + New Mondha (26-27). Anjali: all sales except Priya (both years).
        </p>
        <TallyTargetsClient
          partyGroups={partyGroups}
          companies={companyList}
          salesRowCount={salesCount ?? 0}
        />
      </div>
    </div>
  );
}
