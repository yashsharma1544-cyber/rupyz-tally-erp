import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { TripsClient } from "./trips-client";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import Link from "next/link";
import type { AppUser } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function TripsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase.from("app_users").select("*").eq("id", user.id).single();
  if (!me) redirect("/dashboard");

  const canCreate = ["admin", "van_lead"].includes((me as AppUser).role);

  return (
    <>
      <PageHeader
        title="VAN Trips"
        subtitle="Plan, run, reconcile delivery trips"
        actions={
          canCreate ? (
            <Link href="/trips/new">
              <Button size="sm"><Plus size={13}/> New Trip</Button>
            </Link>
          ) : undefined
        }
      />
      <TripsClient me={me as AppUser} />
    </>
  );
}
