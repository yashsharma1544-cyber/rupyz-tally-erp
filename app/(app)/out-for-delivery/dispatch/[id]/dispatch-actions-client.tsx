"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { markDelivered } from "../../actions";

export function DispatchActions({ dispatchId, invoiceIds }: { dispatchId: string; invoiceIds: string[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onMarkAllDelivered() {
    if (invoiceIds.length === 0) return;
    if (!confirm(`Mark all ${invoiceIds.length} invoice(s) in this dispatch as delivered?`)) return;
    setBusy(true);
    const res = await markDelivered(invoiceIds);
    setBusy(false);
    if (!res.ok) alert(res.error ?? "Failed");
    else router.refresh();
  }

  return (
    <button
      onClick={onMarkAllDelivered}
      disabled={busy || invoiceIds.length === 0}
      className="h-9 px-3 rounded bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 inline-flex items-center gap-1.5 disabled:opacity-50"
    >
      <CheckCircle2 size={14} /> {busy ? "Marking…" : "Mark all delivered"}
    </button>
  );
}
