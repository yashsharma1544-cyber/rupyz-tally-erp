import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getReportRows } from "../../../reports-actions";

export const dynamic = "force-dynamic";

function fmtKg(n: number): string {
  return (Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 1 });
}
function pctClass(p: number | null): string {
  if (p == null) return "text-ink-subtle";
  if (p >= 100) return "text-ok font-semibold";
  if (p >= 50) return "text-warn font-semibold";
  return "text-danger font-semibold";
}

export default async function AreaReportPage({
  params,
  searchParams,
}: {
  params: { areaId: string };
  searchParams: { jc?: string; all?: string };
}) {
  // Admin gate
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: appUser } = await supabase
    .from("app_users").select("role, active").eq("id", user.id).single();
  if (!appUser?.active || appUser.role !== "admin") redirect("/");

  const allJc = searchParams.all === "true";
  const jcId = searchParams.jc ?? null;

  const res = await getReportRows(allJc ? null : jcId, allJc);
  if ("error" in res) {
    return <ErrorPanel message={res.error} />;
  }

  const rows = res.rows.filter((r) => r.area_id === params.areaId);
  if (rows.length === 0) {
    return <ErrorPanel message="No data for this area in the selected JC." />;
  }

  const areaName = rows[0].area_name;
  const beatMap = new Map<string, { beat_id: string; beat_name: string; target: number; ach: number; avg: number; customers: number }>();
  for (const r of rows) {
    let b = beatMap.get(r.beat_id);
    if (!b) {
      b = { beat_id: r.beat_id, beat_name: r.beat_name, target: 0, ach: 0, avg: 0, customers: 0 };
      beatMap.set(r.beat_id, b);
    }
    b.target += r.target_kg;
    b.ach += r.achievement_kg;
    b.avg += r.avg_kg;
    b.customers += 1;
  }
  const beats = Array.from(beatMap.values()).sort((a, b) => b.target - a.target);
  const tot = beats.reduce((a, b) => ({ t: a.t + b.target, a: a.a + b.ach, v: a.v + b.avg }), { t: 0, a: 0, v: 0 });
  const achPct = tot.t > 0 ? (tot.a / tot.t) * 100 : null;

  // JC label
  const admin = createAdminClient();
  let jcLabel = "All Journey Cycles";
  if (!allJc && jcId) {
    const { data: jc } = await admin.from("journey_cycles").select("jc_number, start_date, end_date").eq("id", jcId).maybeSingle();
    if (jc) jcLabel = `JC ${jc.jc_number} (${jc.start_date.slice(5)} → ${jc.end_date.slice(5)})`;
  }

  const childQuery = allJc ? "all=true" : `jc=${jcId ?? ""}`;

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-5">
      {/* Breadcrumb */}
      <div className="text-xs text-ink-muted flex items-center gap-1">
        <Link href={`/sales-monitor?tab=reports`} className="hover:text-accent inline-flex items-center gap-1">
          <ArrowLeft size={12} /> Reports
        </Link>
        <span>/</span>
        <span className="text-ink font-medium">Area: {areaName}</span>
      </div>

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">{areaName}</h1>
        <p className="text-sm text-ink-muted mt-0.5">{jcLabel} · {beats.length} beats</p>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Target" value={`${fmtKg(tot.t)} kg`} sub={`${beats.length} beats`} />
        <Kpi label="Achievement" value={`${fmtKg(tot.a)} kg`} sub={`gap ${fmtKg(Math.max(0, tot.t - tot.a))} kg`} />
        <Kpi label="Achievement %" value={achPct != null ? `${achPct.toFixed(1)}%` : "—"} sub="of target" valueClass={pctClass(achPct)} />
        <Kpi label="Avg / JC" value={`${fmtKg(tot.v)} kg`} />
      </div>

      {/* Beats table */}
      <div className="bg-paper-card border border-paper-line rounded-md overflow-hidden">
        <div className="px-4 py-3 border-b border-paper-line font-semibold text-sm">
          Performance by Beat
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="bg-paper-subtle/60 border-b border-paper-line">
              <tr className="text-left text-2xs uppercase tracking-wide text-ink-muted">
                <th className="px-3 py-2.5 font-medium">Beat</th>
                <th className="px-3 py-2.5 font-medium text-right">Target</th>
                <th className="px-3 py-2.5 font-medium text-right">Achievement</th>
                <th className="px-3 py-2.5 font-medium text-right">Ach %</th>
                <th className="px-3 py-2.5 font-medium text-right">Avg / JC</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-paper-line">
              {beats.map((b) => {
                const p = b.target > 0 ? (b.ach / b.target) * 100 : null;
                return (
                  <tr key={b.beat_id} className="hover:bg-paper-subtle/40">
                    <td className="px-3 py-2.5">
                      <Link
                        href={`/sales-monitor/reports/beat/${b.beat_id}?${childQuery}`}
                        className="font-medium hover:text-accent inline-flex items-center gap-1"
                      >
                        {b.beat_name}
                      </Link>
                      <span className="ml-2 text-2xs text-ink-subtle">{b.customers} customers</span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular">{fmtKg(b.target)}</td>
                    <td className="px-3 py-2.5 text-right tabular">{fmtKg(b.ach)}</td>
                    <td className={`px-3 py-2.5 text-right tabular ${pctClass(p)}`}>{p != null ? p.toFixed(0) + "%" : "—"}</td>
                    <td className="px-3 py-2.5 text-right tabular text-ink-muted">{fmtKg(b.avg)}</td>
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
    <div className="max-w-6xl mx-auto p-4">
      <Link href="/sales-monitor?tab=reports" className="text-xs text-ink-muted hover:underline inline-flex items-center gap-1">
        <ArrowLeft size={12} /> Reports
      </Link>
      <div className="mt-4 bg-paper-card border border-dashed border-paper-line rounded-md p-8 text-center text-sm text-ink-muted">{message}</div>
    </div>
  );
}
