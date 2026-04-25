"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Plus, Pencil, Search } from "lucide-react";
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
import type { Brand, Category, Product } from "@/lib/types";
import { formatINR } from "@/lib/utils";
import { toast } from "sonner";

export function ProductsClient({ brands, categories }: { brands: Pick<Brand, "id" | "name">[]; categories: Pick<Category, "id" | "name">[] }) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [brandFilter, setBrandFilter] = useState<string>("all");
  const [editing, setEditing] = useState<Product | null>(null);
  const [adding, setAdding] = useState(false);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("products")
      .select("*, category:categories(id,name), brand:brands(id,name)")
      .order("name");
    if (error) toast.error(error.message);
    else setRows((data ?? []) as unknown as Product[]);
    setLoading(false);
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const filtered = rows.filter((p) => {
    if (brandFilter !== "all" && p.brand_id !== brandFilter) return false;
    if (search.trim() && !p.name.toLowerCase().includes(search.toLowerCase()) && !(p.rupyz_code ?? "").toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="p-6">
      <div className="bg-paper-card border border-paper-line rounded-md p-3 mb-4 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-subtle" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or code…" className="pl-8" />
        </div>
        <Select value={brandFilter} onValueChange={setBrandFilter}>
          <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All brands</SelectItem>
            {brands.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="ml-auto">
          <Button onClick={() => setAdding(true)}><Plus size={14} /> Add Product</Button>
        </div>
      </div>

      <div className="bg-paper-card border border-paper-line rounded-md overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-paper-subtle/60 border-b border-paper-line">
              <tr className="text-left text-2xs uppercase tracking-wide text-ink-muted">
                <th className="px-3 py-2 font-medium">Code</th>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Brand</th>
                <th className="px-3 py-2 font-medium text-right">MRP</th>
                <th className="px-3 py-2 font-medium text-right">Base price</th>
                <th className="px-3 py-2 font-medium">Unit</th>
                <th className="px-3 py-2 font-medium text-right">GST</th>
                <th className="px-3 py-2 font-medium">HSN</th>
                <th className="px-3 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-paper-line">
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}><td colSpan={9} className="px-3 py-3"><div className="h-4 bg-paper-subtle rounded animate-pulse" /></td></tr>
                ))
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="px-3 py-12 text-center text-ink-muted">No products match.</td></tr>
              ) : (
                filtered.map((p) => (
                  <tr key={p.id} className="hover:bg-paper-subtle/40 transition-colors">
                    <td className="px-3 py-2 tabular text-ink-subtle">{p.rupyz_code ?? <Badge variant="warn">manual</Badge>}</td>
                    <td className="px-3 py-2 font-medium">{p.name}</td>
                    <td className="px-3 py-2 text-ink-muted">{p.brand?.name ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular">{formatINR(p.mrp)}</td>
                    <td className="px-3 py-2 text-right tabular">{formatINR(p.base_price)}</td>
                    <td className="px-3 py-2 text-ink-muted">{p.unit}</td>
                    <td className="px-3 py-2 text-right tabular text-ink-muted">{p.gst_percent}%</td>
                    <td className="px-3 py-2 tabular text-ink-muted">{p.hsn_code ?? "—"}</td>
                    <td className="px-3 py-2 text-right">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(p)}><Pencil size={12} /> Edit</Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="px-3 py-2 border-t border-paper-line bg-paper-subtle/40 text-xs text-ink-muted">
          {loading ? "Loading…" : <>Showing <span className="tabular text-ink">{filtered.length}</span> of <span className="tabular text-ink">{rows.length}</span></>}
        </div>
      </div>

      <Sheet open={!!editing || adding} onOpenChange={(o) => { if (!o) { setEditing(null); setAdding(false); } }}>
        <SheetContent>
          <SheetHeader>
            <div>
              <SheetTitle>{adding ? "Add product" : "Edit product"}</SheetTitle>
              <SheetDescription>
                {adding ? "Add a new SKU." : editing?.rupyz_code ? `Imported from Rupyz · ${editing.rupyz_code}` : "Manually-added SKU"}
              </SheetDescription>
            </div>
          </SheetHeader>
          <ProductForm
            mode={adding ? "create" : "edit"}
            initial={editing}
            brands={brands}
            categories={categories}
            onSaved={() => { setEditing(null); setAdding(false); load(); }}
            onCancel={() => { setEditing(null); setAdding(false); }}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ProductForm({
  mode, initial, brands, categories, onSaved, onCancel,
}: {
  mode: "create" | "edit";
  initial: Product | null;
  brands: Pick<Brand, "id" | "name">[];
  categories: Pick<Category, "id" | "name">[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    name: initial?.name ?? "",
    brand_id: initial?.brand_id ?? brands[0]?.id ?? "",
    category_id: initial?.category_id ?? categories[0]?.id ?? "",
    mrp: initial?.mrp?.toString() ?? "",
    base_price: initial?.base_price?.toString() ?? "",
    unit: initial?.unit ?? "Kg",
    gst_percent: initial?.gst_percent?.toString() ?? "5",
    hsn_code: initial?.hsn_code ?? "902",
    active: initial?.active ?? true,
  });
  function set<K extends keyof typeof form>(k: K, v: typeof form[K]) { setForm((f) => ({ ...f, [k]: v })); }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const payload: any = {
        name: form.name.trim(),
        brand_id: form.brand_id || null,
        category_id: form.category_id || null,
        mrp: parseFloat(form.mrp || "0"),
        base_price: parseFloat(form.base_price || "0"),
        unit: form.unit,
        gst_percent: parseFloat(form.gst_percent || "0"),
        hsn_code: form.hsn_code.trim() || null,
        active: form.active,
      };
      if (mode === "create") {
        const { error } = await supabase.from("products").insert(payload);
        if (error) return toast.error(error.message);
        toast.success("Product added");
      } else {
        const { error } = await supabase.from("products").update(payload).eq("id", initial!.id);
        if (error) return toast.error(error.message);
        toast.success("Product updated");
      }
      onSaved();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="contents">
      <SheetBody>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2"><Label className="block mb-1">Name<span className="text-danger ml-0.5">*</span></Label>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} required disabled={pending} /></div>
          <div><Label className="block mb-1">Brand</Label>
            <Select value={form.brand_id} onValueChange={(v) => set("brand_id", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{brands.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
            </Select></div>
          <div><Label className="block mb-1">Category</Label>
            <Select value={form.category_id} onValueChange={(v) => set("category_id", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select></div>
          <div><Label className="block mb-1">MRP (₹)</Label>
            <Input type="number" step="0.01" value={form.mrp} onChange={(e) => set("mrp", e.target.value)} className="tabular" disabled={pending} /></div>
          <div><Label className="block mb-1">Base price (₹)</Label>
            <Input type="number" step="0.01" value={form.base_price} onChange={(e) => set("base_price", e.target.value)} className="tabular" disabled={pending} /></div>
          <div><Label className="block mb-1">Unit</Label>
            <Select value={form.unit} onValueChange={(v) => set("unit", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Kg">Kg</SelectItem>
                <SelectItem value="Packet">Packet</SelectItem>
              </SelectContent>
            </Select></div>
          <div><Label className="block mb-1">GST %</Label>
            <Input type="number" step="0.01" value={form.gst_percent} onChange={(e) => set("gst_percent", e.target.value)} className="tabular" disabled={pending} /></div>
          <div className="col-span-2"><Label className="block mb-1">HSN Code</Label>
            <Input value={form.hsn_code} onChange={(e) => set("hsn_code", e.target.value)} className="tabular" disabled={pending} /></div>
          <div className="col-span-2"><Label className="block mb-1">Status</Label>
            <div className="flex gap-2">
              <Button type="button" variant={form.active ? "default" : "outline"} size="sm" onClick={() => set("active", true)}>Active</Button>
              <Button type="button" variant={!form.active ? "default" : "outline"} size="sm" onClick={() => set("active", false)}>Inactive</Button>
            </div></div>
        </div>
      </SheetBody>
      <SheetFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>Cancel</Button>
        <Button type="submit" disabled={pending || !form.name.trim()}>{pending ? "Saving…" : mode === "create" ? "Create" : "Save changes"}</Button>
      </SheetFooter>
    </form>
  );
}
