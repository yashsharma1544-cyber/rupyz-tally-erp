// =============================================================================
// /out-for-delivery/dispatch/[id] — printable load list for one dispatch
//
// Opens in a new tab after Create Dispatch, or via the "load list" link from
// the main /out-for-delivery row. Driver gets this printout to carry on the
// vehicle; checkboxes beside each invoice for a physical sign-off.
// =============================================================================

import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { DispatchActions, PrintButton } from "./dispatch-actions-client";
import { VehicleLoadsClient, type LoadRow } from "./loads-client";

export const dynamic = "force-dynamic";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
}
function fmtDateShort(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "2-digit", timeZone: "UTC",
  });
}
function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}
function fmtMoney(n: number): string {
  return "₹" + (Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}
function fmtKg(n: number): string {
  return (Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 1 });
}

export default async function DispatchLoadListPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { confirm?: string };
}) {
  // ?confirm=load lands here right after Create Dispatch — the top-of-page
  // banner nudges the user to confirm the loaded quantities before printing.
  const confirmMode = searchParams.confirm === "load";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?from=/out-for-delivery/dispatch/${params.id}`);
  const { data: me } = await supabase
    .from("app_users").select("role, active").eq("id", user.id).single();
  if (!me?.active || me.role !== "admin") redirect("/");

  const admin = createAdminClient();

  const { data: dispatch } = await admin
    .from("tally_dispatches")
    .select("id, dispatch_no, dispatch_date, vehicle_number, driver_name, helper1_name, helper2_name, notes, created_at, created_by_name, completed_at, invoice_count, total_amount, total_kg")
    .eq("id", params.id)
    .maybeSingle();
  if (!dispatch) notFound();

  // Prefer helpers; fall back to legacy driver_name for dispatches created
  // before the helper columns existed.
  const helperDisplay = (() => {
    const h1 = (dispatch.helper1_name as string | null) ?? (dispatch.driver_name as string | null);
    const h2 = (dispatch.helper2_name as string | null);
    if (h1 && h2) return `${h1}, ${h2}`;
    return h1 ?? h2 ?? "—";
  })();

  const { data: invRows } = await admin
    .from("tally_invoices")
    .select("id, voucher_no, voucher_date, party_name, party_group, inferred_beat, total_amount, delivered_at")
    .eq("dispatch_id", params.id)
    .order("inferred_beat", { ascending: true })
    .order("voucher_date", { ascending: true });
  const invoices = invRows ?? [];
  const invoiceIds = invoices.map((r) => r.id as string);

  // Line kg per invoice
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

  // Group by beat
  const beatOrder: string[] = [];
  const byBeat = new Map<string, typeof invoices>();
  for (const r of invoices) {
    const beat = (r.inferred_beat as string) ?? "Unassigned";
    if (!byBeat.has(beat)) { byBeat.set(beat, []); beatOrder.push(beat); }
    byBeat.get(beat)!.push(r);
  }

  // Vehicle loads (optional — may be empty if migration hasn't been run)
  const { data: loadRows } = await admin
    .from("v_dispatch_item_summary")
    .select("*")
    .eq("dispatch_id", params.id)
    .order("item_name");
  const loads: LoadRow[] = (loadRows ?? []).map((r) => ({
    load_id: r.load_id as string,
    item_name: (r.item_name as string) ?? "",
    hsn: (r.hsn as string) ?? null,
    loaded_qty: Number(r.loaded_qty) || 0,
    loaded_kg: Number(r.loaded_kg) || 0,
    delivered_qty: Number(r.delivered_qty) || 0,
    delivered_kg: Number(r.delivered_kg) || 0,
    returned_qty: Number(r.returned_qty) || 0,
    returned_kg: Number(r.returned_kg) || 0,
    variance_qty: Number(r.variance_qty) || 0,
    variance_kg: Number(r.variance_kg) || 0,
    returned_at: (r.returned_at as string) ?? null,
  }));

  const totalDelivered = invoices.filter((r) => r.delivered_at != null).length;

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6">
      {/* Toolbar (hidden on print) */}
      <div className="print:hidden flex items-center justify-between mb-4">
        <Link href="/out-for-delivery" className="text-sm text-ink-muted hover:text-accent inline-flex items-center gap-1">
          <ArrowLeft size={14} /> Back to Out for Delivery
        </Link>
        <div className="flex items-center gap-2">
          <DispatchActions dispatchId={params.id} invoiceIds={invoiceIds} />
          <PrintButton />
        </div>
      </div>

      {/* Just-created banner: nudges the user to confirm per-item loaded qty
          on the vehicle before printing. Hidden on print and after the
          first visit (banner is only shown when ?confirm=load is in the URL). */}
      {confirmMode && (
        <div className="print:hidden mb-4 p-4 bg-amber-50 border border-amber-300 rounded-md">
          <div className="flex items-start gap-3">
            <div className="text-xl leading-none">📦</div>
            <div className="flex-1 text-sm">
              <div className="font-semibold text-amber-900 mb-1">Dispatch created — now confirm the vehicle load</div>
              <div className="text-amber-800">
                Below is what&apos;s expected on the vehicle, built from the invoice line items.
                If the physical load differs (short-loaded a case, loaded extra for a top-up),
                click <strong>Edit</strong> on that item and adjust the <em>Loaded qty</em> / <em>Loaded kg</em>.
                Once the numbers match what&apos;s actually on the vehicle, click <strong>Print</strong>.
              </div>
              <a href={`/out-for-delivery/dispatch/${params.id}`}
                className="inline-block mt-2 text-2xs text-amber-900 underline hover:no-underline">
                Dismiss this banner
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Printable area */}
      <div className="bg-paper print:bg-white">
        {/* Letterhead */}
        <div className="border-b-2 border-ink pb-3 mb-4">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold">Anjali Agency</h1>
              <div className="text-xs text-ink-muted">Jalna, Maharashtra · Tea &amp; Edible Oil Wholesale</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-ink-muted uppercase tracking-wide">Delivery Load List</div>
              <div className="font-mono text-lg font-bold">{dispatch.dispatch_no}</div>
            </div>
          </div>
        </div>

        {/* Dispatch summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 text-sm">
          <SummaryCell label="Date" value={fmtDate(dispatch.dispatch_date as string)} />
          <SummaryCell label="Vehicle" value={(dispatch.vehicle_number as string) ?? "—"} />
          <SummaryCell label="Helpers" value={helperDisplay} />
          <SummaryCell label="Prepared by" value={(dispatch.created_by_name as string) ?? "—"} />
          <SummaryCell label="Invoices" value={String(dispatch.invoice_count ?? invoices.length)} />
          <SummaryCell label="Total weight" value={`${fmtKg(Number(dispatch.total_kg) || 0)} kg`} />
          <SummaryCell label="Total value" value={fmtMoney(Number(dispatch.total_amount) || 0)} />
          <SummaryCell label="Status" value={dispatch.completed_at ? `Completed ${fmtDateTime(dispatch.completed_at as string)}` : `${totalDelivered} / ${invoices.length} delivered`} />
        </div>

        {dispatch.notes && (
          <div className="mb-4 p-2.5 bg-paper-subtle/40 border border-paper-line rounded text-sm">
            <div className="text-2xs uppercase tracking-wide text-ink-muted mb-0.5">Notes</div>
            {dispatch.notes as string}
          </div>
        )}

        {/* Vehicle load (loaded / delivered / returned / variance per item) */}
        {loads.length > 0 ? (
          <div
            id="vehicle-load"
            className={`mb-5 break-inside-avoid ${confirmMode ? "ring-2 ring-amber-300 rounded p-2 -m-2 print:ring-0 print:p-0 print:m-0" : ""}`}
          >
            <h3 className="text-sm font-bold border-b border-ink/40 pb-1 mb-2 flex items-center gap-2">
              Vehicle Load <span className="font-normal text-xs text-ink-muted">· {loads.length} items</span>
              {confirmMode && (
                <span className="print:hidden ml-auto text-2xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300">
                  ← Confirm these numbers before printing
                </span>
              )}
            </h3>
            <VehicleLoadsClient loads={loads} />
          </div>
        ) : confirmMode && (
          <div className="print:hidden mb-5 p-3 bg-paper-subtle/40 border border-dashed border-paper-line rounded text-sm text-ink-muted">
            Vehicle Load table isn&apos;t set up yet — run <code className="font-mono text-xs bg-paper px-1 rounded">docs/anjali-vehicle-stock.sql</code> on the ERP Supabase project so you can confirm per-item loaded quantities here.
          </div>
        )}

        {/* Per-beat tables */}
        {beatOrder.map((beat) => {
          const invs = byBeat.get(beat)!;
          const beatKg = invs.reduce((a, r) => a + (kgByInvoice.get(r.id as string) ?? 0), 0);
          const beatValue = invs.reduce((a, r) => a + (Number(r.total_amount) || 0), 0);
          return (
            <div key={beat} className="mb-5 break-inside-avoid">
              <h3 className="text-sm font-bold border-b border-ink/40 pb-1 mb-2">
                {beat} <span className="font-normal text-xs text-ink-muted">· {invs.length} stops · {fmtKg(beatKg)} kg · {fmtMoney(beatValue)}</span>
              </h3>
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-paper-subtle text-left border-b border-paper-line">
                    <th className="px-2 py-1.5 font-semibold w-6">✓</th>
                    <th className="px-2 py-1.5 font-semibold w-24">Date</th>
                    <th className="px-2 py-1.5 font-semibold w-28">Invoice #</th>
                    <th className="px-2 py-1.5 font-semibold">Party</th>
                    <th className="px-2 py-1.5 font-semibold text-right w-16">Kg</th>
                    <th className="px-2 py-1.5 font-semibold text-right w-24">Amount</th>
                    <th className="px-2 py-1.5 font-semibold w-32">Receiver signature</th>
                  </tr>
                </thead>
                <tbody>
                  {invs.map((r) => {
                    const kg = kgByInvoice.get(r.id as string) ?? 0;
                    const delivered = r.delivered_at != null;
                    return (
                      <tr key={r.id as string} className="border-b border-paper-line/70">
                        <td className="px-2 py-1.5 tabular">{delivered ? "✓" : "☐"}</td>
                        <td className="px-2 py-1.5 tabular">{fmtDateShort(r.voucher_date as string)}</td>
                        <td className="px-2 py-1.5 font-mono text-2xs">{(r.voucher_no as string) ?? "—"}</td>
                        <td className="px-2 py-1.5">{(r.party_name as string) ?? ""}</td>
                        <td className="px-2 py-1.5 text-right tabular">{fmtKg(kg)}</td>
                        <td className="px-2 py-1.5 text-right tabular font-medium">{fmtMoney(Number(r.total_amount) || 0)}</td>
                        <td className="px-2 py-1.5"></td>
                      </tr>
                    );
                  })}
                  <tr className="font-semibold bg-paper-subtle/60">
                    <td></td>
                    <td colSpan={3} className="px-2 py-1.5 text-right text-ink-muted">Beat total</td>
                    <td className="px-2 py-1.5 text-right tabular">{fmtKg(beatKg)}</td>
                    <td className="px-2 py-1.5 text-right tabular">{fmtMoney(beatValue)}</td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
            </div>
          );
        })}

        {/* Sign-off */}
        <div className="mt-6 pt-4 border-t-2 border-ink grid grid-cols-2 gap-6 text-xs">
          <div>
            <div className="text-ink-muted mb-6">Vehicle in-charge signature &amp; date</div>
            <div className="border-b border-ink h-10"></div>
          </div>
          <div>
            <div className="text-ink-muted mb-6">Returned to office (received by)</div>
            <div className="border-b border-ink h-10"></div>
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          @page { size: A4; margin: 12mm; }
          nav, aside, header[class*='PageHeader'] { display: none !important; }
          body { background: white; }
        }
      `}</style>
    </div>
  );
}

function SummaryCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-paper-line rounded p-2">
      <div className="text-2xs uppercase tracking-wide text-ink-muted font-medium">{label}</div>
      <div className="text-sm font-semibold mt-0.5">{value}</div>
    </div>
  );
}
