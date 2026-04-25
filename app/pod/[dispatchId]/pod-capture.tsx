"use client";

import { useEffect, useState, useTransition } from "react";
import { Camera, MapPin, CheckCircle2, AlertCircle, RefreshCw, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/client";
import type { Dispatch, AppUser } from "@/lib/types";
import { formatINR } from "@/lib/utils";
import { toast } from "sonner";
import { markDelivered } from "@/app/(app)/dispatches/actions";

export function PODCapture({ dispatch, me }: { dispatch: Dispatch; me: AppUser }) {
  const supabase = createClient();
  const alreadyDelivered = dispatch.status === "delivered";
  const cantCapture = dispatch.status !== "shipped";

  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [coordsErr, setCoordsErr] = useState<string | null>(null);
  const [receiverName, setReceiverName] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, startTransition] = useTransition();
  const [submitted, setSubmitted] = useState(false);

  // Auto-fetch geolocation on mount
  useEffect(() => {
    if (alreadyDelivered) return;
    if (!navigator.geolocation) { setCoordsErr("Geolocation not supported on this device"); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      (err) => setCoordsErr(err.message),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  }, [alreadyDelivered]);

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhoto(file);
    const reader = new FileReader();
    reader.onload = (ev) => setPhotoPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  }

  function refreshLocation() {
    setCoordsErr(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      (err) => setCoordsErr(err.message),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  }

  function handleSubmit() {
    if (!photo) { toast.error("Capture a photo first"); return; }
    if (!coords) { toast.error("Wait for location to lock, or refresh"); return; }

    const photoFile = photo;
    const c = coords;

    startTransition(async () => {
      // 1. Upload photo to storage
      const objectName = `dispatch-${dispatch.id}/${Date.now()}.jpg`;
      const { error: upErr } = await supabase.storage
        .from("pod-photos")
        .upload(objectName, photoFile, { contentType: photoFile.type, upsert: false });
      if (upErr) { toast.error(`Upload failed: ${upErr.message}`); return; }

      // 2. Get public URL
      const { data: { publicUrl } } = supabase.storage.from("pod-photos").getPublicUrl(objectName);

      // 3. Mark dispatch delivered (server action)
      const res = await markDelivered(dispatch.id, {
        photoUrl: publicUrl,
        latitude: c.lat,
        longitude: c.lng,
        accuracyM: c.accuracy,
        receiverName: receiverName.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      if (res.error) { toast.error(res.error); return; }
      toast.success("Delivery confirmed");
      setSubmitted(true);
    });
  }

  if (alreadyDelivered || submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper px-4">
        <div className="bg-paper-card border border-paper-line rounded-lg p-6 max-w-sm text-center">
          <CheckCircle2 size={48} className="text-ok mx-auto mb-3" />
          <h1 className="text-lg font-bold mb-1">Delivered ✓</h1>
          <p className="text-sm text-ink-muted mb-4">
            Dispatch <span className="font-mono">{dispatch.dispatch_number}</span> is marked delivered.
          </p>
          {dispatch.pod?.photo_url && (
            <a href={dispatch.pod.photo_url} target="_blank" rel="noopener noreferrer" className="text-sm text-accent hover:underline">
              View receipt photo
            </a>
          )}
          <div className="mt-4">
            <Link href="/dispatches" className="text-xs text-ink-muted hover:text-ink"><ArrowLeft size={11} className="inline"/> Back to dispatches</Link>
          </div>
        </div>
      </div>
    );
  }

  if (cantCapture) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper px-4">
        <div className="bg-paper-card border border-paper-line rounded-lg p-6 max-w-sm text-center">
          <AlertCircle size={36} className="text-warn mx-auto mb-3" />
          <h1 className="text-lg font-bold mb-1">Not ready for POD</h1>
          <p className="text-sm text-ink-muted mb-4">
            This dispatch is in "<span className="font-medium">{dispatch.status}</span>" status. POD can only be captured after the dispatch is marked Shipped.
          </p>
          <Link href="/dispatches" className="text-sm text-accent hover:underline">Back to dispatches</Link>
        </div>
      </div>
    );
  }

  const order = dispatch.order;

  return (
    <div className="min-h-screen bg-paper">
      <div className="max-w-md mx-auto px-4 py-5">
        {/* Header */}
        <div className="mb-4">
          <Link href="/dispatches" className="text-xs text-ink-muted hover:text-ink inline-flex items-center gap-1 mb-2">
            <ArrowLeft size={11}/> Dispatches
          </Link>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-xl font-bold">Capture POD</h1>
            <Badge variant="accent">In transit</Badge>
          </div>
          <p className="text-xs text-ink-muted">Dispatch <span className="font-mono">{dispatch.dispatch_number}</span></p>
        </div>

        {/* Customer + delivery info */}
        <div className="bg-paper-card border border-paper-line rounded p-3 mb-4">
          <div className="text-2xs uppercase tracking-wide text-ink-subtle mb-1">Deliver to</div>
          <div className="font-semibold">{order?.customer?.name ?? "—"}</div>
          <div className="text-xs text-ink-muted mt-0.5">{order?.delivery_address_line}</div>
          <div className="text-xs text-ink-muted">{order?.delivery_city} {order?.delivery_pincode}</div>
          {order?.customer?.mobile && (
            <a href={`tel:${order.customer.mobile}`} className="text-xs text-accent hover:underline mt-1.5 inline-block">📞 {order.customer.mobile}</a>
          )}
          <div className="text-xs text-ink-muted mt-2 pt-2 border-t border-paper-line">
            Order: <a href={`/orders`} className="text-accent">#{order?.rupyz_order_id}</a> · Total: <span className="tabular">{formatINR(dispatch.total_amount ?? 0)}</span>
          </div>
        </div>

        {/* Items being delivered */}
        <div className="bg-paper-card border border-paper-line rounded p-3 mb-4">
          <div className="text-2xs uppercase tracking-wide text-ink-subtle mb-2">Items in this dispatch ({dispatch.items?.length ?? 0})</div>
          <div className="space-y-1">
            {dispatch.items?.map((di) => (
              <div key={di.id} className="flex justify-between text-sm">
                <span>{di.order_item?.product_name}</span>
                <span className="tabular text-ink-muted">{di.qty} {di.order_item?.unit}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Photo capture */}
        <div className="bg-paper-card border border-paper-line rounded p-3 mb-4">
          <Label className="block mb-2">Photo of signed receipt or delivered goods</Label>
          {photoPreview ? (
            <div className="relative">
              <img src={photoPreview} alt="POD" className="w-full rounded border border-paper-line"/>
              <button
                onClick={() => { setPhoto(null); setPhotoPreview(null); }}
                className="absolute top-2 right-2 bg-paper-card/90 backdrop-blur px-2 py-1 rounded text-xs hover:bg-paper-card"
              >
                Retake
              </button>
            </div>
          ) : (
            <label className="block border-2 border-dashed border-paper-line rounded-lg p-8 text-center cursor-pointer hover:border-accent">
              <Camera size={32} className="mx-auto mb-2 text-ink-subtle"/>
              <span className="text-sm text-ink-muted">Tap to take photo</span>
              <input type="file" accept="image/*" capture="environment" onChange={handlePhotoChange} className="hidden" />
            </label>
          )}
        </div>

        {/* Geolocation */}
        <div className="bg-paper-card border border-paper-line rounded p-3 mb-4">
          <div className="flex items-center justify-between mb-1">
            <Label>Location</Label>
            <button onClick={refreshLocation} className="text-xs text-accent hover:underline inline-flex items-center gap-1">
              <RefreshCw size={11}/> Refresh
            </button>
          </div>
          {coords ? (
            <div className="flex items-center gap-2 text-sm">
              <MapPin size={14} className="text-ok shrink-0"/>
              <span className="tabular text-xs">{coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}</span>
              <span className="text-2xs text-ink-muted">±{Math.round(coords.accuracy)}m</span>
            </div>
          ) : coordsErr ? (
            <div className="text-xs text-danger flex items-center gap-1.5"><AlertCircle size={12}/>{coordsErr}</div>
          ) : (
            <div className="text-xs text-ink-muted">Getting location…</div>
          )}
        </div>

        {/* Receiver name + notes */}
        <div className="space-y-3 mb-5">
          <div>
            <Label className="block mb-1">Received by (optional)</Label>
            <Input value={receiverName} onChange={(e) => setReceiverName(e.target.value)} placeholder="Name of person who received" />
          </div>
          <div>
            <Label className="block mb-1">Notes (optional)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any issues, partial acceptance, etc." rows={2} />
          </div>
        </div>

        <Button
          className="w-full"
          size="lg"
          onClick={handleSubmit}
          disabled={pending || !photo || !coords}
        >
          {pending ? "Submitting…" : "Confirm Delivery"}
        </Button>

        <p className="text-2xs text-ink-subtle text-center mt-3">
          {me.full_name} · {new Date().toLocaleString("en-IN")}
        </p>
      </div>
    </div>
  );
}
