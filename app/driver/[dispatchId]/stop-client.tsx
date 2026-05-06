"use client";

import { useState, useRef, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Camera, CheckCircle2, MapPin, Phone, RotateCcw, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/input";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { getPhotoUploadUrl, markDelivered } from "@/app/(app)/dispatches/actions";

interface DispatchStop {
  id: string;
  status: string;
  vehicleNumber: string | null;
  driverName: string | null;
  totalQty: number;
  totalAmount: number;
  notes: string | null;
  rupyzOrderId: string;
  customer: {
    name: string;
    city: string | null;
    mobile: string | null;
    address: string | null;
    beatName: string | null;
  };
  items: Array<{
    id: string;
    productName: string;
    qty: number;
    price: number;
    unit: string | null;
  }>;
}

function formatINR(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "₹0";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

export function DriverStopClient({ dispatch }: { dispatch: DispatchStop }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [receiverName, setReceiverName] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, startTransition] = useTransition();

  const isShipped = dispatch.status === "shipped";

  function openCamera() {
    fileInputRef.current?.click();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    setPhotoPreviewUrl(URL.createObjectURL(file));
  }

  function clearPhoto() {
    setPhotoFile(null);
    if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    setPhotoPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // Try to read GPS, but don't block if denied. Returns null if unavailable.
  function getCurrentPosition(): Promise<{ lat: number; lng: number; accuracy: number } | null> {
    if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
    return new Promise(resolve => {
      navigator.geolocation.getCurrentPosition(
        pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 30000 },
      );
    });
  }

  function handleMarkDelivered() {
    if (!photoFile) {
      toast.error("Please capture a photo first");
      return;
    }
    if (!isShipped) {
      toast.error("This delivery isn't ready — wait for dispatcher to dispatch the truck");
      return;
    }

    startTransition(async () => {
      try {
        // 1. Try to capture GPS (non-blocking)
        const gps = await getCurrentPosition();

        // 2. Get signed upload URL
        const uploadInfo = await getPhotoUploadUrl(dispatch.id);
        if ("error" in uploadInfo && uploadInfo.error) {
          toast.error(`Upload prep failed: ${uploadInfo.error}`);
          return;
        }
        // After the guard, narrow to success branch
        if (!("ok" in uploadInfo) || !uploadInfo.objectName || !uploadInfo.token) {
          toast.error("Upload prep returned an unexpected response");
          return;
        }
        const { objectName, token } = uploadInfo;

        // 3. Upload photo to Supabase storage via signed URL
        const supabase = createClient();
        const { error: upErr } = await supabase.storage
          .from("pod-photos")
          .uploadToSignedUrl(objectName, token, photoFile, {
            contentType: photoFile.type || "image/jpeg",
          });
        if (upErr) {
          toast.error(`Photo upload failed: ${upErr.message}`);
          return;
        }

        // 4. Build public URL for the uploaded photo
        const { data: urlData } = supabase.storage.from("pod-photos").getPublicUrl(objectName);
        const photoUrl = urlData.publicUrl;

        // 5. Mark dispatch delivered
        const res = await markDelivered(dispatch.id, {
          photoUrl,
          latitude: gps?.lat ?? null,
          longitude: gps?.lng ?? null,
          accuracyM: gps?.accuracy ?? null,
          receiverName: receiverName.trim() || undefined,
          notes: notes.trim() || undefined,
        });
        if (res.error) {
          toast.error(res.error);
          return;
        }
        toast.success(`${dispatch.customer.name} marked delivered`);
        router.push("/driver");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Something went wrong");
      }
    });
  }

  return (
    <div className="min-h-screen bg-paper pb-32">
      <div className="max-w-md mx-auto px-3 py-4">
        <Link href="/driver" className="text-xs text-ink-muted hover:text-ink inline-flex items-center gap-1 mb-2">
          <ArrowLeft size={11}/> Back to deliveries
        </Link>

        {/* Customer header */}
        <h1 className="text-lg font-semibold leading-tight">{dispatch.customer.name}</h1>
        <div className="text-xs text-ink-muted mt-0.5 space-y-0.5">
          {dispatch.customer.address && <div>{dispatch.customer.address}</div>}
          {dispatch.customer.city && (
            <div className="inline-flex items-center gap-1">
              <MapPin size={9}/> {dispatch.customer.city}
              {dispatch.customer.beatName && <> · {dispatch.customer.beatName}</>}
            </div>
          )}
          {dispatch.customer.mobile && (
            <div>
              <a
                href={`tel:${dispatch.customer.mobile}`}
                className="inline-flex items-center gap-1 text-accent hover:underline"
              >
                <Phone size={9}/> {dispatch.customer.mobile}
              </a>
            </div>
          )}
        </div>
        <div className="text-2xs font-mono text-ink-subtle mt-1">{dispatch.rupyzOrderId}</div>

        {/* Status banner if pending */}
        {!isShipped && (
          <div className="mt-3 bg-warn-soft border border-warn/40 rounded-md p-3 text-xs text-ink">
            <strong className="block mb-0.5">Truck still loading</strong>
            This stop isn&apos;t ready to deliver yet. Wait for the dispatcher to mark the truck dispatched.
          </div>
        )}

        {/* Items */}
        <div className="mt-4">
          <h2 className="text-xs uppercase tracking-wide text-ink-muted font-semibold mb-2">
            Items on this stop · {dispatch.totalQty} units · {formatINR(dispatch.totalAmount)}
          </h2>
          <div className="bg-paper-card border border-paper-line rounded divide-y divide-paper-line">
            {dispatch.items.map(it => (
              <div key={it.id} className="px-3 py-2 flex items-baseline justify-between gap-2 text-sm">
                <span className="font-medium flex-1 min-w-0 truncate">{it.productName}</span>
                <span className="font-semibold tabular shrink-0">
                  {it.qty}
                  {it.unit && <span className="text-2xs text-ink-muted ml-0.5">{it.unit}</span>}
                </span>
              </div>
            ))}
            {dispatch.items.length === 0 && (
              <div className="px-3 py-4 text-center text-sm text-ink-muted">No items.</div>
            )}
          </div>
        </div>

        {/* Optional fields */}
        <div className="mt-5 pt-4 border-t border-paper-line space-y-3">
          <h2 className="text-xs uppercase tracking-wide text-ink-muted font-semibold">
            Delivery details
          </h2>
          <div>
            <Label className="text-xs text-ink-muted">Receiver name</Label>
            <Input
              className="mt-1"
              placeholder="Who received it? (optional)"
              value={receiverName}
              onChange={e => setReceiverName(e.target.value)}
              disabled={!isShipped || pending}
            />
          </div>
          <div>
            <Label className="text-xs text-ink-muted">Notes</Label>
            <Textarea
              className="mt-1"
              rows={2}
              placeholder="Anything to note (optional)"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              disabled={!isShipped || pending}
            />
          </div>
        </div>

        {/* Photo capture */}
        <div className="mt-5 pt-4 border-t border-paper-line">
          <h2 className="text-xs uppercase tracking-wide text-ink-muted font-semibold mb-2">
            Proof of delivery photo
          </h2>

          {/* Hidden file input — opens native camera on phone */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFileChange}
            className="hidden"
          />

          {!photoPreviewUrl ? (
            <button
              type="button"
              onClick={openCamera}
              disabled={!isShipped || pending}
              className="w-full bg-paper-card border-2 border-dashed border-paper-line rounded-md p-8 hover:bg-paper-subtle/40 active:bg-paper-subtle disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-center"
            >
              <Camera size={32} className="mx-auto text-ink-subtle mb-2"/>
              <p className="text-sm font-semibold">Tap to take photo</p>
              <p className="text-2xs text-ink-muted mt-1">Required to mark delivered</p>
            </button>
          ) : (
            <div className="relative bg-paper-card border border-paper-line rounded-md overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photoPreviewUrl} alt="POD" className="w-full max-h-[60vh] object-contain bg-ink"/>
              <div className="p-2 flex gap-2">
                <button
                  type="button"
                  onClick={openCamera}
                  disabled={pending}
                  className="flex-1 text-xs text-ink-muted hover:text-ink inline-flex items-center justify-center gap-1 py-2"
                >
                  <RotateCcw size={11}/> Retake
                </button>
                <button
                  type="button"
                  onClick={clearPhoto}
                  disabled={pending}
                  className="flex-1 text-xs text-danger hover:text-danger inline-flex items-center justify-center gap-1 py-2"
                >
                  Remove
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Sticky footer */}
      <div className="fixed bottom-0 left-0 right-0 bg-paper-card/95 backdrop-blur border-t border-paper-line p-3">
        <div className="max-w-md mx-auto">
          <Button
            className="w-full"
            size="lg"
            onClick={handleMarkDelivered}
            disabled={!isShipped || !photoFile || pending}
          >
            <CheckCircle2 size={14}/>
            {pending
              ? "Saving…"
              : !photoFile
                ? "Take photo to enable"
                : `Mark delivered`}
          </Button>
          {dispatch.vehicleNumber && (
            <p className="text-2xs text-ink-muted text-center mt-1.5 inline-flex items-center justify-center gap-1 w-full">
              <Truck size={9}/> {dispatch.vehicleNumber}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
