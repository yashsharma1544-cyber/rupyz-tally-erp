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

  // Detect whether this trip has cross-beat bills attached. If so, admin has
  // overridden the beat boundary, and the lead's walk-in tab should show ALL
  // customers (not just same-beat ones) so the lead can find the cross-beat
  // shops they need to visit.
  const { data: extBills } = await supabase
    .from("trip_bills")
    .select("customer:customers(beat_id)")
    .eq("trip_id", tripId)
    .eq("is_cancelled", false);
  const hasCrossBeat = ((extBills ?? []) as Array<{ customer: { beat_id: string | null } | { beat_id: string | null }[] | null }>)
    .some(b => {
      const c = Array.isArray(b.customer) ? b.customer[0] : b.customer;
      return c?.beat_id && c.beat_id !== trip.beat_id;
    });

  // Customer list: same-beat by default (small, fast). When cross-beat bills
  // exist, load all active customers so the lead can search/find the shops.
  let customers;
  if (hasCrossBeat) {
    const res = await supabase
      .from("customers")
      .select("id, name, mobile, city, beat_id")
      .eq("active", true)
      .order("name")
      .limit(2000);
    customers = res.data;
  } else {
    const res = await supabase
      .from("customers")
      .select("id, name, mobile, city, beat_id")
      .eq("active", true)
      .eq("beat_id", trip.beat_id)
      .order("name")
      .limit(500);
    customers = res.data;
  }

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
      crossBeatMode={hasCrossBeat}
    />
  );
}
