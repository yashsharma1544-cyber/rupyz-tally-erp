import { NextResponse } from 'next/server';
import { tallyDashboardClient } from '@/lib/supabase/tally-dashboard';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Single proxy for every Sales tab. Keeps the service-role key server-side.
 * Only the functions and views listed below can be reached.
 */
const ALLOWED_RPC = new Set([
  'customers_jc_kg',
  'customers_list',
  'beat_current_jc_weekly',
]);

const ALLOWED_VIEW = new Set(['sales_by_party_jc']);

type Body = {
  rpc?: string;
  args?: Record<string, unknown>;
  view?: string;
  select?: string;
  filters?: { col: string; op: string; val: unknown }[];
  order?: { col: string; asc?: boolean };
  limit?: number;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body must be JSON.' }, { status: 400 });
  }

  try {
    const sb = tallyDashboardClient();

    if (body.rpc) {
      if (!ALLOWED_RPC.has(body.rpc)) {
        return NextResponse.json(
          { error: `Function "${body.rpc}" is not on the allow list.` },
          { status: 400 }
        );
      }
      const { data, error } = await sb.rpc(body.rpc, body.args ?? {});
      if (error) return NextResponse.json({ error: error.message }, { status: 502 });
      return NextResponse.json({ data: data ?? [] });
    }

    if (body.view) {
      if (!ALLOWED_VIEW.has(body.view)) {
        return NextResponse.json(
          { error: `View "${body.view}" is not on the allow list.` },
          { status: 400 }
        );
      }
      let q = sb.from(body.view).select(body.select ?? '*');
      for (const f of body.filters ?? []) q = q.filter(f.col, f.op, f.val as never);
      if (body.order) q = q.order(body.order.col, { ascending: body.order.asc ?? false });
      q = q.limit(Math.min(body.limit ?? 5000, 20000));

      const { data, error } = await q;
      if (error) return NextResponse.json({ error: error.message }, { status: 502 });
      return NextResponse.json({ data: data ?? [] });
    }

    return NextResponse.json(
      { error: 'Send either "rpc" or "view".' },
      { status: 400 }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown server error.';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
