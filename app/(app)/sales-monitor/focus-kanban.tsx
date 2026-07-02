import { createAdminClient } from "@/lib/supabase/admin";
import Link from "next/link";

type Cust = {
  id: string;
  name: string | null;
  mobile: string | null;
  beat_id: string | null;
};

type LastOrder = { customer_id: string; last_date: string; last_kg: number };

function daysAgo(iso: string | null): string {
  if (!iso) return "never ordered";
  const then = new Date(iso).getTime();
  const days = Math.floor((Date.now() - then) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  if (days < 60) return "1 month+ ago";
  return `${Math.floor(days / 30)} months ago`;
}

function fmtKg(n: number): string {
  return (Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 1 });
}

/**
 * Focus customers = customers in today's relevant beats who have NOT ordered in
 * the last 30 days. Grouped by beat (one column each).
 *
 * Beat source: today's PJP (beat_journey_plan) when populated; otherwise the
 * beats the salesmen actually worked today (from salesman_daily_activity.beat_list,
 * matched to `beats` by name).
 */
export async function FocusKanban({ viewDate }: { viewDate: string }) {
  const admin = createAdminClient();

  // 1) Determine today's relevant beats.
  // 1a) Try PJP first (jc + jc_day for viewDate).
  const { data: jcRows } = await admin
    .from("journey_cycles")
    .select("id, start_date, end_date")
    .lte("start_date", viewDate)
    .gte("end_date", viewDate)
    .limit(1);
  const jc = jcRows && jcRows[0];

  let beatIds: string[] = [];
  let beatNameById = new Map<string, string>();

  if (jc) {
    // jc_day = (viewDate - start_date) + 1
    const start = new Date((jc.start_date as string) + "T00:00:00Z").getTime();
    const view = new Date(viewDate + "T00:00:00Z").getTime();
    const day = Math.floor((view - start) / 86400000) + 1;

    const { data: pjp } = await admin
      .from("beat_journey_plan")
      .select("beat_id, salesman_id, salesman:salesmen(id, active)")
      .eq("jc_id", jc.id)
      .eq("jc_day", day)
      .not("salesman_id", "is", null);
    const validPjp = (pjp ?? []).filter((r) => {
      const sm = Array.isArray(r.salesman) ? r.salesman[0] : r.salesman;
      return sm && (sm as { active: boolean }).active === true;
    });
    if (validPjp.length > 0) {
      beatIds = Array.from(new Set(validPjp.map((r) => r.beat_id as string).filter(Boolean)));
    }
  }

  // 1b) Fallback: beats worked today (from beat_list names).
  if (beatIds.length === 0) {
    const { data: acts } = await admin
      .from("salesman_daily_activity")
      .select("beat_list")
      .eq("activity_date", viewDate);
    const workedNames = new Set<string>();
    for (const a of acts ?? []) {
      const list = (a.beat_list ?? []) as Array<{ name?: string }>;
      for (const b of list) if (b?.name) workedNames.add(b.name);
    }
    if (workedNames.size > 0) {
      const { data: matched } = await admin
        .from("beats")
        .select("id, name")
        .in("name", Array.from(workedNames));
      for (const b of matched ?? []) {
        beatIds.push(b.id as string);
        beatNameById.set(b.id as string, b.name as string);
      }
    }
  }

  if (beatIds.length === 0) {
    return (
      <div className="bg-paper-card border border-dashed border-paper-line rounded-md p-6 text-center text-sm text-ink-muted">
        No beats planned or worked for this date yet.
      </div>
    );
  }

  // Fill any missing beat names
  if (beatNameById.size < beatIds.length) {
    const { data: bn } = await admin.from("beats").select("id, name").in("id", beatIds);
    for (const b of bn ?? []) beatNameById.set(b.id as string, b.name as string);
  }

  // 2) Customers in those beats.
  const { data: customers } = await admin
    .from("customers")
    .select("id, name, mobile, beat_id")
    .in("beat_id", beatIds)
    .eq("active", true);
  const custList = (customers ?? []) as Cust[];
  if (custList.length === 0) {
    return (
      <div className="bg-paper-card border border-dashed border-paper-line rounded-md p-6 text-center text-sm text-ink-muted">
        No active customers in today&apos;s beats.
      </div>
    );
  }
  const custIds = custList.map((c) => c.id);

  // 3) Last order per customer (date + kg) via unified sales view.
  //    v_sales_line_kg = order_items_kg ∪ tally_sales (via tally_customer_map).
  //    So a customer who bought via Tally within 30 days will correctly be excluded from focus.
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffISO = cutoff.toISOString();

  // Customers who DID have a sale in last 30 days (from either source) — exclude from focus
  const { data: recent } = await admin
    .from("v_sales_line_kg")
    .select("customer_id")
    .in("customer_id", custIds)
    .gte("order_created_at", cutoffISO);
  const orderedRecently = new Set((recent ?? []).map((r) => r.customer_id as string));

  // Last-order date + kg for the remaining (focus) customers, single query
  const focus = custList.filter((c) => !orderedRecently.has(c.id));
  const focusIds = focus.map((c) => c.id);

  const lastByCust = new Map<string, LastOrder>();
  if (focusIds.length > 0) {
    const { data: lines } = await admin
      .from("v_sales_line_kg")
      .select("customer_id, kg, order_created_at")
      .in("customer_id", focusIds)
      .order("order_created_at", { ascending: false });
    for (const line of lines ?? []) {
      const cid = line.customer_id as string;
      const d = (line.order_created_at as string)?.slice(0, 10);
      let cur = lastByCust.get(cid);
      if (!cur) {
        cur = { customer_id: cid, last_date: line.order_created_at as string, last_kg: 0 };
        lastByCust.set(cid, cur);
      }
      // Sum kg only for the customer's most-recent date (subsequent older lines ignored)
      if ((cur.last_date as string).slice(0, 10) === d) {
        cur.last_kg += Number(line.kg) || 0;
      }
    }
  }

  // 4) Group focus customers by beat.
  const byBeat = new Map<string, Cust[]>();
  for (const c of focus) {
    const bid = c.beat_id ?? "none";
    if (!byBeat.has(bid)) byBeat.set(bid, []);
    byBeat.get(bid)!.push(c);
  }

  const columns = beatIds
    .map((bid) => ({ beatId: bid, name: beatNameById.get(bid) ?? "—", custs: byBeat.get(bid) ?? [] }))
    .filter((c) => c.custs.length > 0);

  const totalFocus = focus.length;

  if (columns.length === 0) {
    return (
      <div className="bg-paper-card border border-dashed border-paper-line rounded-md p-6 text-center text-sm text-ink-muted">
        Every customer in today&apos;s beats has ordered within 30 days. Nothing to chase.
      </div>
    );
  }

  return (
    <div>
      <div className="text-2xs text-ink-subtle mb-2">{totalFocus} customers with no order in 30 days</div>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {columns.map((col) => (
          <div key={col.beatId} className="w-72 shrink-0">
            <div className="bg-paper-subtle/60 border border-paper-line rounded-t-md px-3 py-2 flex items-center justify-between">
              <span className="text-sm font-semibold truncate">{col.name}</span>
              <span className="text-2xs text-ink-muted tabular shrink-0 ml-2">{col.custs.length}</span>
            </div>
            <div className="border border-t-0 border-paper-line rounded-b-md divide-y divide-paper-line max-h-[28rem] overflow-y-auto">
              {col.custs.map((c) => {
                const lo = lastByCust.get(c.id);
                return (
                  <div key={c.id} className="px-3 py-2.5 bg-paper-card hover:bg-paper-subtle/40">
                    <Link
                      href={`/sales-monitor/reports/customer/${c.id}?all=true`}
                      className="font-medium text-sm leading-tight hover:text-accent hover:underline block"
                    >
                      {c.name ?? "—"}
                    </Link>
                    <div className="text-2xs text-ink-muted mt-1 flex items-center justify-between gap-2">
                      <span>{daysAgo(lo?.last_date ?? null)}</span>
                      {lo && lo.last_kg > 0 && <span className="tabular">{fmtKg(lo.last_kg)} kg</span>}
                    </div>
                    {c.mobile && (
                      <a href={`tel:${c.mobile}`} className="text-2xs text-accent mt-0.5 inline-block hover:underline">
                        {c.mobile}
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
