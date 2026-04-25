"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Plus, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetBody, SheetFooter } from "@/components/ui/sheet";
import { createClient } from "@/lib/supabase/client";
import type { Beat } from "@/lib/types";
import { toast } from "sonner";

export function BeatsClient() {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<(Beat & { customer_count?: number })[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Beat | null>(null);
  const [adding, setAdding] = useState(false);

  async function load() {
    setLoading(true);
    const { data: beats, error } = await supabase.from("beats").select("*").order("name");
    if (error) { toast.error(error.message); setLoading(false); return; }
    // count customers per beat
    const counts: Record<string, number> = {};
    if (beats?.length) {
      for (const b of beats) {
        const { count } = await supabase.from("customers").select("*", { count: "exact", head: true }).eq("beat_id", b.id);
        counts[b.id] = count ?? 0;
      }
    }
    setRows((beats ?? []).map(b => ({ ...b, customer_count: counts[b.id] ?? 0 })));
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  return (
    <div className="p-6">
      <div className="flex justify-end mb-4">
        <Button onClick={() => setAdding(true)}><Plus size={14} /> Add Beat</Button>
      </div>
      <div className="bg-paper-card border border-paper-line rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-paper-subtle/60 border-b border-paper-line">
            <tr className="text-left text-2xs uppercase tracking-wide text-ink-muted">
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">City</th>
              <th className="px-3 py-2 font-medium">Rupyz Code</th>
              <th className="px-3 py-2 font-medium text-right">Customers</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-paper-line">
            {loading ? (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-ink-muted">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-12 text-center text-ink-muted">No beats yet.</td></tr>
            ) : rows.map((b) => (
              <tr key={b.id} className="hover:bg-paper-subtle/40">
                <td className="px-3 py-2 font-medium">{b.name}</td>
                <td className="px-3 py-2 text-ink-muted">{b.city ?? "—"}</td>
                <td className="px-3 py-2 tabular text-ink-subtle text-xs">{b.rupyz_code ?? <Badge variant="warn">manual</Badge>}</td>
                <td className="px-3 py-2 text-right tabular">{b.customer_count}</td>
                <td className="px-3 py-2">{b.active ? <Badge variant="ok">Active</Badge> : <Badge variant="neutral">Inactive</Badge>}</td>
                <td className="px-3 py-2 text-right"><Button variant="ghost" size="sm" onClick={() => setEditing(b)}><Pencil size={12} /> Edit</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Sheet open={!!editing || adding} onOpenChange={(o) => { if (!o) { setEditing(null); setAdding(false); } }}>
        <SheetContent>
          <SheetHeader><SheetTitle>{adding ? "Add beat" : "Edit beat"}</SheetTitle></SheetHeader>
          <BeatForm
            mode={adding ? "create" : "edit"}
            initial={editing}
            onSaved={() => { setEditing(null); setAdding(false); load(); }}
            onCancel={() => { setEditing(null); setAdding(false); }}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}

function BeatForm({ mode, initial, onSaved, onCancel }: { mode: "create" | "edit"; initial: Beat | null; onSaved: () => void; onCancel: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    name: initial?.name ?? "",
    city: initial?.city ?? "",
    active: initial?.active ?? true,
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const payload = { name: form.name.trim(), city: form.city.trim() || null, active: form.active };
      if (mode === "create") {
        const { error } = await supabase.from("beats").insert(payload);
        if (error) { toast.error(error.message); return; }
        toast.success("Beat added");
      } else {
        const { error } = await supabase.from("beats").update(payload).eq("id", initial!.id);
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
          <div><Label className="block mb-1">Name</Label>
            <Input value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} required disabled={pending} /></div>
          <div><Label className="block mb-1">City</Label>
            <Input value={form.city} onChange={(e) => setForm(f => ({ ...f, city: e.target.value }))} disabled={pending} /></div>
          <div><Label className="block mb-1">Status</Label>
            <div className="flex gap-2">
              <Button type="button" variant={form.active ? "default" : "outline"} size="sm" onClick={() => setForm(f => ({ ...f, active: true }))}>Active</Button>
              <Button type="button" variant={!form.active ? "default" : "outline"} size="sm" onClick={() => setForm(f => ({ ...f, active: false }))}>Inactive</Button>
            </div></div>
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
