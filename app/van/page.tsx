import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { VanHome } from "./van-home";
import type { AppUser } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function VanHomePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?from=/van`);

  const { data: me } = await supabase.from("app_users").select("*").eq("id", user.id).single();
  if (!me) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 text-center bg-paper">
        <div>
          <h1 className="text-base font-semibold mb-2">Account not provisioned</h1>
          <a href="/login" className="text-accent text-sm">Sign in</a>
        </div>
      </div>
    );
  }

  return <VanHome me={me as AppUser} />;
}
