// =============================================================================
// /out-for-delivery/parties — Party → Beat admin mapping
//
// Lists every Anjali OCS party with its invoice count, value, and current beat
// (either inferred by regex or manually overridden). Admin can inline-select a
// beat per party; dropdown save writes a tally_party_beat_overrides row and
// updates all tally_invoices.inferred_beat for that party in one go.
//
// Default filter: beat='Unassigned' (the parties still needing attention).
// =============================================================================

import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/layout/page-header";
import { PartiesClient, type PartyRow } from "./parties-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Keep in sync with /out-for-delivery/page.tsx
const OUTSTATION_VOUCHER_TYPES = ["GST INTERCITY SALES", "NEW MONDHA"] as const;

type SearchParams = { beat?: string; q?: string };

export default async function PartiesBeatsPage({ searchParams }: { searchParams: SearchParams }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?from=/out-for-delivery/parties");
  const { data: me } = await supabase.from("app_users").select("role, active").eq("id", user.id).single();
  if (!me?.active || me.role !== "admin") redirect("/");

  const admin = createAdminClient();

  const beatFilter = searchParams.beat ?? "Unassigned";
  const q = searchParams.q?.trim() ?? "";

  // Aggregate parties with their invoice stats + current beat
  // Prefer override, else inferred_beat from tally_invoices
  const { data: invRows } = await admin
    .from("tally_invoices")
    .select("party_name, inferred_beat, total_amount")
    .eq("company", "Anjali Agency")
    .in("voucher_type", OUTSTATION_VOUCHER_TYPES as unknown as string[]);

  const { data: overrides } = await admin
    .from("tally_party_beat_overrides")
    .select("party_name, beat, updated_at, updated_by_name");
  const overrideMap = new Map<string, { beat: string; at: string; by: string | null }>();
  for (const o of overrides ?? []) {
    overrideMap.set(o.party_name as string, {
      beat: o.beat as string,
      at: o.updated_at as string,
      by: (o.updated_by_name as string) ?? null,
    });
  }

  const agg = new Map<string, { invoices: number; value: number; beat: string }>();
  for (const r of invRows ?? []) {
    const name = (r.party_name as string) ?? "";
    const cur = agg.get(name) ?? { invoices: 0, value: 0, beat: "Unassigned" };
    cur.invoices += 1;
    cur.value += Number(r.total_amount) || 0;
    cur.beat = (r.inferred_beat as string) ?? "Unassigned";
    agg.set(name, cur);
  }

  const allParties: PartyRow[] = Array.from(agg.entries()).map(([name, v]) => {
    const ov = overrideMap.get(name);
    return {
      party_name: name,
      invoices: v.invoices,
      value: v.value,
      current_beat: v.beat,
      is_override: ov != null,
      overridden_by: ov?.by ?? null,
      overridden_at: ov?.at ?? null,
    };
  });

  // Filter + sort
  const filtered = allParties.filter((p) => {
    if (beatFilter && beatFilter !== "all" && p.current_beat !== beatFilter) return false;
    if (q && !p.party_name.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }).sort((a, b) => b.invoices - a.invoices);

  // Beat distribution counts (for filter chips)
  const beatCounts = new Map<string, number>();
  for (const p of allParties) {
    beatCounts.set(p.current_beat, (beatCounts.get(p.current_beat) ?? 0) + 1);
  }

  return (
    <>
      <PageHeader title="Parties & Beats" subtitle="Assign Anjali outstation parties to their beats — one-time cleanup" />
      <div className="p-4 md:p-6 space-y-4">
        <Link href="/out-for-delivery" className="text-sm text-ink-muted hover:text-accent inline-flex items-center gap-1">
          <ArrowLeft size={14} /> Back to Out for Delivery
        </Link>
        <PartiesClient
          parties={filtered}
          beatCounts={Array.from(beatCounts.entries()).sort((a, b) => b[1] - a[1])}
          filters={{ beat: beatFilter, q }}
          totalParties={allParties.length}
        />
      </div>
    </>
  );
}
