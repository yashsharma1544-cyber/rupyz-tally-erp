"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cancelVehicleLoad } from "@/app/(app)/dispatches/actions";

// Small delete control shown on a loading-session card when it has 0 orders
// loaded. Cancels the empty vehicle_loads session (server-side guard refuses
// if any order is on it). Stops the parent <Link> from navigating.
export function DeleteEmptyLoadButton({ loadId, vehicleNumber }: { loadId: string; vehicleNumber: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirming) { setConfirming(true); return; }
    startTransition(async () => {
      const res = await cancelVehicleLoad(loadId);
      if ("error" in res && res.error) { toast.error(res.error); setConfirming(false); return; }
      toast.success(`Loading for ${vehicleNumber} deleted`);
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      onMouseLeave={() => setConfirming(false)}
      disabled={pending}
      className={`inline-flex items-center gap-1 text-2xs rounded px-2 py-1 transition-colors ${
        confirming
          ? "bg-danger text-white"
          : "text-ink-subtle hover:text-danger hover:bg-danger-soft"
      }`}
      title="Delete this empty loading session"
    >
      <Trash2 size={12} /> {pending ? "Deleting…" : confirming ? "Confirm delete?" : "Delete"}
    </button>
  );
}
