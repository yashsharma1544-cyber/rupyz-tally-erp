// =============================================================================
// /targets — set per-journey-cycle kg targets for a beat, allocated to its
// customers by 12-month kg share. Standalone admin page; the same allocator
// also appears on each beat's detail page.
// =============================================================================

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TargetsClient } from "./targets-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function TargetsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?from=/targets");

  const { data: me } = await supabase
    .from("app_users")
    .select("role, active")
    .eq("id", user.id)
    .single();
  if (!me?.active || me.role !== "admin") {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <h1 className="text-base font-semibold mb-1">Not authorized</h1>
        <p className="text-sm text-ink-muted">Targets are admin-only.</p>
      </div>
    );
  }

  const [{ data: beatRows }, { data: cycleRows }] = await Promise.all([
    supabase.from("beats").select("id, name, city").order("name"),
    supabase
      .from("journey_cycles")
      .select("id, jc_number, start_date, end_date")
      .order("start_date", { ascending: false })
      .limit(24),
  ]);

  const beats = (beatRows ?? []) as { id: string; name: string; city: string | null }[];
  const cycles = (cycleRows ?? []) as {
    id: string; jc_number: number; start_date: string; end_date: string;
  }[];

  return (
    <div className="min-h-screen bg-paper">
      <div className="max-w-5xl mx-auto px-4 py-6">
        <h1 className="text-xl font-semibold leading-tight mb-1">Beat targets</h1>
        <p className="text-sm text-ink-muted mb-5">
          Set a kg target for a beat per journey cycle. It auto-allocates to customers by
          their 12-month sales share — adjust any customer&apos;s share manually before saving.
        </p>
        <TargetsClient beats={beats} cycles={cycles} />
      </div>
    </div>
  );
}
