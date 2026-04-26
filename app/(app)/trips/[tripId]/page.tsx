import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { TripDetail } from "./trip-detail";
import type { AppUser, VanTrip, Product } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function TripPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase.from("app_users").select("*").eq("id", user.id).single();
  if (!me) redirect("/dashboard");

  const [{ data: trip }, { data: products }] = await Promise.all([
    supabase
      .from("van_trips")
      .select("*, beat:beats(id,name), lead:app_users!van_trips_lead_id_fkey(id,full_name)")
      .eq("id", tripId)
      .maybeSingle(),
    supabase.from("products").select("id, name, unit, base_price, mrp, gst_percent").eq("active", true).order("name"),
  ]);
  if (!trip) notFound();

  return (
    <>
      <PageHeader title={`Trip ${trip.trip_number}`} subtitle={`${trip.beat?.name ?? ""} · ${trip.trip_date}`} />
      <TripDetail
        tripId={tripId}
        initialTrip={trip as unknown as VanTrip}
        me={me as AppUser}
        products={(products ?? []) as Pick<Product, "id" | "name" | "unit" | "base_price" | "mrp" | "gst_percent">[]}
      />
    </>
  );
}
