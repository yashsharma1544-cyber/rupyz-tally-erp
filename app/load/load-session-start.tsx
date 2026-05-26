"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckSquare, Square, Plus, Users, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { startVehicleLoad, createVehicle } from "@/app/(app)/dispatches/actions";

interface VehicleOption { id: string; number: string; make: string | null; capacityKg: number | null; }
interface LoaderOption { id: string; name: string; phone: string | null; }

export function LoadSessionStart({
  vehicles, loaders,
}: {
  vehicles: VehicleOption[];
  loaders: LoaderOption[];
}) {
  const router = useRouter();
  const [vehicleOptions, setVehicleOptions] = useState<VehicleOption[]>(vehicles);
  const [vehicleId, setVehicleId] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [num, setNum] = useState("");
  const [make, setMake] = useState("");
  const [cap, setCap] = useState("");
  const [loaderIds, setLoaderIds] = useState<Set<string>>(new Set());
  const [adding, startAdd] = useTransition();
  const [starting, startStart] = useTransition();

  function toggleLoader(id: string) {
    setLoaderIds(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  }

  function handleAdd() {
    if (!num.trim()) { toast.error("Vehicle number is required"); return; }
    startAdd(async () => {
      const res = await createVehicle({ number: num.trim(), make: make.trim() || undefined, capacityKg: cap.trim() ? Number(cap) : undefined });
      if ("error" in res && res.error) { toast.error(res.error); return; }
      const v = res.vehicle!;
      const opt: VehicleOption = { id: v.id, number: v.number, make: v.make ?? null, capacityKg: v.capacity_kg ?? null };
      setVehicleOptions(prev => prev.some(x => x.id === opt.id) ? prev : [...prev, opt].sort((a, b) => a.number.localeCompare(b.number)));
      setVehicleId(opt.id);
      setShowAdd(false); setNum(""); setMake(""); setCap("");
      toast.success(`Vehicle ${opt.number} added`);
    });
  }

  function handleStart() {
    if (!vehicleId) { toast.error("Select a vehicle"); return; }
    startStart(async () => {
      const res = await startVehicleLoad({ vehicleId, loaderUserIds: Array.from(loaderIds) });
      if ("error" in res && res.error) { toast.error(res.error); return; }
      router.push(`/load?load=${res.loadId}`);
    });
  }

  return (
    <div className="space-y-5">
      <div>
        <Label className="text-xs">Vehicle <span className="text-danger">*</span></Label>
        {!showAdd ? (
          <div className="flex items-center gap-2 mt-1">
            <select
              className="flex-1 px-3 py-2 text-sm bg-paper-card border border-paper-line rounded focus:outline-none focus:ring-2 focus:ring-accent/30"
              value={vehicleId}
              onChange={e => setVehicleId(e.target.value)}
            >
              <option value="">Select a vehicle…</option>
              {vehicleOptions.map(v => (
                <option key={v.id} value={v.id}>
                  {v.number}{v.make ? ` · ${v.make}` : ""}{v.capacityKg ? ` · ${v.capacityKg}kg` : ""}
                </option>
              ))}
            </select>
            <button type="button" onClick={() => setShowAdd(true)} className="shrink-0 inline-flex items-center gap-1 px-2.5 py-2 text-xs rounded border border-paper-line bg-paper-card hover:bg-paper-subtle">
              <Plus size={13}/> Add
            </button>
          </div>
        ) : (
          <div className="mt-1 border border-paper-line rounded-md p-3 bg-paper-subtle/30 space-y-2">
            <div className="text-2xs uppercase tracking-wide text-ink-muted">New vehicle</div>
            <Input placeholder="Number e.g. MH-20 AB 1234" value={num} onChange={e => setNum(e.target.value)} autoFocus />
            <div className="flex gap-2">
              <Input placeholder="Make (optional)" value={make} onChange={e => setMake(e.target.value)} />
              <Input placeholder="Capacity kg" inputMode="numeric" value={cap} onChange={e => setCap(e.target.value)} className="w-28" />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleAdd} disabled={adding}>{adding ? "Adding…" : "Add vehicle"}</Button>
              <Button size="sm" variant="outline" onClick={() => { setShowAdd(false); setNum(""); setMake(""); setCap(""); }}>Cancel</Button>
            </div>
          </div>
        )}
      </div>

      <div>
        <Label className="text-xs inline-flex items-center gap-1">
          <Users size={12}/> Loaders <span className="text-2xs text-ink-subtle font-normal">(who is loading)</span>
        </Label>
        {loaders.length === 0 ? (
          <p className="text-2xs text-ink-subtle mt-1"><em>No loaders configured (van_helper / dispatch users).</em></p>
        ) : (
          <div className="mt-1 grid grid-cols-2 gap-1.5">
            {loaders.map(l => {
              const on = loaderIds.has(l.id);
              return (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => toggleLoader(l.id)}
                  className={`text-left px-2.5 py-2 rounded border text-xs transition-colors flex items-center gap-2 ${
                    on ? "border-accent bg-accent-soft/40" : "border-paper-line bg-paper-card hover:bg-paper-subtle"
                  }`}
                >
                  {on ? <CheckSquare size={14} className="text-accent shrink-0"/> : <Square size={14} className="text-ink-subtle shrink-0"/>}
                  <span className="truncate">{l.name}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <Button className="w-full" size="lg" onClick={handleStart} disabled={!vehicleId || starting}>
        {starting ? "Starting…" : "Start loading this vehicle"} <ArrowRight size={14}/>
      </Button>
    </div>
  );
}
