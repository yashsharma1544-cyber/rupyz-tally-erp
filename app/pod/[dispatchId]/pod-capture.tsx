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
import { useTranslation } from "@/lib/i18n/context";
import { markDelivered } from "@/app/(app)/dispatches/actions";

export function PODCapture({ dispatch, me }: { dispatch: Dispatch; me: AppUser }) {
  const supabase = createClient();
  const { t } = useTranslation();
  const alreadyDelivered = dispatch.status === "delivered";
  const cantCapture = dispatch.status !== "shipped";

  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoTakenAt, setPhotoTakenAt] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [coordsErr, setCoordsErr] = useState<string | null>(null);
  const [receiverName, setReceiverName] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, startTransition] = useTransition();
  const [submitted, setSubmitted] = useState(false);

  // Auto-fetch geolocation on mount
  useEffect(() => {
    if (alreadyDelivered) return;
    if (!navigator.geolocation) { setCoordsErr(t("pod.geolocation_unsupported")); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      (err) => setCoordsErr(err.message),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alreadyDelivered]);

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhoto(file);
    setPhotoTakenAt(new Date().toISOString());
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
    if (!photo || !photoTakenAt) { toast.error(t("pod.toast_capture_photo_first")); return; }
    if (!coords) { toast.error(t("pod.toast_wait_location")); return; }

    const photoFile = photo;
    const takenAt = photoTakenAt;
    const c = coords;

    startTransition(async () => {
      // 1. Upload photo to storage
      const objectName = `dispatch-${dispatch.id}/${Date.now()}.jpg`;
      const { error: upErr } = await supabase.storage
        .from("pod-photos")
        .upload(objectName, photoFile, { contentType: photoFile.type, upsert: false });
      if (upErr) { toast.error(t("pod.toast_upload_failed", { error: upErr.message })); return; }

      // 2. Get public URL
      const { data: { publicUrl } } = supabase.storage.from("pod-photos").getPublicUrl(objectName);

      // 3. Mark dispatch delivered (server action)
      const res = await markDelivered(dispatch.id, {
        photoUrl: publicUrl,
        photoTakenAt: takenAt,
        latitude: c.lat,
        longitude: c.lng,
        accuracyM: c.accuracy,
        receiverName: receiverName.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      if (res.error) { toast.error(res.error); return; }
      toast.success(t("pod.toast_delivery_confirmed"));
      setSubmitted(true);
    });
  }

  if (alreadyDelivered || submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper px-4">
        <div className="bg-paper-card border border-paper-line rounded-lg p-6 max-w-sm text-center">
          <CheckCircle2 size={48} className="text-ok mx-auto mb-3" />
          <h1 className="text-lg font-bold mb-1">{t("pod.delivered_title")}</h1>
          <p className="text-sm text-ink-muted mb-4">
            {t("pod.delivered_body", { dispatchNumber: dispatch.dispatch_number ?? "—" })}
          </p>
          {dispatch.pod?.photo_url && (
            <a href={dispatch.pod.photo_url} target="_blank" rel="noopener noreferrer" className="text-sm text-accent hover:underline">
              {t("pod.view_receipt_photo")}
            </a>
          )}
          <div className="mt-4">
            <Link href="/dispatches" className="text-xs text-ink-muted hover:text-ink"><ArrowLeft size={11} className="inline"/> {t("pod.back_to_dispatches")}</Link>
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
          <h1 className="text-lg font-bold mb-1">{t("pod.not_ready_title")}</h1>
          <p className="text-sm text-ink-muted mb-4">
            {t("pod.not_ready_body", { status: dispatch.status })}
          </p>
          <Link href="/dispatches" className="text-sm text-accent hover:underline">{t("pod.back_to_dispatches")}</Link>
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
            <ArrowLeft size={11}/> {t("pod.dispatches")}
          </Link>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-xl font-bold">{t("pod.capture_pod")}</h1>
            <Badge variant="accent">{t("pod.in_transit_badge")}</Badge>
          </div>
          <p className="text-xs text-ink-muted">
            {t("pod.dispatch_number_label", { dispatchNumber: dispatch.dispatch_number ?? "—" })}
          </p>
        </div>

        {/* Customer + delivery info */}
        <div className="bg-paper-card border border-paper-line rounded p-3 mb-4">
          <div className="text-2xs uppercase tracking-wide text-ink-subtle mb-1">{t("pod.deliver_to")}</div>
          <div className="font-semibold">{order?.customer?.name ?? "—"}</div>
          <div className="text-xs text-ink-muted mt-0.5">{order?.delivery_address_line}</div>
          <div className="text-xs text-ink-muted">{order?.delivery_city} {order?.delivery_pincode}</div>
          {order?.customer?.mobile && (
            <a href={`tel:${order.customer.mobile}`} className="text-xs text-accent hover:underline mt-1.5 inline-block">📞 {order.customer.mobile}</a>
          )}
          <div className="text-xs text-ink-muted mt-2 pt-2 border-t border-paper-line">
            {t("pod.order_total_line", {
              rupyzOrderId: order?.rupyz_order_id ?? "—",
              amount: formatINR(dispatch.total_amount ?? 0),
            })}
          </div>
        </div>

        {/* Items being delivered */}
        <div className="bg-paper-card border border-paper-line rounded p-3 mb-4">
          <div className="text-2xs uppercase tracking-wide text-ink-subtle mb-2">
            {t("pod.items_in_dispatch_count", { count: dispatch.items?.length ?? 0 })}
          </div>
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
          <Label className="block mb-2">{t("pod.photo_label")}</Label>
          {photoPreview ? (
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photoPreview} alt="POD" className="w-full rounded border border-paper-line"/>
              <button
                onClick={() => { setPhoto(null); setPhotoPreview(null); setPhotoTakenAt(null); }}
                className="absolute top-2 right-2 bg-paper-card/90 backdrop-blur px-2 py-1 rounded text-xs hover:bg-paper-card"
              >
                {t("pod.retake")}
              </button>
              {photoTakenAt && (
                <div className="mt-2 text-2xs text-ink-muted">
                  Captured {new Date(photoTakenAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                </div>
              )}
            </div>
          ) : (
            <label className="block border-2 border-dashed border-paper-line rounded-lg p-8 text-center cursor-pointer hover:border-accent">
              <Camera size={32} className="mx-auto mb-2 text-ink-subtle"/>
              <span className="text-sm text-ink-muted">{t("driver_stop.tap_to_take_photo")}</span>
              <input type="file" accept="image/*" capture="environment" onChange={handlePhotoChange} className="hidden" />
            </label>
          )}
        </div>

        {/* Geolocation */}
        <div className="bg-paper-card border border-paper-line rounded p-3 mb-4">
          <div className="flex items-center justify-between mb-1">
            <Label>{t("pod.location_label")}</Label>
            <button onClick={refreshLocation} className="text-xs text-accent hover:underline inline-flex items-center gap-1">
              <RefreshCw size={11}/> {t("common.refresh")}
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
            <div className="text-xs text-ink-muted">{t("pod.getting_location")}</div>
          )}
        </div>

        {/* Receiver name + notes */}
        <div className="space-y-3 mb-5">
          <div>
            <Label className="block mb-1">{t("pod.received_by_label")}</Label>
            <Input value={receiverName} onChange={(e) => setReceiverName(e.target.value)} placeholder={t("pod.received_by_placeholder")} />
          </div>
          <div>
            <Label className="block mb-1">{t("pod.notes_label")}</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("pod.notes_placeholder")} rows={2} />
          </div>
        </div>

        <Button
          className="w-full"
          size="lg"
          onClick={handleSubmit}
          disabled={pending || !photo || !coords}
        >
          {pending ? t("pod.submitting") : t("pod.confirm_delivery")}
        </Button>

        <p className="text-2xs text-ink-subtle text-center mt-3">
          {me.full_name} · {new Date().toLocaleString("en-IN")}
        </p>
      </div>
    </div>
  );
}
