import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { TripPlanner } from "./trip-planner";
import type { AppUser, Beat } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function NewTripPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: me }, { data: beats }, { data: vanLeads }] = await Promise.all([
    supabase.from("app_users").select("*").eq("id", user.id).single(),
    supabase.from("beats").select("id, name, is_van_beat").eq("is_van_beat", true).order("name"),
    supabase.from("app_users").select("id, full_name").in("role", ["admin", "van_lead"]).eq("active", true).order("full_name"),
  ]);

  if (!me) redirect("/dashboard");
  const meTyped = me as AppUser;
  if (!["admin", "van_lead"].includes(meTyped.role)) {
    return (
      <div className="p-6">
        <PageHeader title="Forbidden" subtitle="Only admin or van_lead can create trips" />
      </div>
    );
  }

  return (
    <>
      <PageHeader title="New VAN Trip" subtitle="Pick beat + pre-orders. Buffer stock is added on the loading sheet." />
      <TripPlanner
        me={meTyped}
        beats={(beats ?? []) as Pick<Beat, "id" | "name" | "is_van_beat">[]}
        vanLeads={(vanLeads ?? []) as Pick<AppUser, "id" | "full_name">[]}
      />
    </>
  );
}
