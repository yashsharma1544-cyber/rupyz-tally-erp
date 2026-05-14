"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

/**
 * AutoRefresh — silently refreshes the page on a soft interval (router.refresh).
 *
 * Behavior:
 * - Refreshes every `intervalMs` (default 30s) when the document is visible.
 * - Pauses when the document is hidden (visibilitychange listener).
 * - Shows subtle text at the bottom: "Updated Xs ago" — counts up between refreshes.
 *
 * Add to any page once. Position it near the bottom of your layout.
 */
export function AutoRefresh({ intervalMs = 30_000 }: { intervalMs?: number }) {
  const router = useRouter();
  const [lastRefreshAt, setLastRefreshAt] = useState<number>(() => Date.now());
  const [now, setNow] = useState<number>(() => Date.now());
  const [isVisible, setIsVisible] = useState<boolean>(true);

  // Tick the "now" timer every second so the "Xs ago" label stays current
  useEffect(() => {
    const tickId = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tickId);
  }, []);

  // Track tab visibility — pause refresh when hidden
  useEffect(() => {
    if (typeof document === "undefined") return;
    function onVisibility() {
      const visible = document.visibilityState === "visible";
      setIsVisible(visible);
    }
    setIsVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // The refresh loop — only ticks when visible
  const lastRefreshRef = useRef(lastRefreshAt);
  lastRefreshRef.current = lastRefreshAt;
  useEffect(() => {
    if (!isVisible) return;
    const refreshId = setInterval(() => {
      router.refresh();
      setLastRefreshAt(Date.now());
    }, intervalMs);
    return () => clearInterval(refreshId);
  }, [router, intervalMs, isVisible]);

  // Build the "Xs ago" label
  const secondsAgo = Math.max(0, Math.floor((now - lastRefreshAt) / 1000));
  const label =
    secondsAgo < 5 ? "just now" :
    secondsAgo < 60 ? `${secondsAgo}s ago` :
    secondsAgo < 3600 ? `${Math.floor(secondsAgo / 60)}m ago` :
    `${Math.floor(secondsAgo / 3600)}h ago`;

  return (
    <div className="mt-4 sm:mt-6 text-center text-2xs text-ink-subtle flex items-center justify-center gap-1">
      <RefreshCw size={9} className={isVisible ? "opacity-50" : "opacity-30"} />
      <span>
        Updated {label}
        {!isVisible && <span className="ml-1">· paused</span>}
      </span>
    </div>
  );
}
