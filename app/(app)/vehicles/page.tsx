// =============================================================================
// /vehicles — manage the vehicle list (add / edit / deactivate / delete)
//
// Vehicles are saved permanently. They feed the dropdown on /load. Deactivating
// hides a vehicle from loading but keeps its history; a vehicle never used in
// any load can be deleted outright.
//
// Auth: admin and dispatch only.
// =============================================================================

import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { listVehicles } from "@/app/(app)/dispatches/actions";
import { VehiclesClient } from "./vehicles-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function VehiclesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?from=/vehicles");

  const { data: me } = await supabase.from("app_users").select("role, active").eq("id", user.id).single();
  if (!me?.active || !["admin", "dispatch"].includes(me.role)) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <h1 className="text-base font-semibold mb-1">Not authorized</h1>
        <p className="text-sm text-ink-muted">This page is for admin and dispatch.</p>
      </div>
    );
  }

  const res = await listVehicles();
  const vehicles = ("vehicles" in res ? res.vehicles : undefined) ?? [];
  const error = ("error" in res ? res.error : undefined) ?? null;

  return (
    <div className="min-h-screen bg-paper">
      <div className="max-w-3xl mx-auto px-4 py-6">
        <Link href="/dashboard" className="text-xs text-ink-muted hover:text-ink inline-flex items-center gap-1 mb-3">
          ← Dashboard
        </Link>
        <h1 className="text-xl font-semibold leading-tight mb-1">Vehicles</h1>
        <p className="text-sm text-ink-muted mb-5">
          Saved vehicles used for loading. Add, edit, deactivate, or remove unused ones.
        </p>
        {error ? (
          <div className="bg-danger-soft border border-danger/30 rounded-md p-4 text-sm">{error}</div>
        ) : (
          <VehiclesClient initialVehicles={vehicles} />
        )}
      </div>
    </div>
  );
}
