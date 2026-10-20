"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateDispatchLoad } from "../../actions";

export type LoadRow = {
  load_id: string;
  item_name: string;
  hsn: string | null;
  loaded_qty: number;
  loaded_kg: number;
  delivered_qty: number;
  delivered_kg: number;
  returned_qty: number;
  returned_kg: number;
  variance_qty: number;
  variance_kg: number;
  returned_at: string | null;
};

function fmtNum(n: number): string {
  return (Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

export function VehicleLoadsClient({ loads }: { loads: LoadRow[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ loaded_qty: string; loaded_kg: string; returned_qty: string; returned_kg: string }>({ loaded_qty: "", loaded_kg: "", returned_qty: "", returned_kg: "" });
  const [busy, setBusy] = useState<string | null>(null);

  function startEdit(l: LoadRow) {
    setEditing(l.load_id);
    setDraft({
      loaded_qty: String(l.loaded_qty),
      loaded_kg: String(l.loaded_kg),
      returned_qty: String(l.returned_qty),
      returned_kg: String(l.returned_kg),
    });
  }

  async function saveEdit(load_id: string) {
    setBusy(load_id);
    const res = await updateDispatchLoad({
      loadId: load_id,
      loaded_qty: Number(draft.loaded_qty) || 0,
      loaded_kg: Number(draft.loaded_kg) || 0,
      returned_qty: Number(draft.returned_qty) || 0,
      returned_kg: Number(draft.returned_kg) || 0,
    });
    setBusy(null);
    if (!res.ok) { alert(res.error ?? "Failed"); return; }
    setEditing(null);
    router.refresh();
  }

  const totals = loads.reduce(
    (a, l) => ({
      loaded_qty: a.loaded_qty + l.loaded_qty,
      loaded_kg: a.loaded_kg + l.loaded_kg,
      delivered_qty: a.delivered_qty + l.delivered_qty,
      delivered_kg: a.delivered_kg + l.delivered_kg,
      returned_qty: a.returned_qty + l.returned_qty,
      returned_kg: a.returned_kg + l.returned_kg,
      variance_qty: a.variance_qty + l.variance_qty,
      variance_kg: a.variance_kg + l.variance_kg,
    }),
    { loaded_qty: 0, loaded_kg: 0, delivered_qty: 0, delivered_kg: 0, returned_qty: 0, returned_kg: 0, variance_qty: 0, variance_kg: 0 },
  );

  if (loads.length === 0) {
    return <div className="text-sm text-ink-muted">No items on this vehicle yet.</div>;
  }

  return (
    <div className="rounded border border-paper-line overflow-hidden">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-paper-subtle text-left border-b border-paper-line text-2xs uppercase tracking-wide text-ink-muted">
            <th className="px-2 py-1.5 font-semibold">Item</th>
            <th className="px-2 py-1.5 font-semibold text-right w-20">Loaded qty</th>
            <th className="px-2 py-1.5 font-semibold text-right w-20">Loaded kg</th>
            <th className="px-2 py-1.5 font-semibold text-right w-20">Delivered qty</th>
            <th className="px-2 py-1.5 font-semibold text-right w-20">Delivered kg</th>
            <th className="px-2 py-1.5 font-semibold text-right w-24">Returned qty</th>
            <th className="px-2 py-1.5 font-semibold text-right w-24">Returned kg</th>
            <th className="px-2 py-1.5 font-semibold text-right w-20">Variance</th>
            <th className="px-2 py-1.5 w-16 print:hidden"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-paper-line">
          {loads.map((l) => {
            const isEdit = editing === l.load_id;
            const varianceOk = Math.abs(l.variance_qty) < 0.01;
            return (
              <tr key={l.load_id} className={`${!varianceOk && !isEdit ? "bg-amber-50/30" : ""}`}>
                <td className="px-2 py-1.5">{l.item_name}{l.hsn && <span className="ml-2 text-2xs text-ink-subtle font-mono">{l.hsn}</span>}</td>
                <td className="px-2 py-1.5 text-right tabular">
                  {isEdit ? <input type="number" step="0.01" value={draft.loaded_qty} onChange={(e) => setDraft({ ...draft, loaded_qty: e.target.value })} className="w-16 h-6 px-1 rounded border border-paper-line text-xs text-right" /> : fmtNum(l.loaded_qty)}
                </td>
                <td className="px-2 py-1.5 text-right tabular">
                  {isEdit ? <input type="number" step="0.01" value={draft.loaded_kg} onChange={(e) => setDraft({ ...draft, loaded_kg: e.target.value })} className="w-16 h-6 px-1 rounded border border-paper-line text-xs text-right" /> : fmtNum(l.loaded_kg)}
                </td>
                <td className="px-2 py-1.5 text-right tabular text-ink-muted">{fmtNum(l.delivered_qty)}</td>
                <td className="px-2 py-1.5 text-right tabular text-ink-muted">{fmtNum(l.delivered_kg)}</td>
                <td className="px-2 py-1.5 text-right tabular">
                  {isEdit ? <input type="number" step="0.01" value={draft.returned_qty} onChange={(e) => setDraft({ ...draft, returned_qty: e.target.value })} className="w-20 h-6 px-1 rounded border border-paper-line text-xs text-right" /> : fmtNum(l.returned_qty)}
                </td>
                <td className="px-2 py-1.5 text-right tabular">
                  {isEdit ? <input type="number" step="0.01" value={draft.returned_kg} onChange={(e) => setDraft({ ...draft, returned_kg: e.target.value })} className="w-20 h-6 px-1 rounded border border-paper-line text-xs text-right" /> : fmtNum(l.returned_kg)}
                </td>
                <td className={`px-2 py-1.5 text-right tabular font-semibold ${varianceOk ? "text-ink-subtle" : l.variance_qty > 0 ? "text-amber-700" : "text-red-700"}`}>
                  {fmtNum(l.variance_qty)}
                </td>
                <td className="px-2 py-1.5 print:hidden">
                  {isEdit ? (
                    <div className="flex gap-1">
                      <button onClick={() => saveEdit(l.load_id)} disabled={busy === l.load_id} className="h-6 px-2 rounded bg-accent text-white text-2xs disabled:opacity-50">
                        {busy === l.load_id ? "…" : "Save"}
                      </button>
                      <button onClick={() => setEditing(null)} className="h-6 px-2 rounded border border-paper-line text-2xs text-ink-muted">X</button>
                    </div>
                  ) : (
                    <button onClick={() => startEdit(l)} className="h-6 px-2 rounded border border-paper-line text-2xs text-ink-muted hover:bg-paper-subtle">Edit</button>
                  )}
                </td>
              </tr>
            );
          })}
          <tr className="bg-paper-subtle/60 font-semibold border-t-2 border-paper-line">
            <td className="px-2 py-1.5 text-ink-muted uppercase text-2xs tracking-wide">Total</td>
            <td className="px-2 py-1.5 text-right tabular">{fmtNum(totals.loaded_qty)}</td>
            <td className="px-2 py-1.5 text-right tabular">{fmtNum(totals.loaded_kg)}</td>
            <td className="px-2 py-1.5 text-right tabular">{fmtNum(totals.delivered_qty)}</td>
            <td className="px-2 py-1.5 text-right tabular">{fmtNum(totals.delivered_kg)}</td>
            <td className="px-2 py-1.5 text-right tabular">{fmtNum(totals.returned_qty)}</td>
            <td className="px-2 py-1.5 text-right tabular">{fmtNum(totals.returned_kg)}</td>
            <td className={`px-2 py-1.5 text-right tabular ${Math.abs(totals.variance_qty) < 0.01 ? "text-ink-subtle" : totals.variance_qty > 0 ? "text-amber-700" : "text-red-700"}`}>
              {fmtNum(totals.variance_qty)}
            </td>
            <td className="px-2 py-1.5 print:hidden"></td>
          </tr>
        </tbody>
      </table>
      <div className="text-2xs text-ink-subtle px-2 py-1 border-t border-paper-line">
        Variance = Loaded − Delivered − Returned. Positive = unaccounted stock remaining on vehicle; negative = short-loaded or extra deliveries.
      </div>
    </div>
  );
}
