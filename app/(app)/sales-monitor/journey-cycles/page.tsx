import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import {
  listJourneyCycles,
  listPlanEntriesForJc,
  listActiveSalesmen,
  listBeats,
} from "@/lib/sales-monitor/journey-cycle";
import { PjpGridClient } from "./pjp-grid-client";

export const dynamic = "force-dynamic";

function todayIstString(): string {
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  return new Date(Date.now() + istOffsetMs).toISOString().slice(0, 10);
}

export default async function JourneyCyclesPage({
  searchParams,
}: {
  searchParams: { jc?: string };
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: appUser } = await supabase
    .from("app_users").select("role").eq("id", user.id).single();
  if (!appUser || appUser.role !== "admin") redirect("/");

  const cycles = await listJourneyCycles();

  const header = (
    <div className="flex items-center justify-between">
      <h1 className="text-xl font-semibold">PJP — Journey Cycle Planning</h1>
      <Link href="/sales-monitor" className="text-xs text-ink-muted hover:underline flex items-center gap-1">
        <ArrowLeft size={12} /> Sales Monitor
      </Link>
    </div>
  );

  if (cycles.length === 0) {
    return (
      <div className="max-w-6xl mx-auto p-4 space-y-3">
        {header}
        <p className="text-sm text-ink-muted">No journey cycles found.</p>
      </div>
    );
  }

  const today = todayIstString();
  const selected =
    cycles.find((c) => c.id === searchParams.jc) ??
    cycles.find((c) => c.start_date <= today && c.end_date >= today) ??
    cycles[0];

  const [planEntries, salesmen, beats] = await Promise.all([
    listPlanEntriesForJc(selected.id),
    listActiveSalesmen(),
    listBeats(),
  ]);

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-3">
      {header}
      <p className="text-sm text-ink-muted">
        Plan each salesman&apos;s beat for every day of a Journey Cycle. Pick a JC, fill the grid, Save, then
        Apply to push it into the daily schedule.
      </p>
      <PjpGridClient
        jc={selected}
        allCycles={cycles}
        planEntries={planEntries}
        salesmen={salesmen}
        beats={beats}
        today={today}
      />
    </div>
  );
}
