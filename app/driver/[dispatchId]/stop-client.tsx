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
import { useTranslation } from "@/lib/i18n/context";
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
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [photoTakenAt, setPhotoTakenAt] = useState<string | null>(null);
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
    // Record the moment the photo file was selected — closest we can get to
    // "when the photo was taken" on the client (separate from the server-side
    // delivered_at stamped when markDelivered runs).
    setPhotoTakenAt(new Date().toISOString());
    if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    setPhotoPreviewUrl(URL.createObjectURL(file));
  }

  function clearPhoto() {
    setPhotoFile(null);
    setPhotoTakenAt(null);
    if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    setPhotoPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // GPS is REQUIRED — returns null if denied/timeout/no-geolocation, and the
  // caller blocks the delivery in that case.
  function getCurrentPosition(): Promise<{ lat: number; lng: number; accuracy: number } | null> {
    if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
    return new Promise(resolve => {
      navigator.geolocation.getCurrentPosition(
        pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
      );
    });
  }

  function handleMarkDelivered() {
    if (!photoFile || !photoTakenAt) {
      toast.error(t("driver_stop.toast_capture_photo_first"));
      return;
    }
    if (!isShipped) {
      toast.error(t("driver_stop.toast_not_ready"));
      return;
    }

    startTransition(async () => {
      try {
        // 1. GPS is REQUIRED — block if not available
        toast.info("Getting location…");
        const gps = await getCurrentPosition();
        if (!gps) {
          toast.error(
            "Location is required to mark delivered. Please enable location services for this site and try again.",
          );
          return;
        }

        // 2. Signed upload URL
        const uploadInfo = await getPhotoUploadUrl(dispatch.id);
        if ("error" in uploadInfo && uploadInfo.error) {
          toast.error(t("driver_stop.toast_upload_prep_failed", { error: uploadInfo.error }));
          return;
        }
        if (!("ok" in uploadInfo) || !uploadInfo.objectName || !uploadInfo.token) {
          toast.error(t("driver_stop.toast_upload_prep_unexpected"));
          return;
        }
        const { objectName, token } = uploadInfo;

        // 3. Upload photo
        const supabase = createClient();
        const { error: upErr } = await supabase.storage
          .from("pod-photos")
          .uploadToSignedUrl(objectName, token, photoFile, {
            contentType: photoFile.type || "image/jpeg",
          });
        if (upErr) {
          toast.error(t("driver_stop.toast_photo_upload_failed", { error: upErr.message }));
          return;
        }

        const { data: urlData } = supabase.storage.from("pod-photos").getPublicUrl(objectName);
        const photoUrl = urlData.publicUrl;

        // 4. Mark dispatch delivered with required GPS + photo timestamp
        const res = await markDelivered(dispatch.id, {
          photoUrl,
          photoTakenAt,
          latitude: gps.lat,
          longitude: gps.lng,
          accuracyM: gps.accuracy,
          receiverName: receiverName.trim() || undefined,
          notes: notes.trim() || undefined,
        });
        if (res.error) {
          toast.error(res.error);
          return;
        }
        toast.success(t("driver_stop.toast_marked_delivered", { customer: dispatch.customer.name }));
        router.push("/driver");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t("driver_stop.toast_something_wrong"));
      }
    });
  }

  return (
    <div className="min-h-screen bg-paper pb-32">
      <div className="max-w-md mx-auto px-3 py-4">
        <Link href="/driver" className="text-xs text-ink-muted hover:text-ink inline-flex items-center gap-1 mb-2">
          <ArrowLeft size={11}/> {t("driver_stop.back_to_deliveries")}
        </Link>

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

        {!isShipped && (
          <div className="mt-3 bg-warn-soft border border-warn/40 rounded-md p-3 text-xs text-ink">
            <strong className="block mb-0.5">{t("driver_stop.truck_still_loading_title")}</strong>
            {t("driver_stop.truck_still_loading_body")}
          </div>
        )}

        <div className="mt-4">
          <h2 className="text-xs uppercase tracking-wide text-ink-muted font-semibold mb-2">
            {t("driver_stop.items_header", { qty: dispatch.totalQty, amount: formatINR(dispatch.totalAmount) })}
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
              <div className="px-3 py-4 text-center text-sm text-ink-muted">{t("driver_stop.no_items")}</div>
            )}
          </div>
        </div>

        <div className="mt-5 pt-4 border-t border-paper-line space-y-3">
          <h2 className="text-xs uppercase tracking-wide text-ink-muted font-semibold">
            {t("driver_stop.delivery_details")}
          </h2>
          <div>
            <Label className="text-xs text-ink-muted">{t("driver_stop.receiver_name")}</Label>
            <Input
              className="mt-1"
              placeholder={t("driver_stop.receiver_name_placeholder")}
              value={receiverName}
              onChange={e => setReceiverName(e.target.value)}
              disabled={!isShipped || pending}
            />
          </div>
          <div>
            <Label className="text-xs text-ink-muted">{t("common.notes")}</Label>
            <Textarea
              className="mt-1"
              rows={2}
              placeholder={t("driver_stop.notes_placeholder")}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              disabled={!isShipped || pending}
            />
          </div>
        </div>

        <div className="mt-5 pt-4 border-t border-paper-line">
          <h2 className="text-xs uppercase tracking-wide text-ink-muted font-semibold mb-2">
            {t("driver_stop.pod_photo")}
          </h2>

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
              <p className="text-sm font-semibold">{t("driver_stop.tap_to_take_photo")}</p>
              <p className="text-2xs text-ink-muted mt-1">{t("driver_stop.required_to_mark")}</p>
              <p className="text-2xs text-warn mt-1">Location access also required.</p>
            </button>
          ) : (
            <div className="relative bg-paper-card border border-paper-line rounded-md overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photoPreviewUrl} alt="POD" className="w-full max-h-[60vh] object-contain bg-ink"/>
              {photoTakenAt && (
                <div className="px-3 py-1.5 text-2xs text-ink-muted bg-paper-subtle/50 border-t border-paper-line">
                  Captured {new Date(photoTakenAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                </div>
              )}
              <div className="p-2 flex gap-2">
                <button
                  type="button"
                  onClick={openCamera}
                  disabled={pending}
                  className="flex-1 text-xs text-ink-muted hover:text-ink inline-flex items-center justify-center gap-1 py-2"
                >
                  <RotateCcw size={11}/> {t("driver_stop.retake")}
                </button>
                <button
                  type="button"
                  onClick={clearPhoto}
                  disabled={pending}
                  className="flex-1 text-xs text-danger hover:text-danger inline-flex items-center justify-center gap-1 py-2"
                >
                  {t("driver_stop.remove")}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 lg:left-56 bg-paper-card/95 backdrop-blur border-t border-paper-line p-3">
        <div className="max-w-md mx-auto">
          <Button
            className="w-full"
            size="lg"
            onClick={handleMarkDelivered}
            disabled={!isShipped || !photoFile || pending}
          >
            <CheckCircle2 size={14}/>
            {pending
              ? t("common.saving")
              : !photoFile
                ? t("driver_stop.take_photo_to_enable")
                : t("driver_stop.mark_delivered")}
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
