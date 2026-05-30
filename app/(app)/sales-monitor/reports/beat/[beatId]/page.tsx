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
    day: "numeric", month: "short", year: "2-digit", timeZone: "UTC",
  });
}
function pctClass(p: number | null): string {
  if (p == null) return "text-ink-subtle";
  if (p >= 100) return "text-ok font-semibold";
  if (p >= 50) return "text-warn font-semibold";
  return "text-danger font-semibold";
}

export default async function BeatReportPage({
  params,
  searchParams,
}: {
  params: { beatId: string };
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

  const customers = res.rows.filter((r) => r.beat_id === params.beatId);
  if (customers.length === 0) return <ErrorPanel message="No data for this beat in the selected JC." />;

  const beatName = customers[0].beat_name;
  const areaName = customers[0].area_name;
  const areaId = customers[0].area_id;
  customers.sort((a, b) => b.target_kg - a.target_kg);

  const tot = customers.reduce(
    (a, c) => ({ t: a.t + c.target_kg, a: a.a + c.achievement_kg, v: a.v + c.avg_kg }),
    { t: 0, a: 0, v: 0 },
  );
  const achPct = tot.t > 0 ? (tot.a / tot.t) * 100 : null;

  const admin = createAdminClient();
  let jcLabel = "All Journey Cycles";
  if (!allJc && jcId) {
    const { data: jc } = await admin.from("journey_cycles").select("jc_number, start_date, end_date").eq("id", jcId).maybeSingle();
    if (jc) jcLabel = `JC ${jc.jc_number} (${jc.start_date.slice(5)} → ${jc.end_date.slice(5)})`;
  }

  const childQuery = allJc ? "all=true" : `jc=${jcId ?? ""}`;

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-5">
      {/* Top nav row: Back button + breadcrumb */}
      <div className="flex items-center gap-3 flex-wrap">
        <BackButton />
        <div className="text-xs text-ink-muted flex items-center gap-1 flex-wrap">
          <Link href="/sales-monitor?tab=reports" className="hover:text-accent">Reports</Link>
          <span>/</span>
          <Link href={`/sales-monitor/reports/area/${areaId}?${childQuery}`} className="hover:text-accent">
            {areaName}
          </Link>
          <span>/</span>
          <span className="text-ink font-medium">{beatName}</span>
        </div>
      </div>

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">{beatName}</h1>
          <p className="text-sm text-ink-muted mt-0.5">{areaName} · {jcLabel} · {customers.length} customers</p>
        </div>
        <DownloadPdfButton
          scope="beat"
          scopeName={beatName}
          parentChain={[areaName]}
          periodLabel={jcLabel}
          totals={{ target: tot.t, achievement: tot.a, avg: tot.v }}
          children={customers.map((c) => ({
            name: c.customer_name,
            target: c.target_kg,
            ach: c.achievement_kg,
            avg: c.avg_kg,
            extra: c.last_order_date ? `${fmtDate(c.last_order_date)}${c.last_order_kg > 0 ? ` (${fmtKg(c.last_order_kg)} kg)` : ""}` : "—",
          }))}
          filenameSlug={`beat-${beatName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40)}`}
        />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Target" value={`${fmtKg(tot.t)} kg`} sub={`${customers.length} customers`} />
        <Kpi label="Achievement" value={`${fmtKg(tot.a)} kg`} sub={`gap ${fmtKg(Math.max(0, tot.t - tot.a))} kg`} />
        <Kpi label="Achievement %" value={achPct != null ? `${achPct.toFixed(1)}%` : "—"} sub="of target" valueClass={pctClass(achPct)} />
        <Kpi label="Avg / JC" value={`${fmtKg(tot.v)} kg`} />
      </div>

      <div className="bg-paper-card border border-paper-line rounded-md overflow-hidden">
        <div className="px-4 py-3 border-b border-paper-line font-semibold text-sm">Customers in this Beat</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-paper-subtle/60 border-b border-paper-line">
              <tr className="text-left text-2xs uppercase tracking-wide text-ink-muted">
                <th className="px-3 py-2.5 font-medium">Customer</th>
                <th className="px-3 py-2.5 font-medium text-right">Target</th>
                <th className="px-3 py-2.5 font-medium text-right">Achievement</th>
                <th className="px-3 py-2.5 font-medium text-right">Ach %</th>
                <th className="px-3 py-2.5 font-medium text-right">Avg / JC</th>
                <th className="px-3 py-2.5 font-medium text-right">Last order</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-paper-line">
              {customers.map((c) => {
                const p = c.target_kg > 0 ? (c.achievement_kg / c.target_kg) * 100 : null;
                return (
                  <tr key={c.customer_id} className="hover:bg-paper-subtle/40">
                    <td className="px-3 py-2.5">
                      <Link
                        href={`/sales-monitor/reports/customer/${c.customer_id}?${childQuery}`}
                        className="font-medium hover:text-accent"
                      >
                        {c.customer_name}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular">{fmtKg(c.target_kg)}</td>
                    <td className="px-3 py-2.5 text-right tabular">{fmtKg(c.achievement_kg)}</td>
                    <td className={`px-3 py-2.5 text-right tabular ${pctClass(p)}`}>{p != null ? p.toFixed(0) + "%" : "—"}</td>
                    <td className="px-3 py-2.5 text-right tabular text-ink-muted">{fmtKg(c.avg_kg)}</td>
                    <td className="px-3 py-2.5 text-right tabular text-ink-subtle whitespace-nowrap">
                      {fmtDate(c.last_order_date)}{c.last_order_kg > 0 ? ` · ${fmtKg(c.last_order_kg)}kg` : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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
function ErrorPanel({ message }: { message: string }) {
  return (
    <div className="max-w-6xl mx-auto p-4 space-y-3">
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
