import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { SyncPanel } from "./sync-panel";
import { OutstandingPanel } from "./outstanding-panel";
import { TokenPanel } from "./token-panel";
import type { RupyzSyncLog } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await supabase.from("app_users").select("role").eq("id", user.id).single();
  if (!me || me.role !== "admin") redirect("/dashboard");

  const [{ data: session }, { data: logs }, { data: outAgg }] = await Promise.all([
    supabase.from("rupyz_session").select("org_id, username, expires_at, last_refreshed_at").maybeSingle(),
    supabase.from("rupyz_sync_log")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(15),
    supabase.from("customer_outstanding").select("amount"),
  ]);

  const totalRows = outAgg?.length ?? 0;
  const totalAmount = (outAgg ?? []).reduce((s, r) => s + Number(r.amount), 0);

  return (
    <>
      <PageHeader title="Settings" subtitle="Integration & system configuration" />
      <div className="p-3 sm:p-6 max-w-4xl space-y-4 sm:space-y-6">
        <TokenPanel
          session={session as { org_id: number; username: string; expires_at: string; last_refreshed_at: string } | null}
        />

        <SyncPanel
          session={session as { org_id: number; username: string; expires_at: string; last_refreshed_at: string } | null}
          logs={(logs ?? []) as RupyzSyncLog[]}
        />

        <OutstandingPanel totalRows={totalRows} totalAmount={totalAmount} />

        <Card title="Tally bridge"  detail="Coming in Phase 5 — local agent registration, manual sync trigger." />
        <Card title="WATi WhatsApp" detail="Coming in Phase 6 — API key, template IDs, sender number." />
      </div>
    </>
  );
}

function Card({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="bg-paper-card border border-paper-line rounded-md p-4">
      <h3 className="font-semibold">{title}</h3>
      <p className="text-sm text-ink-muted mt-1">{detail}</p>
    </div>
  );
}
