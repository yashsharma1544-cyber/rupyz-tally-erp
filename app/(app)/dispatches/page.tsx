import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { DispatchesClient } from "./dispatches-client";
import type { AppUser } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function DispatchesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase.from("app_users").select("*").eq("id", user.id).single();
  if (!me) redirect("/dashboard");

  return (
    <>
      <PageHeader title="Dispatches" subtitle="Warehouse shipment queue" />
      <DispatchesClient me={me as AppUser} />
    </>
  );
}
