"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function markVisited(customerId: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  // The RLS policy will refuse insert if user_id != auth.uid()
  const { error } = await supabase.from("customer_visits").insert({
    customer_id: customerId,
    user_id: user.id,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/insights/customers/${customerId}`);
  return { ok: true };
}
