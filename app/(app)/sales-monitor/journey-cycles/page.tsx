import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { listJourneyCycles } from "@/lib/sales-monitor/journey-cycle";

export const dynamic = "force-dynamic";

export default async function JourneyCyclesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: appUser } = await supabase
    .from("app_users").select("role").eq("id", user.id).single();
  if (!appUser || appUser.role !== "admin") redirect("/");

  const cycles = await listJourneyCycles();
  const today = todayIstString();

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Journey Cycle Planning</h1>
        <Link
          href="/sales-monitor"
          className="text-xs text-ink-muted hover:underline flex items-center gap-1"
        >
          <ArrowLeft size={12} /> Sales Monitor
        </Link>
      </div>
      <p className="text-sm text-ink-muted">
        Plan beats per salesman for each Journey Cycle in advance. Each JC is
        a 28-day period (29 for JC 13) inside the financial year. After the
        plan is set, click <em>Apply to schedule</em> to push it into the
        daily Sales Monitor. Day-specific overrides can still be made in the
        regular daily UI.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {cycles.map((jc) => {
          const status =
            today < jc.start_date ? "Upcoming" :
            today > jc.end_date   ? "Past"     : "Current";
          const cardClasses =
            status === "Current"  ? "border-accent bg-accent/5"
            : status === "Past"   ? "border-paper-line opacity-70"
            :                       "border-paper-line";
          const badgeClasses =
            status === "Current"  ? "bg-accent text-white"
            : status === "Past"   ? "bg-paper-subtle text-ink-muted"
            :                       "bg-paper-subtle text-ink-muted";
          return (
            <Link
              key={jc.id}
              href={`/sales-monitor/journey-cycles/${jc.id}`}
              className={`block border rounded p-3 hover:bg-paper-subtle/40 transition-colors ${cardClasses}`}
            >
              <div className="flex items-center justify-between">
                <div className="text-lg font-semibold">JC {jc.jc_number}</div>
                <span className={`text-2xs uppercase font-medium px-1.5 py-0.5 rounded ${badgeClasses}`}>
                  {status}
                </span>
              </div>
              <div className="text-sm text-ink-muted">
                {fmtDate(jc.start_date)} → {fmtDate(jc.end_date)}
              </div>
              <div className="text-2xs text-ink-subtle mt-1">
                {jc.days_count} days · {jc.fy_label}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function todayIstString(): string {
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  return new Date(Date.now() + istOffsetMs).toISOString().slice(0, 10);
}
