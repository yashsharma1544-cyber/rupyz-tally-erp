import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Calendar,
  Check,
  AlertCircle,
  Phone,
  MapPin,
  Target,
  Users,
  TrendingUp,
  FileText,
  Download,
} from "lucide-react";
import { getSalesmanDayStatus } from "@/lib/sales-monitor/compute";
import { formatKg, pct, type FocusCustomer } from "@/lib/sales-monitor/format";
import { SendButtons } from "./send-buttons";

export const dynamic = "force-dynamic";

type PageProps = {
  params: { salesmanId: string };
  searchParams: { date?: string };
};

export default async function SalesmanDetailPage({ params, searchParams }: PageProps) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: appUser } = await supabase
    .from("app_users")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!appUser || !["admin", "accounts"].includes(appUser.role)) {
    return (
      <div className="p-8 text-center">
        <h1 className="text-lg font-semibold mb-2">Not authorized</h1>
        <p className="text-sm text-ink-muted">Admin only.</p>
      </div>
    );
  }

  const istNow = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const todayISO = istNow.toISOString().slice(0, 10);
  const date = searchParams.date && /^\d{4}-\d{2}-\d{2}$/.test(searchParams.date)
    ? searchParams.date
    : todayISO;

  const status = await getSalesmanDayStatus(params.salesmanId, date);
  if (!status) notFound();

  const isToday = date === todayISO;
  const callsPct = pct(status.calls_done, status.sc);
  const kgPct    = pct(status.kg_done, status.target_kg);

  const pdfBase = `/api/sales-monitor/pdf`;
  const pdfQuery = `?date=${date}`;
  const pdfLinks = [
    { type: "morning", label: "Morning briefing" },
    { type: "midday",  label: "Mid-day report" },
    { type: "evening", label: "Evening report" },
  ] as const;

  return (
    <div className="max-w-4xl mx-auto p-4 lg:p-6">
      <Link
        href={`/sales-monitor?date=${date}`}
        className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink mb-4"
      >
        <ArrowLeft size={14} /> Sales Monitor
      </Link>

      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold leading-tight">{status.salesman_name}</h1>
          <div className="text-sm text-ink-muted mt-0.5 flex items-center gap-3 flex-wrap">
            <span className="inline-flex items-center gap-1">
              <Calendar size={13} className="text-ink-subtle" /> {date} {isToday && <span className="text-accent">(today)</span>}
            </span>
            {status.salesman_phone && (
              <span className="inline-flex items-center gap-1">
                <Phone size={13} className="text-ink-subtle" /> {status.salesman_phone}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* PDF preview bar */}
      <div className="mb-5 flex items-center gap-2 flex-wrap p-2 border border-paper-line rounded bg-paper-card">
        <span className="text-xs text-ink-subtle px-1.5">PDF preview:</span>
        {pdfLinks.map(({ type, label }) => (
          <div key={type} className="flex items-center">
            <a
              href={`${pdfBase}/${type}/${params.salesmanId}${pdfQuery}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-paper-line rounded-l hover:bg-paper-subtle transition-colors"
            >
              <FileText size={12} className="text-ink-subtle" /> {label}
            </a>
            <a
              href={`${pdfBase}/${type}/${params.salesmanId}${pdfQuery}&download=1`}
              className="inline-flex items-center text-xs px-2 py-1.5 border border-paper-line border-l-0 rounded-r hover:bg-paper-subtle transition-colors"
              title="Download"
            >
              <Download size={12} className="text-ink-subtle" />
            </a>
          </div>
        ))}
      </div>

      {/* Send Now (WhatsApp via WATi) */}
      <SendButtons salesmanId={params.salesmanId} date={date} />

      {!status.has_assignment ? (
        <div className="border border-paper-line rounded p-6 text-center bg-paper-card">
          <AlertCircle size={20} className="text-ink-subtle mx-auto mb-2" />
          <h2 className="font-medium mb-1">No beat assigned for this date</h2>
          <p className="text-sm text-ink-muted">
            Assign a beat on the{" "}
            <Link href={`/sales-monitor?date=${date}`} className="text-accent hover:underline">Sales Monitor page</Link>{" "}
            to enable scheduled-call tracking and focus customers.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
            <BigStat
              icon={<MapPin size={14} />}
              label="Today's beat"
              value={status.beat_name ?? "—"}
              sub={status.beat_city ?? undefined}
            />
            <BigStat
              icon={<Users size={14} />}
              label="Scheduled Calls (SC)"
              value={String(status.sc)}
              sub="customers in this beat"
            />
            <BigStat
              icon={<Target size={14} />}
              label="Target"
              value={status.target_kg != null ? `${formatKg(status.target_kg)} kg` : "Not set"}
              sub={status.target_kg == null ? "Set on Sales Monitor page" : undefined}
              muted={status.target_kg == null}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
            <Progress
              icon={<Users size={14} />}
              label="Calls done"
              done={status.calls_done}
              total={status.sc}
              pct={callsPct}
            />
            <Progress
              icon={<TrendingUp size={14} />}
              label="Sales (kg)"
              done={status.kg_done}
              total={status.target_kg ?? 0}
              pct={kgPct}
              formatNum={formatKg}
              unit="kg"
            />
          </div>

          <div className="border border-paper-line rounded p-3 bg-paper-card mb-5 flex items-center gap-3">
            {status.checked_in_at ? (
              <>
                <div className="h-8 w-8 rounded-full bg-accent-soft text-accent flex items-center justify-center">
                  <Check size={16} />
                </div>
                <div>
                  <div className="text-sm font-medium">Checked in</div>
                  <div className="text-xs text-ink-subtle">at {new Date(status.checked_in_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</div>
                </div>
              </>
            ) : (
              <>
                <div className="h-8 w-8 rounded-full bg-paper-subtle text-ink-subtle flex items-center justify-center">
                  <AlertCircle size={16} />
                </div>
                <div>
                  <div className="text-sm font-medium">Not checked in {isToday ? "yet" : "on this day"}</div>
                  <div className="text-xs text-ink-subtle">Triggered when salesman taps "Checked in" on morning WhatsApp.</div>
                </div>
              </>
            )}
          </div>

          <FocusList
            title="Focus: didn't order on last beat visit"
            subtitle={
              status.last_beat_date
                ? `Last beat day: ${status.last_beat_date}`
                : "First time on this beat — no prior visit to compare"
            }
            customers={status.focus_no_order_last_visit}
            emptyText={
              status.last_beat_date
                ? "Every customer in this beat ordered on the last visit. Nothing to flag."
                : null
            }
          />

          <FocusList
            title="Focus: no order in last 15 days"
            subtitle="Customers on this beat with no order from anyone in the last 15 days"
            customers={status.focus_no_order_in_15_days}
            emptyText="No customers match this filter. All accounts are active."
            showDays
          />
        </>
      )}

      <div className="mt-6 p-3 border border-dashed border-paper-line rounded text-2xs text-ink-subtle leading-relaxed">
        <strong className="text-ink-muted">Phase 4 live.</strong>{" "}
        "Send now" triggers a real WhatsApp delivery via WATi. Once you've confirmed delivery, Phase 5 wires automatic
        sends at 8 AM / 1 PM / 7:30 PM IST.
      </div>
    </div>
  );
}

function BigStat({
  icon, label, value, sub, muted = false,
}: { icon: React.ReactNode; label: string; value: string; sub?: string; muted?: boolean }) {
  return (
    <div className="border border-paper-line rounded p-3 bg-paper-card">
      <div className="text-2xs uppercase tracking-wider text-ink-subtle inline-flex items-center gap-1.5">
        <span className="text-ink-subtle">{icon}</span>
        {label}
      </div>
      <div className={`text-lg font-semibold mt-1 ${muted ? "text-ink-subtle" : ""}`}>{value}</div>
      {sub && <div className="text-2xs text-ink-subtle mt-0.5">{sub}</div>}
    </div>
  );
}

function Progress({
  icon, label, done, total, pct: pctValue, formatNum = (n: number) => n.toLocaleString("en-IN"), unit,
}: {
  icon: React.ReactNode;
  label: string;
  done: number;
  total: number;
  pct: number | null;
  formatNum?: (n: number) => string;
  unit?: string;
}) {
  const pctDisplay = pctValue ?? 0;
  return (
    <div className="border border-paper-line rounded p-3 bg-paper-card">
      <div className="text-2xs uppercase tracking-wider text-ink-subtle inline-flex items-center gap-1.5">
        <span className="text-ink-subtle">{icon}</span>
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-2xl font-semibold tabular-nums">{formatNum(done)}</span>
        {total > 0 && (
          <span className="text-sm text-ink-subtle tabular-nums">
            / {formatNum(total)}{unit ? ` ${unit}` : ""}
          </span>
        )}
      </div>
      {total > 0 && (
        <div className="mt-2">
          <div className="h-1.5 bg-paper-subtle rounded-full overflow-hidden">
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${Math.min(100, pctDisplay)}%` }}
            />
          </div>
          <div className="text-2xs text-ink-subtle mt-1">{pctValue ?? 0}% of target</div>
        </div>
      )}
    </div>
  );
}

