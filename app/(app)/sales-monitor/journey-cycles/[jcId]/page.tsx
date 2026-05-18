import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import {
  getJourneyCycleById,
  listPlanEntriesForJc,
  listActiveSalesmen,
  listBeats,
  listJourneyCycles,
} from "@/lib/sales-monitor/journey-cycle";
import { JcPlanClient } from "./jc-plan-client";

export const dynamic = "force-dynamic";

export default async function JourneyCycleDetailPage({
  params,
}: {
  params: { jcId: string };
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: appUser } = await supabase
    .from("app_users").select("role").eq("id", user.id).single();
  if (!appUser || !["admin", "accounts"].includes(appUser.role)) redirect("/");

  const jc = await getJourneyCycleById(params.jcId);
  if (!jc) redirect("/sales-monitor/journey-cycles");

  const [planEntries, salesmen, beats, allCycles] = await Promise.all([
    listPlanEntriesForJc(jc.id),
    listActiveSalesmen(),
    listBeats(),
    listJourneyCycles(),
  ]);

  return (
    <JcPlanClient
      jc={jc}
      planEntries={planEntries}
      salesmen={salesmen}
      beats={beats}
      allCycles={allCycles}
    />
  );
}
