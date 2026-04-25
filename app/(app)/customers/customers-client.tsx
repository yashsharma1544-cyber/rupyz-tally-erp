"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { Search, Plus, Pencil, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetBody, SheetFooter,
} from "@/components/ui/sheet";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import type { Beat, Customer, Salesman } from "@/lib/types";
import { toast } from "sonner";

const PAGE_SIZE = 50;

export function CustomersClient({
  beats, salesmen,
}: {
  beats: Pick<Beat, "id" | "name">[];
  salesmen: Pick<Salesman, "id" | "name">[];
}) {
  const supabase = useMemo(() => createClient(), []);

  const [rows, setRows] = useState<Customer[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  const [search, setSearch] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");
  const [beatFilter, setBeatFilter] = useState<string>("all");
  const [salesmanFilter, setSalesmanFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [activeFilter, setActiveFilter] = useState<string>("active");

  const [editing, setEditing] = useState<Customer | null>(null);
  const [adding, setAdding] = useState(false);

  // debounce search
  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  // reset to page 0 when filters change
  useEffect(() => {
    setPage(0);
  }, [searchDebounced, beatFilter, salesmanFilter, typeFilter, activeFilter]);

  // single fetch effect — depends on every filter + reloadKey
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      let q = supabase
        .from("customers")
        .select("*, beat:beats(id,name), salesman:salesmen(id,name)", { count: "exact" });
      if (searchDebounced.trim()) q = q.ilike("name", `%${searchDebounced.trim()}%`);
      if (beatFilter !== "all") q = q.eq("beat_id", beatFilter);
      if (salesmanFilter !== "all") {
        if (salesmanFilter === "none") q = q.is("salesman_id", null);
        else q = q.eq("salesman_id", salesmanFilter);
      }
      if (typeFilter !== "all") q = q.eq("customer_type", typeFilter);
      if (activeFilter !== "all") q = q.eq("active", activeFilter === "active");
      q = q.order("name").range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

      const { data, error, count } = await q;
      if (cancelled) return;
      if (error) toast.error(error.message);
      else {
        setRows((data ?? []) as unknown as Customer[]);
        setTotal(count ?? 0);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [supabase, searchDebounced, beatFilter, salesmanFilter, typeFilter, activeFilter, page, reloadKey]);

  const closeAndReload = useCallback(() => {
    setEditing(null);
    setAdding(false);
    setReloadKey((k) => k + 1);
  }, []);

  return (
    <div className="p-6">
      {/* Filter bar */}
      <div className="bg-paper-card border border-paper-line rounded-md p-3 mb-4 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-subtle" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name…" className="pl-8" />
        </div>
        <FilterSelect value={beatFilter} onChange={setBeatFilter} placeholder="Beat" allLabel="All beats"
          options={beats.map(b => ({ value: b.id, label: b.name }))} />
        <FilterSelect value={salesmanFilter} onChange={setSalesmanFilter} placeholder="Salesman" allLabel="All salesmen"
          options={[{ value: "none", label: "Unassigned" }, ...salesmen.map(s => ({ value: s.id, label: s.name }))]} />
        <FilterSelect value={typeFilter} onChange={setTypeFilter} placeholder="Type" allLabel="All types"
          options={[{ value: "Retailer", label: "Retailer" }, { value: "Wholesaler", label: "Wholesaler" }]} />
        <FilterSelect value={activeFilter} onChange={setActiveFilter} placeholder="Status" allLabel="All"
          options={[{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }]} />
        <div className="ml-auto">
          <Button onClick={() => setAdding(true)}><Plus size={14} /> Add Customer</Button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-paper-card border border-paper-line rounded-md overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-paper-subtle/60 border-b border-paper-line">
              <tr className="text-left text-2xs uppercase tracking-wide text-ink-muted">
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Beat</th>
                <th className="px-3 py-2 font-medium">City</th>
                <th className="px-3 py-2 font-medium">Salesman</th>
                <th className="px-3 py-2 font-medium">Mobile</th>
                <th className="px-3 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-paper-line">
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={7} className="px-3 py-3">
                      <div className="h-4 bg-paper-subtle rounded animate-pulse" />
                    </td>
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-12 text-center text-ink-muted">No customers match your filters.</td></tr>
              ) : (
                rows.map((c) => (
                  <tr key={c.id} className="hover:bg-paper-subtle/40 transition-colors">
                    <td className="px-3 py-2">
                      <div className="font-medium">{c.name}</div>
                      {c.rupyz_code && <div className="text-2xs text-ink-subtle font-mono">{c.rupyz_code}</div>}
                    </td>
                    <td className="px-3 py-2">
                      {c.customer_type
                        ? <Badge variant={c.customer_type === "Wholesaler" ? "accent" : "neutral"}>{c.customer_type}</Badge>
                        : <span className="text-ink-subtle">—</span>}
                    </td>
                    <td className="px-3 py-2 text-ink-muted">{c.beat?.name ?? <span className="text-ink-subtle">—</span>}</td>
                    <td className="px-3 py-2 text-ink-muted">{c.city ?? "—"}</td>
                    <td className="px-3 py-2 text-ink-muted">
                      {c.salesman?.name ?? <span className="text-ink-subtle italic">unassigned</span>}
                    </td>
                    <td className="px-3 py-2 tabular text-ink-muted">{c.mobile ?? "—"}</td>
                    <td className="px-3 py-2 text-right">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(c)}><Pencil size={12} /> Edit</Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between px-3 py-2 border-t border-paper-line bg-paper-subtle/40 text-xs">
          <div className="text-ink-muted">
            {loading ? "Loading…" : (
              <>
                Showing <span className="tabular text-ink">{rows.length === 0 ? 0 : page * PAGE_SIZE + 1}–{page * PAGE_SIZE + rows.length}</span> of{" "}
                <span className="tabular text-ink">{total.toLocaleString("en-IN")}</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" disabled={page === 0 || loading} onClick={() => setPage(p => Math.max(0, p - 1))}>Previous</Button>
            <Button variant="outline" size="sm" disabled={(page + 1) * PAGE_SIZE >= total || loading} onClick={() => setPage(p => p + 1)}>Next</Button>
          </div>
        </div>
      </div>

      <Sheet open={!!editing || adding} onOpenChange={(o) => { if (!o) { setEditing(null); setAdding(false); } }}>
        <SheetContent>
          <SheetHeader>
            <div>
              <SheetTitle>{adding ? "Add customer" : "Edit customer"}</SheetTitle>
              <SheetDescription>
                {adding ? "Create a new customer in the master." : editing?.rupyz_code ? `Imported from Rupyz · ${editing.rupyz_code}` : "Manually-added customer"}
              </SheetDescription>
            </div>
          </SheetHeader>
          <CustomerForm
            mode={adding ? "create" : "edit"}
            initial={editing}
            beats={beats}
            salesmen={salesmen}
            onSaved={closeAndReload}
            onCancel={() => { setEditing(null); setAdding(false); }}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}

function FilterSelect({
  value, onChange, placeholder, allLabel, options,
}: {
  value: string; onChange: (v: string) => void; placeholder: string; allLabel: string;
  options: { value: string; label: string }[];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-[160px]"><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{allLabel}</SelectItem>
        {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function CustomerForm({
  mode, initial, beats, salesmen, onSaved, onCancel,
}: {
  mode: "create" | "edit";
  initial: Customer | null;
  beats: Pick<Beat, "id" | "name">[];
  salesmen: Pick<Salesman, "id" | "name">[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    name: initial?.name ?? "",
    customer_type: initial?.customer_type ?? "Retailer",
    customer_level: initial?.customer_level ?? "Secondary Customer",
    mobile: initial?.mobile ?? "",
    address: initial?.address ?? "",
    city: initial?.city ?? "",
    pincode: initial?.pincode ?? "",
    beat_id: initial?.beat_id ?? "",
    salesman_id: initial?.salesman_id ?? "",
    gstin: initial?.gstin ?? "",
    active: initial?.active ?? true,
  });

  function set<K extends keyof typeof form>(k: K, v: typeof form[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        customer_type: form.customer_type || null,
        customer_level: form.customer_level || null,
        mobile: form.mobile.trim() || null,
        address: form.address.trim() || null,
        city: form.city.trim() || null,
        pincode: form.pincode.trim() || null,
        beat_id: form.beat_id || null,
        salesman_id: form.salesman_id || null,
        gstin: form.gstin.trim() || null,
        active: form.active,
      };

      if (mode === "create") {
        const { error } = await supabase.from("customers").insert(payload);
        if (error) return toast.error(error.message);
        toast.success("Customer added");
      } else {
        const { error } = await supabase.from("customers").update(payload).eq("id", initial!.id);
        if (error) return toast.error(error.message);
        toast.success("Customer updated");
      }
      onSaved();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="contents">
      <SheetBody>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Name" required className="col-span-2">
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} required disabled={pending} />
          </Field>

          <Field label="Type">
            <Select value={form.customer_type} onValueChange={(v) => set("customer_type", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Retailer">Retailer</SelectItem>
                <SelectItem value="Wholesaler">Wholesaler</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field label="Level">
            <Select value={form.customer_level} onValueChange={(v) => set("customer_level", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Secondary Customer">Secondary</SelectItem>
                <SelectItem value="Primary Customer">Primary</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field label="Mobile">
            <Input value={form.mobile} onChange={(e) => set("mobile", e.target.value)} placeholder="91XXXXXXXXXX" className="tabular" disabled={pending} />
          </Field>

          <Field label="GSTIN">
            <Input value={form.gstin} onChange={(e) => set("gstin", e.target.value)} placeholder="(filled from Tally)" disabled={pending} />
          </Field>

          <Field label="Address" className="col-span-2">
            <Input value={form.address} onChange={(e) => set("address", e.target.value)} disabled={pending} />
          </Field>

          <Field label="City">
            <Input value={form.city} onChange={(e) => set("city", e.target.value)} disabled={pending} />
          </Field>

          <Field label="Pincode">
            <Input value={form.pincode} onChange={(e) => set("pincode", e.target.value)} className="tabular" disabled={pending} />
          </Field>

          <Field label="Beat">
            <Select value={form.beat_id || "_"} onValueChange={(v) => set("beat_id", v === "_" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="Select beat" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_">— Unassigned —</SelectItem>
                {beats.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Salesman">
            <Select value={form.salesman_id || "_"} onValueChange={(v) => set("salesman_id", v === "_" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="Select salesman" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_">— Unassigned —</SelectItem>
                {salesmen.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Status" className="col-span-2">
            <div className="flex gap-2">
              <Button type="button" variant={form.active ? "default" : "outline"} size="sm" onClick={() => set("active", true)}>Active</Button>
              <Button type="button" variant={!form.active ? "default" : "outline"} size="sm" onClick={() => set("active", false)}>Inactive</Button>
            </div>
          </Field>

          {initial?.latitude != null && initial?.longitude != null && (
            <Field label="Map" className="col-span-2">
              <a
                href={`https://www.google.com/maps?q=${initial.latitude},${initial.longitude}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-accent hover:underline"
              >
                <MapPin size={13} /> View on Google Maps
              </a>
            </Field>
          )}
        </div>
      </SheetBody>
      <SheetFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>Cancel</Button>
        <Button type="submit" disabled={pending || !form.name.trim()}>
          {pending ? "Saving…" : mode === "create" ? "Create" : "Save changes"}
        </Button>
      </SheetFooter>
    </form>
  );
}

function Field({
  label, required, className, children,
}: {
  label: string; required?: boolean; className?: string; children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <Label className="block mb-1">{label}{required && <span className="text-danger ml-0.5">*</span>}</Label>
      {children}
    </div>
  );
}