function FocusList({
  title, subtitle, customers, emptyText, showDays = false,
}: {
  title: string;
  subtitle: string;
  customers: FocusCustomer[];
  emptyText: string | null;
  showDays?: boolean;
}) {
  return (
    <div className="border border-paper-line rounded bg-paper-card mb-4 overflow-hidden">
      <div className="px-3 py-2.5 border-b border-paper-line bg-paper-subtle/40">
        <div className="font-medium text-sm">{title} <span className="text-ink-subtle font-normal">· {customers.length}</span></div>
        <div className="text-2xs text-ink-subtle mt-0.5">{subtitle}</div>
      </div>
      {customers.length === 0 ? (
        emptyText ? (
          <div className="px-3 py-6 text-center text-sm text-ink-subtle">{emptyText}</div>
        ) : null
      ) : (
        <ul className="divide-y divide-paper-line">
          {customers.map((c) => (
            <li key={c.id} className="px-3 py-2.5 flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{c.name}</div>
                <div className="text-2xs text-ink-subtle mt-0.5 flex items-center gap-2 flex-wrap">
                  {c.mobile && <span>{c.mobile}</span>}
                  {c.city && <span>· {c.city}</span>}
                </div>
              </div>
              {showDays && c.days_since_last_order != null && (
                <div className="text-xs text-amber-600 whitespace-nowrap tabular-nums">
                  {c.days_since_last_order}d ago
                </div>
              )}
              {showDays && c.days_since_last_order == null && (
                <div className="text-xs text-amber-700 whitespace-nowrap">
                  Never ordered
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
