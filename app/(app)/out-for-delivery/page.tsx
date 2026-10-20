// =============================================================================
// /out-for-delivery — Anjali Agency OUTSTATION invoices (OCS)
//
// Shows one row per Tally invoice (voucher_type = 'GST INTERCITY SALES').
// Jalna City counter sales (GST SALES, PRIYA SALES) are handled locally and
// excluded from this screen.
//
// Admin flow:
//   1. Filter list by status (pending/dispatched/delivered) and beat
//   2. Select invoices with checkboxes
//   3. Click Create Dispatch → assign vehicle + driver → opens printable load list
//   4. After return, Mark Delivered per invoice (or all at once)
//
// Backing tables (created in docs/anjali-load.sql + docs/anjali-dispatch-schema.sql):
//   tally_invoices, tally_invoice_lines, tally_dispatches
// =============================================================================

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/layout/page-header";
import { OutForDeliveryClient, type InvoiceRow, type VehicleOpt, type DriverOpt } from "./out-for-delivery-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SearchParams = {
  from?: string;
  to?: string;
  party?: string;
  q?: string;
  beat?: string;
  status?: string; // pending | dispatched | delivered | all
};

const OUTSTATION_VOUCHER_TYPE = "GST INTERCITY SALES";

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
            <p className="text-sm text-ink-muted">Out-for-Delivery is admin-only.</p>
          </div>
        </div>
      </>
    );
  }

  const admin = createAdminClient();

  // Probe schema: both anjali-load.sql and anjali-dispatch-schema.sql must have run
  const { error: probeErr } = await admin
    .from("tally_invoices")
    .select("id, inferred_beat, dispatched_at, delivered_at, dispatch_id", { count: "exact", head: true });

  if (probeErr) {
    return (
      <>
        <PageHeader title="Out for Delivery" subtitle="Anjali Agency outstation invoices" />
        <div className="p-6 max-w-3xl mx-auto space-y-4">
          <div className="bg-paper-card border border-paper-line rounded-md p-6">
            <h2 className="text-base font-semibold mb-2">Setup needed</h2>
            <p className="text-sm text-ink-muted mb-3">
              The tally invoice tables aren&apos;t ready yet. Run these two SQL scripts in the Supabase SQL editor:
            </p>
            <ol className="text-sm text-ink-muted list-decimal ml-5 space-y-1">
              <li><code className="font-mono text-xs bg-paper-subtle px-1 rounded">docs/anjali-load.sql</code> — creates tables + loads 1,735 invoices + 5,983 lines</li>
              <li><code className="font-mono text-xs bg-paper-subtle px-1 rounded">docs/anjali-dispatch-schema.sql</code> — adds dispatch/delivery status + beat inference</li>
            </ol>
            <p className="text-2xs text-ink-subtle mt-3">Error: {probeErr.message}</p>
          </div>
        </div>
      </>
    );
  }

  // Filters
  const from = searchParams.from || null;
  const to = searchParams.to || null;
  const party = searchParams.party || null;
  const q = searchParams.q || null;
  const beat = searchParams.beat || null;
  const status = (searchParams.status || "pending") as "pending" | "dispatched" | "delivered" | "all";

  let query = admin
    .from("tally_invoices")
    .select("id, voucher_no, voucher_date, voucher_type, party_name, party_group, total_amount, cgst, sgst, igst, inferred_beat, dispatched_at, delivered_at, dispatch_id")
    .eq("company", "Anjali Agency")
    .eq("voucher_type", OUTSTATION_VOUCHER_TYPE)
    .order("voucher_date", { ascending: false })
    .order("voucher_no", { ascending: false })
    .limit(500);

  if (from) query = query.gte("voucher_date", from);
  if (to) query = query.lte("voucher_date", to);
  if (party) query = query.eq("party_name", party);
  if (q) query = query.or(`party_name.ilike.%${q}%,voucher_no.ilike.%${q}%`);
  if (beat) query = query.eq("inferred_beat", beat);
  if (status === "pending") query = query.is("dispatched_at", null);
  else if (status === "dispatched") query = query.not("dispatched_at", "is", null).is("delivered_at", null);
  else if (status === "delivered") query = query.not("delivered_at", "is", null);

  const { data: invoices } = await query;

  // Line kg totals for selected invoices (one lookup, grouped)
  const invoiceIds = (invoices ?? []).map((r) => r.id as string);
  const kgByInvoice = new Map<string, number>();
  if (invoiceIds.length > 0) {
    const { data: kgRows } = await admin
      .from("tally_invoice_lines")
      .select("invoice_id, qty_kg")
      .in("invoice_id", invoiceIds);
    for (const k of kgRows ?? []) {
      const id = k.invoice_id as string;
      kgByInvoice.set(id, (kgByInvoice.get(id) ?? 0) + (Number(k.qty_kg) || 0));
    }
  }

  const rows: InvoiceRow[] = (invoices ?? []).map((r) => {
    const delivered = r.delivered_at != null;
    const dispatched = r.dispatched_at != null;
    return {
      id: r.id as string,
      voucher_no: (r.voucher_no as string) ?? "",
      voucher_date: r.voucher_date as string,
      voucher_type: (r.voucher_type as string) ?? "",
      party_name: (r.party_name as string) ?? "",
      party_group: (r.party_group as string) ?? null,
      beat: (r.inferred_beat as string) ?? "Unassigned",
      total_amount: Number(r.total_amount) || 0,
      tax: (Number(r.cgst) || 0) + (Number(r.sgst) || 0) + (Number(r.igst) || 0),
      kg: kgByInvoice.get(r.id as string) ?? 0,
      dispatched_at: r.dispatched_at as string | null,
      delivered_at: r.delivered_at as string | null,
      dispatch_id: r.dispatch_id as string | null,
      status: delivered ? "delivered" : dispatched ? "dispatched" : "pending",
    };
  });

  // Status counts (outstation only, unfiltered beyond that)
  const [pendingResult, dispatchedResult, deliveredResult, totalResult] = await Promise.all([
    admin.from("tally_invoices").select("id", { count: "exact", head: true })
      .eq("company", "Anjali Agency").eq("voucher_type", OUTSTATION_VOUCHER_TYPE).is("dispatched_at", null),
    admin.from("tally_invoices").select("id", { count: "exact", head: true })
      .eq("company", "Anjali Agency").eq("voucher_type", OUTSTATION_VOUCHER_TYPE)
      .not("dispatched_at", "is", null).is("delivered_at", null),
    admin.from("tally_invoices").select("id", { count: "exact", head: true })
      .eq("company", "Anjali Agency").eq("voucher_type", OUTSTATION_VOUCHER_TYPE).not("delivered_at", "is", null),
    admin.from("tally_invoices").select("id", { count: "exact", head: true })
      .eq("company", "Anjali Agency").eq("voucher_type", OUTSTATION_VOUCHER_TYPE),
  ]);

  const statusCounts = {
    pending: pendingResult.count ?? 0,
    dispatched: dispatchedResult.count ?? 0,
    delivered: deliveredResult.count ?? 0,
    all: totalResult.count ?? 0,
  };

  // Beat list
  const { data: beatList } = await admin
    .from("tally_invoices")
    .select("inferred_beat")
    .eq("company", "Anjali Agency")
    .eq("voucher_type", OUTSTATION_VOUCHER_TYPE)
    .not("inferred_beat", "is", null);
  const uniqueBeats = Array.from(new Set((beatList ?? []).map((p) => p.inferred_beat as string))).filter(Boolean).sort();

  // Party list (narrowed by beat if active)
  let partyQuery = admin
    .from("tally_invoices")
    .select("party_name")
    .eq("company", "Anjali Agency")
    .eq("voucher_type", OUTSTATION_VOUCHER_TYPE)
    .not("party_name", "is", null);
  if (beat) partyQuery = partyQuery.eq("inferred_beat", beat);
  const { data: partyList } = await partyQuery;
  const uniqueParties = Array.from(new Set((partyList ?? []).map((p) => p.party_name as string))).filter(Boolean).sort();

  // Vehicle + driver options for the Create Dispatch modal
  const [vehicleRes, driverRes] = await Promise.all([
    admin.from("vehicles").select("id, number, make, capacity_kg").eq("active", true).order("number"),
    admin.from("app_users").select("id, full_name, role").eq("active", true).in("role", ["driver", "van_lead", "dispatch"]).order("full_name"),
  ]);
  const vehicles: VehicleOpt[] = (vehicleRes.data ?? []).map((v) => ({
    id: v.id as string,
    number: (v.number as string) ?? "",
    make: (v.make as string) ?? null,
    capacity_kg: v.capacity_kg as number | null,
  }));
  const drivers: DriverOpt[] = (driverRes.data ?? []).map((d) => ({
    id: d.id as string,
    name: (d.full_name as string) ?? "",
    role: (d.role as string) ?? "",
  }));

  const periodValue = rows.reduce((a, r) => a + r.total_amount, 0);
  const periodKg = rows.reduce((a, r) => a + r.kg, 0);

  return (
    <>
      <PageHeader
        title="Out for Delivery"
        subtitle={`Anjali Agency — outstation invoices (OCS) · Jalna City route excluded`}
      />
      <OutForDeliveryClient
        rows={rows}
        parties={uniqueParties}
        beats={uniqueBeats}
        vehicles={vehicles}
        drivers={drivers}
        filters={{ from, to, party, q, beat, status }}
        statusCounts={statusCounts}
        periodCount={rows.length}
        periodValue={periodValue}
        periodKg={periodKg}
      />
    </>
  );
}
