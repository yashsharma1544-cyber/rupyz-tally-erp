"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, Truck, X, Check, EyeOff, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { createVehicle, updateVehicle, setVehicleActive, deleteVehicle } from "@/app/(app)/dispatches/actions";

interface Vehicle {
  id: string;
  number: string;
  make: string | null;
  capacityKg: number | null;
  active: boolean;
  usageCount: number;
}

export function VehiclesClient({ initialVehicles }: { initialVehicles: Vehicle[] }) {
  const router = useRouter();
  const [vehicles, setVehicles] = useState<Vehicle[]>(initialVehicles);
  const [pending, startTransition] = useTransition();

  // add form
  const [showAdd, setShowAdd] = useState(false);
  const [aNum, setANum] = useState("");
  const [aMake, setAMake] = useState("");
  const [aCap, setACap] = useState("");

  // edit dialog
  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [eNum, setENum] = useState("");
  const [eMake, setEMake] = useState("");
  const [eCap, setECap] = useState("");

  function refresh() { router.refresh(); }

  function handleAdd() {
    if (!aNum.trim()) { toast.error("Vehicle number is required"); return; }
    startTransition(async () => {
      const res = await createVehicle({ number: aNum.trim(), make: aMake.trim() || undefined, capacityKg: aCap.trim() ? Number(aCap) : undefined });
      if ("error" in res && res.error) { toast.error(res.error); return; }
      const v = res.vehicle!;
      setVehicles(prev => {
        if (prev.some(x => x.id === v.id)) return prev;
        return [{ id: v.id, number: v.number, make: v.make ?? null, capacityKg: v.capacity_kg ?? null, active: true, usageCount: 0 }, ...prev];
      });
      setShowAdd(false); setANum(""); setAMake(""); setACap("");
      toast.success(`Vehicle ${v.number} added`);
      refresh();
    });
  }

  function openEdit(v: Vehicle) {
    setEditing(v);
    setENum(v.number);
    setEMake(v.make ?? "");
    setECap(v.capacityKg != null ? String(v.capacityKg) : "");
  }

  function handleSaveEdit() {
    if (!editing) return;
    if (!eNum.trim()) { toast.error("Vehicle number is required"); return; }
    startTransition(async () => {
      const res = await updateVehicle({ id: editing.id, number: eNum.trim(), make: eMake.trim() || undefined, capacityKg: eCap.trim() ? Number(eCap) : null });
      if ("error" in res && res.error) { toast.error(res.error); return; }
      const v = res.vehicle!;
      setVehicles(prev => prev.map(x => x.id === editing.id ? { ...x, number: v.number, make: v.make ?? null, capacityKg: v.capacity_kg ?? null } : x));
      setEditing(null);
      toast.success("Vehicle updated");
      refresh();
    });
  }

  function handleToggleActive(v: Vehicle) {
    startTransition(async () => {
      const res = await setVehicleActive({ id: v.id, active: !v.active });
      if ("error" in res && res.error) { toast.error(res.error); return; }
      setVehicles(prev => prev.map(x => x.id === v.id ? { ...x, active: !v.active } : x));
      toast.success(v.active ? "Vehicle deactivated" : "Vehicle reactivated");
      refresh();
    });
  }

  function handleDelete(v: Vehicle) {
    const msg = v.usageCount > 0
      ? `${v.number} has been used in ${v.usageCount} load${v.usageCount === 1 ? "" : "s"}. It can't be deleted, but it will be deactivated (hidden from loading). Continue?`
      : `Delete ${v.number} permanently? This can't be undone.`;
    if (!confirm(msg)) return;
    startTransition(async () => {
      const res = await deleteVehicle(v.id);
      if ("error" in res && res.error) { toast.error(res.error); return; }
      if ("deleted" in res && res.deleted) {
        setVehicles(prev => prev.filter(x => x.id !== v.id));
        toast.success(`${v.number} deleted`);
      } else {
        setVehicles(prev => prev.map(x => x.id === v.id ? { ...x, active: false } : x));
        toast.success(`${v.number} deactivated (in use, kept for history)`);
      }
      refresh();
    });
  }

  return (
    <div>
      {/* Add */}
      {!showAdd ? (
        <Button onClick={() => setShowAdd(true)} className="mb-4">
          <Plus size={14}/> Add vehicle
        </Button>
      ) : (
        <div className="border border-paper-line rounded-md p-3 bg-paper-subtle/30 space-y-2 mb-4">
          <div className="text-2xs uppercase tracking-wide text-ink-muted">New vehicle</div>
          <Input placeholder="Number e.g. MH-20 AB 1234" value={aNum} onChange={e => setANum(e.target.value)} autoFocus />
          <div className="flex gap-2">
            <Input placeholder="Make (optional)" value={aMake} onChange={e => setAMake(e.target.value)} />
            <Input placeholder="Capacity kg" inputMode="numeric" value={aCap} onChange={e => setACap(e.target.value)} className="w-32" />
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleAdd} disabled={pending}>{pending ? "Adding…" : "Add"}</Button>
            <Button size="sm" variant="outline" onClick={() => { setShowAdd(false); setANum(""); setAMake(""); setACap(""); }}>Cancel</Button>
          </div>
        </div>
      )}

      {/* List */}
      {vehicles.length === 0 ? (
        <div className="bg-paper-card border border-paper-line rounded-md p-6 text-center">
          <Truck size={28} className="mx-auto text-ink-subtle mb-2"/>
          <p className="font-semibold text-sm mb-0.5">No vehicles yet</p>
          <p className="text-xs text-ink-muted">Add your first vehicle above.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {vehicles.map(v => (
            <div key={v.id} className={`border rounded-md p-3 flex items-center gap-3 ${v.active ? "bg-paper-card border-paper-line" : "bg-paper-subtle/40 border-paper-line opacity-70"}`}>
              <div className="w-9 h-9 rounded-full bg-accent-soft text-accent flex items-center justify-center shrink-0">
                <Truck size={15}/>
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm font-mono truncate inline-flex items-center gap-2">
                  {v.number}
                  {!v.active && <span className="text-2xs font-sans font-normal text-ink-subtle border border-paper-line rounded px-1.5 py-0.5">Inactive</span>}
                </div>
                <div className="text-2xs text-ink-muted mt-0.5">
                  {v.make && <>{v.make} · </>}
                  {v.capacityKg != null && <>{v.capacityKg} kg · </>}
                  {v.usageCount > 0 ? `used in ${v.usageCount} load${v.usageCount === 1 ? "" : "s"}` : "never used"}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button type="button" onClick={() => openEdit(v)} disabled={pending} title="Edit" className="p-2 rounded text-ink-muted hover:text-ink hover:bg-paper-subtle">
                  <Pencil size={15}/>
                </button>
                <button type="button" onClick={() => handleToggleActive(v)} disabled={pending} title={v.active ? "Deactivate" : "Reactivate"} className="p-2 rounded text-ink-muted hover:text-ink hover:bg-paper-subtle">
                  {v.active ? <EyeOff size={15}/> : <Eye size={15}/>}
                </button>
                <button type="button" onClick={() => handleDelete(v)} disabled={pending} title="Delete" className="p-2 rounded text-ink-muted hover:text-danger hover:bg-danger-soft">
                  <Trash2 size={15}/>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Edit dialog */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-3" onClick={() => !pending && setEditing(null)}>
          <div className="bg-paper-card border border-paper-line rounded-lg w-full max-w-sm p-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm">Edit vehicle</h3>
              <button type="button" onClick={() => !pending && setEditing(null)} className="text-ink-subtle hover:text-ink"><X size={16}/></button>
            </div>
            <div className="space-y-2">
              <div>
                <Label className="text-xs">Number</Label>
                <Input className="mt-1" value={eNum} onChange={e => setENum(e.target.value)} autoFocus />
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <Label className="text-xs">Make</Label>
                  <Input className="mt-1" value={eMake} onChange={e => setEMake(e.target.value)} placeholder="optional" />
                </div>
                <div className="w-28">
                  <Label className="text-xs">Capacity kg</Label>
                  <Input className="mt-1" inputMode="numeric" value={eCap} onChange={e => setECap(e.target.value)} placeholder="optional" />
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <Button className="flex-1" onClick={handleSaveEdit} disabled={pending}><Check size={14}/> {pending ? "Saving…" : "Save"}</Button>
              <Button variant="outline" onClick={() => setEditing(null)} disabled={pending}>Cancel</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
