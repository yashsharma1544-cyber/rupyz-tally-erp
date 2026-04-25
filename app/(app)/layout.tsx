import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/layout/sidebar";
import type { AppUser } from "@/lib/types";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: appUser } = await supabase
    .from("app_users")
    .select("*")
    .eq("id", user.id)
    .single();

  if (!appUser || !appUser.active) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-semibold mb-2">Account not provisioned</h1>
          <p className="text-sm text-ink-muted mb-4">
            Your auth account exists but is not linked to an active ERP user.
            Ask the admin to add or activate you in <span className="font-mono">app_users</span>.
          </p>
          <a href="/login" className="text-sm text-accent hover:underline">Return to sign in</a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar user={appUser as AppUser} />
      <main className="flex-1 overflow-x-hidden">{children}</main>
    </div>
  );
}
