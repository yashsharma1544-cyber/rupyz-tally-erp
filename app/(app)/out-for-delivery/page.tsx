// =============================================================================
// /out-for-delivery — Anjali Agency sales invoices from Tally
//
// Reads from public.tally_invoices + public.tally_invoice_lines (seeded via
// the one-shot pg_net loader; see docs/anjali-load.sql). Server component:
// authenticates (admin), fetches with the service-role client, renders a
// filterable list with drill-down to line items.
// =============================================================================

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/layout/page-header";
import { OutForDeliveryClient, type InvoiceRow } from "./out-for-delivery-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SearchParams = {
  from?: string;
  to?: string;
  party?: string;
  q?: string;
};

export default async function OutForDeliveryPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?from=/out-for-delivery");

  const { data: me } = await supabase
    .from("app_users")
    .select("role, active")
    .eq("id", user.id)
    .single();
  if (!me?.active || me.role !== "admin") {
    return (
      <>
        <PageHeader title="Out for Delivery" subtitle="Anjali Agency sales invoices" />
        <div className="p-6 max-w-2xl mx-auto">
          <div className="bg-paper-card border border-paper-line rounded-md p-6">
            <h2 className="text-base font-semibold mb-1">Not authorized</h2>
            <p className="text-sm text-ink-muted">
              Out-for-Delivery is admin-only.
            </p>
          </div>
        </div>
      </>
    );
  }

  const admin = createAdminClient();

  // Check if the backing tables exist — if not, show setup instructions.
  const { error: probeErr } = await admin
    .from("tally_invoices")
    .select("id", { count: "exact", head: true });

  if (probeErr) {
    return (
      <>
        <PageHeader title="Out for Delivery" subtitle="Anjali Agency sales invoices" />
        <div className="p-6 max-w-3xl mx-auto space-y-4">
          <div className="bg-paper-card border border-paper-line rounded-md p-6">
            <h2 className="text-base font-semibold mb-2">Setup needed</h2>
            <p className="text-sm text-ink-muted mb-3">
              The <code className="font-mono text-xs bg-paper-subtle px-1 rounded">tally_invoices</code> table
              does not exist yet in this project. Run the one-shot SQL script at
              {" "}<code className="font-mono text-xs bg-paper-subtle px-1 rounded">docs/anjali-load.sql</code>
              {" "}in your Supabase SQL editor to create the tables and load Anjali Agency FY26-27 invoices
              (1,735 headers · 5,983 lines) from tally-dashboard-v2.
            </p>
            <p className="text-2xs text-ink-subtle">Error: {probeErr.message}</p>
          </div>
        </div>
      </>
    );
  }

  // Build filter query
  const from = searchParams.from || null;
  const to = searchParams.to || null;
  const party = searchParams.party || null;
  const q = searchParams.q || null;

  let query = admin
    .from("tally_invoices")
    .select("id, voucher_no, voucher_date, voucher_type, party_name, party_group, total_amount, cgst, sgst, igst")
    .eq("company", "Anjali Agency")
    .order("voucher_date", { ascending: false })
    .order("voucher_no", { ascending: false })
    .limit(500);

  if (from) query = query.gte("voucher_date", from);
  if (to) query = query.lte("voucher_date", to);
  if (party) query = query.eq("party_name", party);
  if (q) query = query.or(`party_name.ilike.%${q}%,voucher_no.ilike.%${q}%`);

  const { data: invoices } = await query;
  const rows: InvoiceRow[] = (invoices ?? []).map((r) => ({
    id: r.id as string,
    voucher_no: (r.voucher_no as string) ?? "",
    voucher_date: r.voucher_date as string,
    voucher_type: (r.voucher_type as string) ?? "",
    party_name: (r.party_name as string) ?? "",
    party_group: (r.party_group as string) ?? null,
    total_amount: Number(r.total_amount) || 0,
    tax: (Number(r.cgst) || 0) + (Number(r.sgst) || 0) + (Number(r.igst) || 0),
  }));

  // Also compute period totals for KPI strip (unfiltered-by-date headline)
  const { count: totalCount } = await admin
    .from("tally_invoices")
    .select("id", { count: "exact", head: true })
    .eq("company", "Anjali Agency");

  const { data: partyList } = await admin
    .from("tally_invoices")
    .select("party_name")
    .eq("company", "Anjali Agency")
    .not("party_name", "is", null)
    .order("party_name");
  const uniqueParties = Array.from(new Set((partyList ?? []).map((p) => p.party_name as string))).filter(Boolean);

  const periodValue = rows.reduce((a, r) => a + r.total_amount, 0);
  const periodCount = rows.length;

  return (
    <>
      <PageHeader
        title="Out for Delivery"
        subtitle={`Anjali Agency — Tally sales invoices · ${totalCount?.toLocaleString("en-IN") ?? 0} total`}
      />
      <OutForDeliveryClient
        rows={rows}
        parties={uniqueParties}
        filters={{ from, to, party, q }}
        periodCount={periodCount}
        periodValue={periodValue}
        totalCount={totalCount ?? 0}
      />
    </>
  );
}
