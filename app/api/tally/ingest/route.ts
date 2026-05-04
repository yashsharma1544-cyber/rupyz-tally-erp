// =============================================================================
// /api/tally/ingest — endpoint for the local Tally agent to push pulled data.
//
// Auth: agent sends `Authorization: Bearer <secret>` where <secret> matches the
// row in app_settings(key='tally_agent_secret'). Constant-time compare.
//
// Payload shape (chunk 1 — outstanding only):
//   {
//     "type": "outstanding",
//     "ledgers": [
//       {
//         "name": "Mani Enterprises",
//         "guid": "0014c4f6-1234-...",       // optional
//         "parent": "Sundry Debtors",
//         "state": "Madhya Pradesh",
//         "pincode": "457001",
//         "mobile": "9876543210",            // optional, may be null
//         "gstin": "23ABC...",               // optional
//         "raw_balance": -76272.00,           // Tally's signed value
//         "amount": 76272.00                  // positive amount owed
//       },
//       …
//     ],
//     "agent_version": "0.1.0",
//     "started_at": "2026-05-04T08:30:00Z"
//   }
//
// On success:
//   - Each ledger is matched to a customer via name (case-insensitive exact, then
//     fuzzy via similarity if exact fails)
//   - tally_outstanding rows are upserted (unique on ledger_name)
//   - A tally_sync_log row is created with counters
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";          // We need crypto + dependable env access
export const dynamic = "force-dynamic";   // No caching of POSTs (paranoia)

interface OutstandingLedger {
  name: string;
  guid?: string | null;
  parent?: string | null;
  state?: string | null;
  pincode?: string | null;
  mobile?: string | null;
  gstin?: string | null;
  raw_balance: number;
  amount: number;
}

interface IngestPayload {
  type: "outstanding";
  ledgers: OutstandingLedger[];
  agent_version?: string;
  started_at?: string;
}

// ---- Auth helper -----------------------------------------------------------

async function checkAuth(req: NextRequest): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const header = req.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) {
    return { ok: false, status: 401, message: "Missing Authorization header" };
  }
  const presented = header.slice("Bearer ".length).trim();
  if (!presented) return { ok: false, status: 401, message: "Empty token" };

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", "tally_agent_secret")
    .maybeSingle();
  if (!row?.value) {
    return { ok: false, status: 503, message: "Agent secret not configured. Admin should set tally_agent_secret in app_settings." };
  }

  // Constant-time compare to prevent timing attacks
  const expected = row.value;
  if (presented.length !== expected.length) {
    return { ok: false, status: 401, message: "Invalid token" };
  }
  let diff = 0;
  for (let i = 0; i < presented.length; i++) {
    diff |= presented.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  if (diff !== 0) return { ok: false, status: 401, message: "Invalid token" };

  return { ok: true };
}

// ---- Name normalization for matching ---------------------------------------

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.,;()\[\]{}'"`-]/g, " ")  // strip punctuation
    .replace(/\s+/g, " ")                  // collapse whitespace
    .replace(/\b(m\/s|messrs|m s|the)\b/g, "")  // strip common business prefixes
    .trim();
}

// Trigram-style similarity. Returns 0..1.
// Cheap implementation: count overlapping 3-char windows.
function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const trigrams = (s: string) => {
    const padded = `  ${s}  `;
    const set = new Set<string>();
    for (let i = 0; i < padded.length - 2; i++) set.add(padded.slice(i, i + 3));
    return set;
  };
  const A = trigrams(a);
  const B = trigrams(b);
  let intersection = 0;
  for (const t of A) if (B.has(t)) intersection++;
  const union = A.size + B.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ---- POST handler ----------------------------------------------------------

