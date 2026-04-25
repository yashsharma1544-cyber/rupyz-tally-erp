"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Plus, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetBody, SheetFooter,
} from "@/components/ui/sheet";
import { createClient } from "@/lib/supabase/client";
import type { Salesman } from "@/lib/types";
import { toast } from "sonner";

export function SalesmenClient() {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Salesman[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Salesman | null>(null);
  const [adding, setAdding] = useState(false);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.from("salesmen").select("*").order("name");
    if (error) toast.error(error.message);
    else setRows(data ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  return (
    <div className="p-6">
      <div className="flex justify-end mb-4">
        <Button onClick={() => setAdding(true)}><Plus size={14} /> Add Salesman</Button>
      </div>
      <div className="bg-paper-card border border-paper-line rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-paper-subtle/60 border-b border-paper-line">
            <tr className="text-left text-2xs uppercase tracking-wide text-ink-muted">
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Phone</th>
              <th className="px-3 py-2 font-medium">Email</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-paper-line">
            {loading ? (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-ink-muted">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-12 text-center text-ink-muted">No salesmen yet.</td></tr>
            ) : rows.map((s) => (
              <tr key={s.id} className="hover:bg-paper-subtle/40">
                <td className="px-3 py-2 font-medium">{s.name}</td>
                <td className="px-3 py-2 tabular text-ink-muted">{s.phone}</td>
                <td className="px-3 py-2 text-ink-muted">{s.email ?? "—"}</td>
                <td className="px-3 py-2">{s.active ? <Badge variant="ok">Active</Badge> : <Badge variant="neutral">Inactive</Badge>}</td>
                <td className="px-3 py-2 text-right">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(s)}><Pencil size={12} /> Edit</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Sheet open={!!editing || adding} onOpenChange={(o) => { if (!o) { setEditing(null); setAdding(false); } }}>
        <SheetContent>
          <SheetHeader><SheetTitle>{adding ? "Add salesman" : "Edit salesman"}</SheetTitle></SheetHeader>
          <SalesmanForm
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

function SalesmanForm({ mode, initial, onSaved, onCancel }: { mode: "create" | "edit"; initial: Salesman | null; onSaved: () => void; onCancel: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    name: initial?.name ?? "",
    phone: initial?.phone ?? "",
    email: initial?.email ?? "",
    active: initial?.active ?? true,
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const payload = {
        name: form.name.trim(),
        phone: form.phone.replace(/\D/g, ""),
        email: form.email.trim() || null,
        active: form.active,
      };
      if (mode === "create") {
        const { error } = await supabase.from("salesmen").insert(payload);
        if (error) { toast.error(error.message); return; }
        toast.success("Salesman added");
      } else {
        const { error } = await supabase.from("salesmen").update(payload).eq("id", initial!.id);
        if (error) { toast.error(error.message); return; }
        toast.success("Salesman updated");
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
          <div><Label className="block mb-1">Phone (12 digits, no + or -)</Label>
            <Input value={form.phone} onChange={(e) => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="91XXXXXXXXXX" className="tabular" required disabled={pending} /></div>
          <div><Label className="block mb-1">Email</Label>
            <Input type="email" value={form.email} onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))} disabled={pending} /></div>
          <div><Label className="block mb-1">Status</Label>
            <div className="flex gap-2">
              <Button type="button" variant={form.active ? "default" : "outline"} size="sm" onClick={() => setForm(f => ({ ...f, active: true }))}>Active</Button>
              <Button type="button" variant={!form.active ? "default" : "outline"} size="sm" onClick={() => setForm(f => ({ ...f, active: false }))}>Inactive</Button>
            </div></div>
        </div>
      </SheetBody>
      <SheetFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>Cancel</Button>
        <Button type="submit" disabled={pending || !form.name.trim() || !form.phone.trim()}>
          {pending ? "Saving…" : mode === "create" ? "Create" : "Save"}
        </Button>
      </SheetFooter>
    </form>
  );
}
