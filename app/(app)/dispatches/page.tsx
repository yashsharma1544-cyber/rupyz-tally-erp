// =============================================================================
// /dispatches — admin list of all dispatches across statuses
//
// Server component: authenticates user, then passes the AppUser to the client.
// The client fetches dispatches via its own supabase client and handles
// filtering by status.
// =============================================================================

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { DispatchesClient } from "./dispatches-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DispatchesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?from=/dispatches");

  const { data: me } = await supabase
    .from("app_users")
    .select("*")
    .eq("id", user.id)
    .single();
  if (!me?.active) redirect("/login");

  return (
    <>
      <PageHeader title="Dispatches" subtitle="Active and completed dispatch records" />
      <DispatchesClient me={me} />
    </>
  );
}
