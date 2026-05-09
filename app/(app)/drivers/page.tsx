// =============================================================================
// /drivers — drivers admin page
//
// Lists all users with role=driver. Admin can:
//   • Create driver (reuses existing /users createDriver action)
//   • Reset driver password
//   • View driver's deliveries (link to /trucks?driver=<id>)
// =============================================================================

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { DriversClient } from "./drivers-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface DriverRow {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  active: boolean;
  created_at: string;
  delivered_count: number;
  loading_count: number;
}

export default async function DriversPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?from=/drivers");

  const { data: me } = await supabase.from("app_users").select("role, active").eq("id", user.id).single();
  if (!me?.active || me.role !== "admin") {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <h1 className="text-base font-semibold mb-1">Not authorized</h1>
        <p className="text-sm text-ink-muted">Drivers admin page is for admins only.</p>
      </div>
    );
  }

  // Use admin client for the listing because joining auth metadata + dispatch
  // counts cleanly is much easier with admin privileges.
  const admin = createAdminClient();

  const { data: drivers } = await admin
    .from("app_users")
    .select("id, full_name, email, phone, active, created_at")
    .eq("role", "driver")
    .order("full_name");

  // Counts: delivered + currently loading per driver. One pass each.
  const driverIds = (drivers ?? []).map(d => d.id);
  const counts = new Map<string, { delivered: number; loading: number }>();

  if (driverIds.length > 0) {
    const { data: dispatchRows } = await admin
      .from("dispatches")
      .select("driver_user_id, status")
      .in("driver_user_id", driverIds);

    for (const row of (dispatchRows ?? []) as Array<{ driver_user_id: string; status: string }>) {
      if (!counts.has(row.driver_user_id)) {
        counts.set(row.driver_user_id, { delivered: 0, loading: 0 });
      }
      const c = counts.get(row.driver_user_id)!;
      if (row.status === "delivered") c.delivered += 1;
      else if (row.status === "pending" || row.status === "shipped") c.loading += 1;
    }
  }

  const driverRows: DriverRow[] = (drivers ?? []).map(d => ({
    id: d.id,
    full_name: d.full_name ?? "—",
    email: d.email,
    phone: d.phone,
    active: d.active,
    created_at: d.created_at,
    delivered_count: counts.get(d.id)?.delivered ?? 0,
    loading_count: counts.get(d.id)?.loading ?? 0,
  }));

  return <DriversClient drivers={driverRows} />;
}
