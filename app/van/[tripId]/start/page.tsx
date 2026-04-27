import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TripStart } from "./trip-start";
import type { AppUser, VanTrip, TripLoadItem } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function VanTripStartPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?from=/van/${tripId}/start`);

  const { data: me } = await supabase.from("app_users").select("*").eq("id", user.id).single();
  if (!me) redirect("/login");
  const meTyped = me as AppUser;

  const { data: trip } = await supabase
    .from("van_trips")
    .select("*, beat:beats(id,name), lead:app_users!van_trips_lead_id_fkey(id,full_name)")
    .eq("id", tripId)
    .maybeSingle();
  if (!trip) notFound();

  // If trip is already in_progress, send them to the billing screen
  if (trip.status === "in_progress") {
    redirect(`/van/${tripId}`);
  }

  // If trip is past in_progress, send to read-only desktop view
  if (["returned", "reconciled", "cancelled"].includes(trip.status)) {
    redirect(`/trips/${tripId}`);
  }

  const { data: loadItems } = await supabase
    .from("trip_load_items")
    .select("*, product:products(id,name,unit)")
    .eq("trip_id", tripId)
    .order("created_at");

  return (
    <TripStart
      me={meTyped}
      trip={trip as unknown as VanTrip}
      initialLoadItems={(loadItems ?? []) as unknown as TripLoadItem[]}
    />
  );
}
