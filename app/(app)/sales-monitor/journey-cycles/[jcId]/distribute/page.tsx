import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getJourneyCycleById } from "@/lib/sales-monitor/journey-cycle";
import {
  loadAreaDistribution,
  loadAreaTarget,
  loadBeatTargets,
  loadCustomerTargets,
  type BeatHist,
  type SavedBeatTarget,
  type SavedCustomerTarget,
} from "@/lib/sales-monitor/distribution";
import { DistributeClient } from "./distribute-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export interface AreaOption {
  id: string;
  name: string;
}

export default async function DistributePage({
  params,
  searchParams,
}: {
  params: { jcId: string };
  searchParams: { area?: string };
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await supabase
    .from("app_users").select("role, active").eq("id", user.id).single();
  if (!me?.active || me.role !== "admin") redirect("/");

  const jc = await getJourneyCycleById(params.jcId);
  if (!jc) redirect("/sales-monitor/journey-cycles");

  const { data: areasData, error: areasErr } = await supabase
    .from("areas")
    .select("id, name")
    .order("name");
  if (areasErr) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <h1 className="text-base font-semibold mb-1">Couldn&apos;t load areas</h1>
        <p className="text-xs text-ink-muted">{areasErr.message}</p>
      </div>
    );
  }
  const areas = (areasData ?? []) as AreaOption[];

  if (areas.length === 0) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <Link href={`/sales-monitor/journey-cycles/${jc.id}`}
          className="text-xs text-ink-muted hover:underline inline-flex items-center gap-1 mb-3">
          <ArrowLeft size={11}/> Back to JC plan
        </Link>
        <h1 className="text-base font-semibold mb-1">No areas configured</h1>
        <p className="text-sm text-ink-muted">
          Create at least one area and assign beats to it before distributing
          targets.{" "}
          <Link href="/beats/manage-areas" className="underline">
            Manage areas →
          </Link>
        </p>
      </div>
    );
  }

  // Default to first area unless caller specified ?area=
  const selectedAreaId = searchParams.area || areas[0].id;
  const selectedArea = areas.find((a) => a.id === selectedAreaId) || areas[0];

  // Load history + existing targets for the selected area
  const beats: BeatHist[] = await loadAreaDistribution(selectedArea.id);
  const beatIds = beats.map((b) => b.id);
  const customerIds = beats.flatMap((b) => b.customers.map((c) => c.id));

  const [areaTarget, beatTargets, customerTargets] = await Promise.all([
    loadAreaTarget(jc.id, selectedArea.id),
    loadBeatTargets(jc.id, beatIds),
    loadCustomerTargets(jc.id, customerIds),
  ]);

  // Map → record for client serialization
  const beatTargetsRec: Record<string, SavedBeatTarget> = {};
  beatTargets.forEach((v, k) => { beatTargetsRec[k] = v; });
  const customerTargetsRec: Record<string, SavedCustomerTarget> = {};
  customerTargets.forEach((v, k) => { customerTargetsRec[k] = v; });

  return (
    <DistributeClient
      jc={jc}
      areas={areas}
      selectedAreaId={selectedArea.id}
      beats={beats}
      areaTarget={areaTarget}
      beatTargetsRec={beatTargetsRec}
      customerTargetsRec={customerTargetsRec}
    />
  );
}
