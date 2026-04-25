import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PODCapture } from "./pod-capture";
import type { Dispatch, AppUser } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function PODPage({ params }: { params: Promise<{ dispatchId: string }> }) {
  const { dispatchId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?from=/pod/${dispatchId}`);

  const [{ data: me }, { data: dispatch }] = await Promise.all([
    supabase.from("app_users").select("*").eq("id", user.id).single(),
    supabase
      .from("dispatches")
      .select("*, order:orders(rupyz_order_id, customer:customers(name, mobile, city), delivery_address_line, delivery_city, delivery_pincode), items:dispatch_items(*, order_item:order_items(product_name, unit)), pod:pods(*)")
      .eq("id", dispatchId)
      .maybeSingle(),
  ]);

  if (!me) return <div className="min-h-screen flex items-center justify-center px-6 text-center"><div><h1 className="text-lg font-semibold mb-2">Account not provisioned</h1><a href="/login" className="text-accent text-sm hover:underline">Sign in</a></div></div>;
  if (!dispatch) return <div className="min-h-screen flex items-center justify-center px-6 text-center"><div><h1 className="text-lg font-semibold">Dispatch not found</h1><p className="text-sm text-ink-muted mt-1">Bad link?</p></div></div>;

  // Normalize pod (Supabase returns array; we want single since pods.dispatch_id is unique)
  const rawPod = (dispatch as unknown as { pod: unknown }).pod;
  const normalizedDispatch = {
    ...dispatch,
    pod: Array.isArray(rawPod) ? rawPod[0] ?? null : rawPod ?? null,
  } as unknown as Dispatch;

  return <PODCapture dispatch={normalizedDispatch} me={me as AppUser} />;
}