export async function POST(req: NextRequest) {
  const auth = await checkAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let body: IngestPayload;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.type !== "outstanding") {
    return NextResponse.json({ error: `Unsupported type: ${body.type}` }, { status: 400 });
  }
  if (!Array.isArray(body.ledgers)) {
    return NextResponse.json({ error: "ledgers must be an array" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Start log row
  const { data: logRow, error: logErr } = await admin
    .from("tally_sync_log")
    .insert({ status: "running", trigger: "manual" })
    .select("id")
    .single();
  if (logErr || !logRow) {
    return NextResponse.json({ error: `Failed to create log: ${logErr?.message}` }, { status: 500 });
  }
  const logId = logRow.id;

  try {
    // Load all customers with their normalized names for matching
    const { data: customers } = await admin
      .from("customers")
      .select("id, name, mobile, gstin")
      .eq("active", true);
    const customerList = (customers ?? []) as Array<{ id: string; name: string; mobile: string | null; gstin: string | null }>;

    // Pre-normalize for speed
    const normIndex = customerList.map(c => ({ ...c, _norm: normalizeName(c.name ?? "") }));

    // Match + upsert each ledger
    let matched = 0;
    let unmatched = 0;
    const FUZZY_THRESHOLD = 0.65;

    for (const ledger of body.ledgers) {
      let customer_id: string | null = null;
      let match_method = "unmatched";
      let match_score: number | null = null;

      const normLedger = normalizeName(ledger.name);

      // 1. Try mobile (most reliable when present)
      if (ledger.mobile) {
        const cleanMobile = ledger.mobile.replace(/\D/g, "");
        if (cleanMobile.length >= 10) {
          const last10 = cleanMobile.slice(-10);
          const mob = customerList.find(c => c.mobile && c.mobile.replace(/\D/g, "").endsWith(last10));
          if (mob) {
            customer_id = mob.id;
            match_method = "mobile";
          }
        }
      }
      // 2. Try GSTIN
      if (!customer_id && ledger.gstin) {
        const gst = customerList.find(c => c.gstin && c.gstin.toUpperCase() === ledger.gstin!.toUpperCase());
        if (gst) {
          customer_id = gst.id;
          match_method = "gstin";
        }
      }
      // 3. Exact normalized name match
      if (!customer_id) {
        const exact = normIndex.find(c => c._norm && c._norm === normLedger);
        if (exact) {
          customer_id = exact.id;
          match_method = "name_exact";
        }
      }
      // 4. Fuzzy name match (best score above threshold)
      if (!customer_id) {
        let best: { id: string; score: number } | null = null;
        for (const c of normIndex) {
          if (!c._norm) continue;
          const score = similarity(normLedger, c._norm);
          if (score >= FUZZY_THRESHOLD && (!best || score > best.score)) {
            best = { id: c.id, score };
          }
        }
        if (best) {
          customer_id = best.id;
          match_method = "name_fuzzy";
          match_score = best.score;
        }
      }

      // Upsert
      const { error: upsertErr } = await admin
        .from("tally_outstanding")
        .upsert({
          ledger_name: ledger.name,
          ledger_guid: ledger.guid ?? null,
          ledger_parent: ledger.parent ?? null,
          ledger_state: ledger.state ?? null,
          ledger_pincode: ledger.pincode ?? null,
          ledger_mobile: ledger.mobile ?? null,
          ledger_gstin: ledger.gstin ?? null,
          amount: ledger.amount,
          raw_balance: ledger.raw_balance,
          customer_id,
          match_method,
          match_score,
          synced_at: new Date().toISOString(),
        }, { onConflict: "ledger_name" });

      if (upsertErr) {
        // Don't bail — log and continue
        await admin.from("tally_sync_log").update({
          details: { last_error: upsertErr.message, last_ledger: ledger.name },
        }).eq("id", logId);
      }

      if (customer_id) matched++; else unmatched++;
    }

    // Finish log
    await admin.from("tally_sync_log").update({
      finished_at: new Date().toISOString(),
      status: "success",
      outstanding_synced: body.ledgers.length,
      outstanding_matched: matched,
      outstanding_unmatched: unmatched,
      details: { agent_version: body.agent_version ?? null },
    }).eq("id", logId);

    return NextResponse.json({
      ok: true,
      synced: body.ledgers.length,
      matched,
      unmatched,
      log_id: logId,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin.from("tally_sync_log").update({
      finished_at: new Date().toISOString(),
      status: "failed",
      error_message: msg,
    }).eq("id", logId);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Reject other methods cleanly
export async function GET() {
  return NextResponse.json({ error: "POST only" }, { status: 405 });
}
