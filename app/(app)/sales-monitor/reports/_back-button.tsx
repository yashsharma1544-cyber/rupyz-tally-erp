"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

/**
 * Reusable Back button for Reports detail pages. Uses browser history when
 * available (preserves filter state on the previous page), otherwise falls
 * back to the Reports tab.
 */
export function BackButton({ fallbackHref = "/sales-monitor?tab=reports" }: { fallbackHref?: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        if (typeof window !== "undefined" && window.history.length > 1) {
          router.back();
        } else {
          router.push(fallbackHref);
        }
      }}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-ink-muted hover:text-accent hover:bg-paper-subtle border border-paper-line rounded-md bg-paper-card transition-colors"
    >
      <ArrowLeft size={14} /> Back
    </button>
  );
}
