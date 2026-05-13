"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowUpRight, ArrowDownRight, Minus, MapPin, Sparkles, RefreshCw, AlertCircle, Plus, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetBody, SheetFooter } from "@/components/ui/sheet";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

interface BeatSummary {
  beat_id: string;
  beat_name: string;
  beat_city: string | null;
  customer_count: number;
  active_30d_count: number;
  sleeping_count: number;
  this_30d_kg: number;
  prev_30d_kg: number;
  growth_pct: number | null;
}

function formatKg(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0 kg";
  return `${n.toLocaleString("en-IN", { maximumFractionDigits: n >= 100 ? 0 : 1 })} kg`;
}

function GrowthBadge({ pct }: { pct: number | null }) {
  if (pct == null) {
    return (
      <span className="inline-flex items-center gap-0.5 text-2xs text-ink-subtle">
        <Minus size={9}/> no baseline
      </span>
    );
  }
  if (Math.abs(pct) < 1) {
    return (
      <span className="inline-flex items-center gap-0.5 text-2xs text-ink-muted">
        <Minus size={9}/> flat
      </span>
    );
  }
  if (pct > 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-2xs text-ok font-semibold tabular">
        <ArrowUpRight size={10}/> +{pct.toFixed(0)}%
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 text-2xs text-danger font-semibold tabular">
      <ArrowDownRight size={10}/> {pct.toFixed(0)}%
    </span>
  );
}

interface Props {
  beats: BeatSummary[];
  isAdmin: boolean;
  canManage: boolean;  // whether to show Edit/Add buttons
}

