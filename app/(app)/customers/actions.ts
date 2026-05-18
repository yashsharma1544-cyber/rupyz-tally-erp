"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

interface ActorInfo {
  userId: string;
  fullName: string;
  role: string;
}

async function requireRoles(roles: string[]): Promise<ActorInfo> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { data: appUser } = await supabase
    .from("app_users").select("id, full_name, role, active")
    .eq("id", user.id).single();
  if (!appUser?.active) throw new Error("User inactive");
  if (!roles.includes(appUser.role)) throw new Error(`Role "${appUser.role}" not allowed for this action`);
  return { userId: appUser.id, fullName: appUser.full_name, role: appUser.role };
}

// =============================================================================
// UPDATE CUSTOMER BEAT (admin override) — single customer
//
// Stamps beat_overridden_at so the Rupyz sync won't clobber this assignment.
// Pass beatId = null to clear the beat (and the override stamp too — we treat
// "no beat" as not-overridden, so a future sync can populate it).
// =============================================================================
export async function updateCustomerBeat(customerId: string, beatId: string | null) {
  try {
    const actor = await requireRoles(["admin"]);
    const admin = createAdminClient();

    const { data: existing } = await admin
      .from("customers")
      .select("id, name, beat_id")
      .eq("id", customerId)
      .maybeSingle();
    if (!existing) return { error: "Customer not found" };

    if (beatId) {
      // Validate beat exists
      const { data: beat } = await admin.from("beats").select("id, name").eq("id", beatId).maybeSingle();
      if (!beat) return { error: "Beat not found" };
    }

    const { error } = await admin.from("customers").update({
      beat_id: beatId,
      beat_overridden_at: beatId ? new Date().toISOString() : null,
    }).eq("id", customerId);
    if (error) return { error: error.message };

    void actor;
    revalidatePath("/customers");
    revalidatePath("/orders");
    return { ok: true };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// =============================================================================
// BULK ASSIGN BEAT — many customers at once
//
// Used by the multi-select action bar on /customers. Same stamping behavior
// as updateCustomerBeat: sets beat_overridden_at when a beat is assigned,
// clears it when beat is cleared. Returns the count actually updated.
// =============================================================================
export async function bulkAssignBeat(
  customerIds: string[],
  beatId: string | null,
): Promise<{ ok: true; updated: number } | { error: string }> {
  try {
    await requireRoles(["admin"]);
    if (!Array.isArray(customerIds) || customerIds.length === 0) {
      return { error: "No customers selected" };
    }

    const admin = createAdminClient();

    if (beatId) {
      const { data: beat } = await admin.from("beats").select("id").eq("id", beatId).maybeSingle();
      if (!beat) return { error: "Beat not found" };
    }

    const { data, error } = await admin
      .from("customers")
      .update({
        beat_id: beatId,
        beat_overridden_at: beatId ? new Date().toISOString() : null,
      })
      .in("id", customerIds)
      .select("id");

    if (error) return { error: error.message };

    revalidatePath("/customers");
    revalidatePath("/orders");
    return { ok: true, updated: (data ?? []).length };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// =============================================================================
// EXPORT CUSTOMERS AS CSV
//
// Returns a CSV with one row per customer matching the optional filters.
// Columns:
//   customer_id   — UUID, used as the match key on re-import. Don't edit.
//   rupyz_code    — visible Rupyz identifier
//   name          — customer name
//   mobile        — phone
//   city          — city
//   current_beat  — currently assigned beat name (empty if none)
//   new_beat_name — empty column for you to fill before re-uploading
//
// Filters mirror the UI: search, beat, salesman, type, active. Active=null
// means no filter (return both active + inactive).
// =============================================================================
export async function exportCustomersCsv(filters: {
  search?: string;
  beatId?: string | null;        // null = unassigned only; undefined = no filter
  salesmanId?: string | null;    // null = unassigned only; undefined = no filter
  customerType?: string;
  active?: boolean | null;       // null = no filter
}): Promise<{ ok: true; filename: string; csv: string; count: number } | { error: string }> {
  try {
    await requireRoles(["admin"]);
    const admin = createAdminClient();

    let q = admin
      .from("customers")
      .select("id, rupyz_code, name, mobile, city, beat:beats(id, name)")
      .order("name");

    if (filters.search?.trim()) q = q.ilike("name", `%${filters.search.trim()}%`);
    if (filters.beatId === null) q = q.is("beat_id", null);
    else if (filters.beatId) q = q.eq("beat_id", filters.beatId);
    if (filters.salesmanId === null) q = q.is("salesman_id", null);
    else if (filters.salesmanId) q = q.eq("salesman_id", filters.salesmanId);
    if (filters.customerType) q = q.eq("customer_type", filters.customerType);
    if (filters.active === true) q = q.eq("active", true);
    else if (filters.active === false) q = q.eq("active", false);

    const { data, error } = await q;
    if (error) return { error: error.message };

    type Row = {
      id: string;
      rupyz_code: string | null;
      name: string;
      mobile: string | null;
      city: string | null;
      beat: { id: string; name: string } | { id: string; name: string }[] | null;
    };
    const rows = (data ?? []) as Row[];

    const header = [
      "customer_id",
      "rupyz_code",
      "name",
      "mobile",
      "city",
      "current_beat",
      "new_beat_name",
    ];

    const lines = [header.join(",")];
    for (const r of rows) {
      const beat = Array.isArray(r.beat) ? r.beat[0] : r.beat;
      lines.push([
        csvCell(r.id),
        csvCell(r.rupyz_code ?? ""),
        csvCell(r.name ?? ""),
        csvCell(r.mobile ?? ""),
        csvCell(r.city ?? ""),
        csvCell(beat?.name ?? ""),
        "", // new_beat_name — for the user to fill
      ].join(","));
    }

    const today = new Date().toISOString().slice(0, 10);
    return {
      ok: true,
      filename: `customers_for_beat_assignment_${today}.csv`,
      csv: lines.join("\r\n") + "\r\n",
      count: rows.length,
    };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// =============================================================================
// APPLY BEAT ASSIGNMENTS FROM UPLOADED CSV
//
// Parses a CSV produced by exportCustomersCsv (or one with the same columns),
// matches customers by customer_id (UUID), looks up beat by name (case- and
// whitespace-insensitive), updates customers.beat_id with beat_overridden_at
// timestamp. Empty new_beat_name rows are silently skipped. Unrecognized
// beat names are returned as errors.
//
// Returns: { updated, skippedEmpty, skippedNoChange, errors[] }
// =============================================================================
export async function applyBeatAssignmentsCsv(
  csvContent: string,
): Promise<
  | {
      ok: true;
      updated: number;
      skippedEmpty: number;
      skippedNoChange: number;
      errors: { row: number; reason: string; data?: string }[];
    }
  | { error: string }
> {
  try {
    await requireRoles(["admin"]);
    const admin = createAdminClient();

    const parsed = parseCsv(csvContent);
    if (parsed.length === 0) return { error: "CSV is empty or unparseable" };

    const header = parsed[0].map((h) => h.toLowerCase().trim());
    const idIdx = header.indexOf("customer_id");
    const newBeatIdx = header.indexOf("new_beat_name");
    if (idIdx === -1) return { error: 'Missing "customer_id" column' };
    if (newBeatIdx === -1) return { error: 'Missing "new_beat_name" column' };

    // Cache all beats once for name → id resolution (case-insensitive).
    const { data: beats } = await admin.from("beats").select("id, name");
    const beatMap = new Map<string, string>();
    for (const b of beats ?? []) {
      if (b.name) beatMap.set(b.name.trim().toLowerCase(), b.id);
    }

    const errors: { row: number; reason: string; data?: string }[] = [];
    let updated = 0;
    let skippedEmpty = 0;
    let skippedNoChange = 0;

    // Group updates by target beatId so we can do one query per beat (vs N).
    const idsByBeat = new Map<string, string[]>();

    for (let i = 1; i < parsed.length; i++) {
      const cells = parsed[i];
      const customerId = (cells[idIdx] ?? "").trim();
      const newBeatRaw = (cells[newBeatIdx] ?? "").trim();
      const rowNum = i + 1; // 1-indexed + header

      if (!customerId) {
        errors.push({ row: rowNum, reason: "Missing customer_id" });
        continue;
      }
      if (!newBeatRaw) {
        skippedEmpty++;
        continue;
      }

      const beatId = beatMap.get(newBeatRaw.toLowerCase());
      if (!beatId) {
        errors.push({ row: rowNum, reason: `Beat not found: "${newBeatRaw}"`, data: customerId });
        continue;
      }

      if (!idsByBeat.has(beatId)) idsByBeat.set(beatId, []);
      idsByBeat.get(beatId)!.push(customerId);
    }

    // Fetch current beat_id for all candidates so we can skip no-op rows.
    const allCandidateIds = Array.from(new Set(Array.from(idsByBeat.values()).flat()));
    let currentMap = new Map<string, string | null>();
    if (allCandidateIds.length > 0) {
      const { data: currentRows, error: fetchErr } = await admin
        .from("customers")
        .select("id, beat_id")
        .in("id", allCandidateIds);
      if (fetchErr) return { error: `Failed to fetch current beat_ids: ${fetchErr.message}` };
      currentMap = new Map((currentRows ?? []).map((r) => [r.id, r.beat_id ?? null]));
    }

    const stampedAt = new Date().toISOString();
    for (const [beatId, candidateIds] of idsByBeat.entries()) {
      const toUpdate = candidateIds.filter((id) => currentMap.get(id) !== beatId);
      skippedNoChange += candidateIds.length - toUpdate.length;
      if (toUpdate.length === 0) continue;

      const { data, error } = await admin
        .from("customers")
        .update({ beat_id: beatId, beat_overridden_at: stampedAt })
        .in("id", toUpdate)
        .select("id");

      if (error) {
        errors.push({
          row: 0,
          reason: `DB update failed for beat ${beatId}: ${error.message}`,
        });
        continue;
      }
      updated += (data ?? []).length;
    }

    revalidatePath("/customers");
    revalidatePath("/orders");

    return { ok: true, updated, skippedEmpty, skippedNoChange, errors };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// =============================================================================
// CSV helpers
// =============================================================================

/**
 * CSV-quote a cell:
 *  - wrap in double quotes if it contains , or " or \n
 *  - escape internal " as ""
 * Excel-compatible.
 */
function csvCell(v: string): string {
  if (v == null) return "";
  const s = String(v);
  if (s === "") return "";
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Minimal RFC 4180-ish CSV parser. Handles quoted cells, embedded commas,
 * embedded quotes (escaped as ""), and CRLF/LF line endings. Returns a
 * 2D array of strings.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  while (i < len) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\r") {
      // Skip — handled by \n on the next iteration (or end-of-input)
      i++;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      // Skip fully-empty rows that come from a trailing newline.
      if (!(row.length === 1 && row[0] === "")) rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += ch;
    i++;
  }

  // Flush last field/row.
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
  }

  return rows;
}
