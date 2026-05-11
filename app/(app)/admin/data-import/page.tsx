// =============================================================================
// /admin/data-import — admin-only Tally backfill upload page
// =============================================================================

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DataImportClient } from "./data-import-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DataImportPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?from=/admin/data-import");
  const { data: me } = await supabase
    .from("app_users")
    .select("role, active")
    .eq("id", user.id)
    .single();
  if (!me?.active || me.role !== "admin") {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <h1 className="text-base font-semibold mb-1">Not authorized</h1>
        <p className="text-sm text-ink-muted">Admin only.</p>
      </div>
    );
  }
  return <DataImportClient />;
}
