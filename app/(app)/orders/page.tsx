import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { OrdersClient } from "./orders-client";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const supabase = await createClient();
  const [{ data: salesmen }, { data: lastSync }] = await Promise.all([
    supabase.from("salesmen").select("id,name").order("name"),
    supabase.from("rupyz_sync_log")
      .select("started_at, status, orders_inserted, orders_updated, error_message")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const lastSyncLabel = lastSync
    ? `Last sync: ${new Date(lastSync.started_at).toLocaleString("en-IN")} · ${lastSync.status}`
    : "No sync yet — see settings";

  return (
    <>
      <PageHeader
        title="Orders"
        subtitle={lastSyncLabel}
        actions={
          <Link href="/settings">
            <Button variant="outline" size="sm">
              <RefreshCw size={13} /> Sync settings
            </Button>
          </Link>
        }
      />
      <OrdersClient salesmen={salesmen ?? []} />
    </>
  );
}
