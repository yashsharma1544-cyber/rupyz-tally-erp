import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getReportRows } from "../../../reports-actions";
import { DownloadPdfButton } from "../../_download-button";
import { BackButton } from "../../_back-button";

export const dynamic = "force-dynamic";

function fmtKg(n: number): string {
  return (Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 1 });
}
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
}
function pctClass(p: number | null): string {
  if (p == null) return "text-ink-subtle";
  if (p >= 100) return "text-ok font-semibold";
  if (p >= 50) return "text-warn font-semibold";
  return "text-danger font-semibold";
}

export default async function CustomerReportPage({
  params,
  searchParams,
}: {
  params: { customerId: string };
  searchParams: { jc?: string; all?: string };
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: appUser } = await supabase
    .from("app_users").select("role, active").eq("id", user.id).single();
  if (!appUser?.active || appUser.role !== "admin") redirect("/");

  const allJc = searchParams.all === "true";
  const jcId = searchParams.jc ?? null;

  const res = await getReportRows(allJc ? null : jcId, allJc);
  if ("error" in res) return <ErrorPanel message={res.error} />;

  const c = res.rows.find((r) => r.customer_id === params.customerId);
  if (!c) return <ErrorPanel message="No data for this customer in the selected JC." />;

  const achPct = c.target_kg > 0 ? (c.achievement_kg / c.target_kg) * 100 : null;

  const admin = createAdminClient();
  const { data: cust } = await admin
    .from("customers")
    .select("phone, customer_level, customer_type")
    .eq("id", params.customerId)
    .maybeSingle();

  let jcLabel = "All Journey Cycles";
  if (!allJc && jcId) {
    const { data: jc } = await admin.from("journey_cycles").select("jc_number, start_date, end_date").eq("id", jcId).maybeSingle();
    if (jc) jcLabel = `JC ${jc.jc_number} (${jc.start_date.slice(5)} → ${jc.end_date.slice(5)})`;
  }

  const parentQuery = allJc ? "all=true" : `jc=${jcId ?? ""}`;

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-5">
      {/* Top nav row: Back button + breadcrumb */}
      <div className="flex items-center gap-3 flex-wrap">
        <BackButton />
        <div className="text-xs text-ink-muted flex items-center gap-1 flex-wrap">
          <Link href="/sales-monitor?tab=reports" className="hover:text-accent">Reports</Link>
          <span>/</span>
          <Link href={`/sales-monitor/reports/area/${c.area_id}?${parentQuery}`} className="hover:text-accent">
            {c.area_name}
          </Link>
          <span>/</span>
          <Link href={`/sales-monitor/reports/beat/${c.beat_id}?${parentQuery}`} className="hover:text-accent">
            {c.beat_name}
          </Link>
          <span>/</span>
          <span className="text-ink font-medium">{c.customer_name}</span>
        </div>
      </div>

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">{c.customer_name}</h1>
          <p className="text-sm text-ink-muted mt-0.5">
            {c.beat_name} · {c.area_name} · {jcLabel}
          </p>
          {cust?.phone && (
            <p className="text-sm mt-1">
              <a href={`tel:${cust.phone}`} className="text-accent hover:underline">{cust.phone}</a>
            </p>
          )}
        </div>
        <DownloadPdfButton
          scope="customer"
          scopeName={c.customer_name}
          parentChain={[c.area_name, c.beat_name]}
          periodLabel={jcLabel}
          totals={{ target: c.target_kg, achievement: c.achievement_kg, avg: c.avg_kg }}
          filenameSlug={`customer-${c.customer_name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40)}`}
        />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Target" value={`${fmtKg(c.target_kg)} kg`} />
        <Kpi label="Achievement" value={`${fmtKg(c.achievement_kg)} kg`} sub={c.target_kg > 0 ? `gap ${fmtKg(Math.max(0, c.target_kg - c.achievement_kg))} kg` : undefined} />
        <Kpi label="Achievement %" value={achPct != null ? `${achPct.toFixed(1)}%` : "—"} sub="of target" valueClass={pctClass(achPct)} />
        <Kpi label="Avg / JC" value={`${fmtKg(c.avg_kg)} kg`} />
      </div>

      <div className="bg-paper-card border border-paper-line rounded-md overflow-hidden">
        <div className="px-4 py-3 border-b border-paper-line font-semibold text-sm">Customer Details</div>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-paper-line">
            <Row k="Name" v={c.customer_name} />
            <Row k="Beat" v={c.beat_name} />
            <Row k="Area" v={c.area_name} />
            {cust?.phone && <Row k="Phone" v={cust.phone} />}
            {cust?.customer_level && <Row k="Customer level" v={cust.customer_level} />}
            {cust?.customer_type && <Row k="Customer type" v={cust.customer_type} />}
            <Row k="Last order date" v={fmtDate(c.last_order_date)} />
            <Row k="Last order quantity" v={c.last_order_kg > 0 ? `${fmtKg(c.last_order_kg)} kg` : "—"} />
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, valueClass }: { label: string; value: string; sub?: string; valueClass?: string }) {
  return (
    <div className="bg-paper-card border border-paper-line rounded-md p-3">
      <div className="text-2xs uppercase tracking-wide text-ink-muted font-medium">{label}</div>
      <div className={`text-xl font-bold tabular mt-0.5 ${valueClass ?? "text-ink"}`}>{value}</div>
      {sub && <div className="text-2xs text-ink-subtle mt-0.5">{sub}</div>}
    </div>
  );
}
function Row({ k, v }: { k: string; v: string }) {
  return (
    <tr>
      <td className="px-4 py-2.5 text-ink-muted bg-paper-subtle/30 w-48 font-medium text-xs uppercase tracking-wide">{k}</td>
      <td className="px-4 py-2.5">{v}</td>
    </tr>
  );
}
function ErrorPanel({ message }: { message: string }) {
  return (
    <div className="max-w-4xl mx-auto p-4 space-y-3">
      <div className="flex items-center gap-3">
        <BackButton />
        <Link href="/sales-monitor?tab=reports" className="text-xs text-ink-muted hover:underline inline-flex items-center gap-1">
          <ArrowLeft size={12} /> Reports
        </Link>
      </div>
      <div className="bg-paper-card border border-dashed border-paper-line rounded-md p-8 text-center text-sm text-ink-muted">{message}</div>
    </div>
  );
}
