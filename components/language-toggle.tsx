"use client";

// Two-button language toggle: EN | मर
//
// On click:
//   - Updates client-side state (via setLang)
//   - Persists to localStorage + cookie
//   - Calls router.refresh() to re-render server components with new cookie

import { useTranslation } from "@/lib/i18n/context";
import { useRouter } from "next/navigation";
import type { Lang } from "@/lib/i18n/dictionary";

export function LanguageToggle({ className = "" }: { className?: string }) {
  const { lang, setLang, mounted } = useTranslation();
  const router = useRouter();

  // Before hydration, show neutral state to avoid SSR mismatch.
  const active = mounted ? lang : "en";

  function pick(next: Lang) {
    setLang(next);
    // Server-rendered pages use getT() which reads the rupyz_lang cookie.
    // Force a re-fetch so they re-render with the new language.
    router.refresh();
  }

  return (
    <div className={`inline-flex items-center rounded border border-paper-line bg-paper-card overflow-hidden ${className}`}>
      <button
        type="button"
        onClick={() => pick("en")}
        className={`px-2 py-1 text-xs font-medium transition-colors ${
          active === "en"
            ? "bg-accent text-white"
            : "text-ink-muted hover:bg-paper-subtle"
        }`}
        aria-label="Switch to English"
        aria-pressed={active === "en"}
      >
        EN
      </button>
      <button
        type="button"
        onClick={() => pick("mr")}
        className={`px-2 py-1 text-xs font-medium transition-colors border-l border-paper-line ${
          active === "mr"
            ? "bg-accent text-white"
            : "text-ink-muted hover:bg-paper-subtle"
        }`}
        aria-label="मराठीत बदला"
        aria-pressed={active === "mr"}
      >
        मर
      </button>
    </div>
  );
}
