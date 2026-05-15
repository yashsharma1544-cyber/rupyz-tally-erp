"use client";

// React context for i18n.
//
// SSR-safety:
// - Server renders default lang ("en") to avoid hydration mismatch.
// - After mount, we read localStorage and update if user previously chose "mr".
// - The first paint shows English; if user has "mr" stored, it swaps within
//   one render tick. Acceptable trade-off for avoiding hydration errors.

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { translate, type Lang } from "./dictionary";

interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  mounted: boolean;
}

const I18nContext = createContext<I18nContextValue | null>(null);

const STORAGE_KEY = "rupyz_lang";

export function I18nProvider({ children, defaultLang = "en" as Lang }: { children: ReactNode; defaultLang?: Lang }) {
  const [lang, setLangState] = useState<Lang>(defaultLang);
  const [mounted, setMounted] = useState(false);

  // After hydration, read stored preference
  useEffect(() => {
    setMounted(true);
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "en" || stored === "mr") {
        setLangState(stored);
      }
    } catch {
      // localStorage may be unavailable (incognito mode, etc.). Default to en.
    }
  }, []);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => translate(key, lang, vars),
    [lang],
  );

  return (
    <I18nContext.Provider value={{ lang, setLang, t, mounted }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useTranslation(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    // Fallback for components rendered outside the provider (rare but safe).
    return {
      lang: "en",
      setLang: () => {},
      t: (key) => translate(key, "en"),
      mounted: false,
    };
  }
  return ctx;
}