export function BeatsTableClient({ beats: initialBeats, isAdmin, canManage }: Props) {
  const [lines, setLines] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<BeatSummary | null>(null);
  const [adding, setAdding] = useState(false);

  // AI lines fetch
  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    setLoading(true);
    fetch("/api/ai/insights-beat-lines", { method: "POST" })
      .then(r => r.json())
      .then(d => {
        if (cancelled) return;
        if (!d.ok) {
          setError(d.error || "Failed to load");
          return;
        }
        setLines(d.lines ?? {});
      })
      .catch(e => { if (!cancelled) setError(e?.message ?? "Network error"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isAdmin]);

  return (
    <>
      <div className="mb-2 flex items-center justify-between gap-2">
        {isAdmin ? (
          error ? (
            <span className="inline-flex items-center gap-1 text-2xs text-danger">
              <AlertCircle size={10}/> AI insights failed
            </span>
          ) : loading ? (
            <span className="inline-flex items-center gap-1 text-2xs text-ink-subtle">
              <RefreshCw size={10} className="animate-spin"/> AI loading...
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-2xs text-accent">
              <Sparkles size={10}/> AI insights
            </span>
          )
        ) : <span />}
        {canManage && (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus size={14}/> Add beat
          </Button>
        )}
      </div>
      <div className="bg-paper-card border border-paper-line rounded-md overflow-hidden">
        <div className="overflow-x-auto">
          <table className={`w-full text-sm ${isAdmin ? "min-w-[980px]" : "min-w-[760px]"}`}>
            <thead className="bg-paper-subtle/50 border-b border-paper-line">
              <tr className="text-left text-2xs uppercase tracking-wide text-ink-muted">
                <th className="px-3 py-2 font-medium">Beat</th>
                <th className="px-3 py-2 font-medium">Area</th>
                <th className="px-3 py-2 font-medium text-right">Last 30d (kg)</th>
                <th className="px-3 py-2 font-medium text-right">vs prev</th>
                <th className="px-3 py-2 font-medium text-right">Customers</th>
                <th className="px-3 py-2 font-medium text-right">Active</th>
                <th className="px-3 py-2 font-medium text-right">Sleeping</th>
                {isAdmin && <th className="px-3 py-2 font-medium min-w-[280px]">AI insight</th>}
                {canManage && <th className="px-3 py-2 font-medium text-right">Edit</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-paper-line">
              {initialBeats.map(b => (
                <tr key={b.beat_id} className="hover:bg-paper-subtle/40">
                  <td className="px-3 py-2.5">
                    <Link
                      href={`/beats/${b.beat_id}`}
                      className="font-medium text-accent hover:underline inline-flex items-center gap-1"
                    >
                      <MapPin size={11}/> {b.beat_name}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-ink-muted">
                    {b.beat_city || <span className="text-ink-subtle">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular font-semibold">{formatKg(Number(b.this_30d_kg))}</td>
                  <td className="px-3 py-2.5 text-right"><GrowthBadge pct={b.growth_pct}/></td>
                  <td className="px-3 py-2.5 text-right tabular text-ink-muted">{Number(b.customer_count)}</td>
                  <td className="px-3 py-2.5 text-right tabular text-ok">{Number(b.active_30d_count)}</td>
                  <td className="px-3 py-2.5 text-right tabular">
                    {Number(b.sleeping_count) > 0 ? (
                      <span className="text-warn font-semibold">{Number(b.sleeping_count)}</span>
                    ) : (
                      <span className="text-ink-subtle">0</span>
                    )}
                  </td>
                  {isAdmin && (
                    <td className="px-3 py-2.5 text-xs text-ink leading-relaxed">
                      {lines[b.beat_id] ?? <span className="text-ink-subtle">—</span>}
                    </td>
                  )}
                  {canManage && (
                    <td className="px-3 py-2.5 text-right">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(b)}>
                        <Pencil size={12}/> Edit
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Sheet open={!!editing || adding} onOpenChange={(o) => { if (!o) { setEditing(null); setAdding(false); } }}>
        <SheetContent>
          <SheetHeader><SheetTitle>{adding ? "Add beat" : "Edit beat"}</SheetTitle></SheetHeader>
          <BeatForm
            mode={adding ? "create" : "edit"}
            initial={editing}
            onSaved={() => {
              setEditing(null);
              setAdding(false);
              // Reload the page to pick up new data + regenerated AI lines
              window.location.reload();
            }}
            onCancel={() => { setEditing(null); setAdding(false); }}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}

function BeatForm({
  mode, initial, onSaved, onCancel,
}: {
  mode: "create" | "edit";
  initial: BeatSummary | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    name: initial?.beat_name ?? "",
    city: initial?.beat_city ?? "",
    active: true,
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const payload = {
        name: form.name.trim(),
        city: form.city.trim() || null,
        active: form.active,
      };
      if (mode === "create") {
        const { error } = await supabase.from("beats").insert(payload);
        if (error) { toast.error(error.message); return; }
        toast.success("Beat added");
      } else {
        const { error } = await supabase.from("beats").update(payload).eq("id", initial!.beat_id);
        if (error) { toast.error(error.message); return; }
        toast.success("Beat updated");
      }
      onSaved();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="contents">
      <SheetBody>
        <div className="space-y-4">
          <div>
            <Label className="block mb-1">Name</Label>
            <Input
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              required
              disabled={pending}
            />
          </div>
          <div>
            <Label className="block mb-1">Area</Label>
            <Input
              value={form.city}
              onChange={e => setForm(f => ({ ...f, city: e.target.value }))}
              disabled={pending}
              placeholder="e.g. Jalna East"
            />
          </div>
          <div>
            <Label className="block mb-1">Status</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={form.active ? "default" : "outline"}
                size="sm"
                onClick={() => setForm(f => ({ ...f, active: true }))}
              >
                Active
              </Button>
              <Button
                type="button"
                variant={!form.active ? "default" : "outline"}
                size="sm"
                onClick={() => setForm(f => ({ ...f, active: false }))}
              >
                Inactive
              </Button>
            </div>
          </div>
        </div>
      </SheetBody>
      <SheetFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>Cancel</Button>
        <Button type="submit" disabled={pending || !form.name.trim()}>
          {pending ? "Saving…" : mode === "create" ? "Create" : "Save"}
        </Button>
      </SheetFooter>
    </form>
  );
}
