import type { Metadata } from "next";
import { LanguageToggle } from "@/components/language-toggle";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/layout/sidebar";
import type { AppUser } from "@/lib/types";

export const metadata: Metadata = {
  title: "Dispatch · Sushil Agencies",
  manifest: "/manifest-dispatch.json",
  applicationName: "Sushil Agencies Dispatch",
  appleWebApp: {
    capable: true,
    title: "Dispatch",
    statusBarStyle: "default",
  },
};

export default async function DispatchLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let appUser: AppUser | null = null;
  if (user) {
    const { data } = await supabase.from("app_users").select("*").eq("id", user.id).single();
    appUser = (data as AppUser) ?? null;
  }

  if (!appUser) {
    return (
      <>
        <div className="fixed top-2 right-2 z-50"><LanguageToggle /></div>
        {children}
      </>
    );
  }

  return (
    <div className="lg:flex min-h-screen">
      <Sidebar user={appUser} />
      <main className="flex-1 min-w-0 overflow-x-hidden">
        <div className="hidden lg:block fixed top-2 right-2 z-50"><LanguageToggle /></div>
        {children}
      </main>
    </div>
  );
}
