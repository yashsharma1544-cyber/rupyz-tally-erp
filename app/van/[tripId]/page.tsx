import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { VanMobileBilling } from "./van-mobile";
import type { AppUser, VanTrip, Customer, Product } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function VanMobilePage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?from=/van/${tripId}`);

  const { data: me } = await supabase.from("app_users").select("*").eq("id", user.id).single();
  if (!me) {
    return <div className="min-h-screen flex items-center justify-center px-4 text-center"><div><h1 className="text-base font-semibold">Account not provisioned</h1><a href="/login" className="text-accent text-sm">Sign in</a></div></div>;
  }
  const meTyped = me as AppUser;

  const { data: trip } = await supabase
    .from("van_trips")
    .select("*, beat:beats(id,name)")
    .eq("id", tripId)
    .maybeSingle();
  if (!trip) notFound();

  // Customers belonging to this beat (and a few extras for ad-hoc)
  const { data: customers } = await supabase
    .from("customers")
    .select("id, name, mobile, city, beat_id")
    .eq("beat_id", trip.beat_id)
    .eq("active", true)
    .order("name")
    .limit(500);

  const { data: products } = await supabase
    .from("products")
    .select("id, name, unit, base_price, mrp, gst_percent")
    .eq("active", true)
    .order("name");

  return (
    <VanMobileBilling
      trip={trip as unknown as VanTrip}
      me={meTyped}
      customers={(customers ?? []) as Pick<Customer, "id" | "name" | "mobile" | "city">[]}
      products={(products ?? []) as Pick<Product, "id" | "name" | "unit" | "base_price" | "mrp" | "gst_percent">[]}
    />
  );
}
