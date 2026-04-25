import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { UsersClient } from "./users-client";
import type { AppUser } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await supabase.from("app_users").select("role").eq("id", user.id).single();
  if (!me || me.role !== "admin") redirect("/dashboard");

  const [{ data: users }, { data: salesmen }] = await Promise.all([
    supabase.from("app_users").select("*").order("full_name"),
    supabase.from("salesmen").select("id,name").order("name"),
  ]);

  return (
    <>
      <PageHeader title="Users" subtitle="Invite & manage ERP users" />
      <UsersClient users={(users ?? []) as AppUser[]} salesmen={salesmen ?? []} />
    </>
  );
}
