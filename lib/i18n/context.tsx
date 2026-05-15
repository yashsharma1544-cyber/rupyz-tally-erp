"use client";

// React context for i18n.
//
// On language change:
//   - Saves to localStorage (for fast client-side hydration)
//   - Sets a cookie (so server components can read the lang too)
// Both are written. Server components read from cookie via lib/i18n/server.ts.
//
// SSR-safety: server renders default lang ("en") to avoid hydration mismatch.
// After mount, we read localStorage and update if user previously chose "mr".

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
const COOKIE_KEY = "rupyz_lang";
// 1 year cookie — language is a sticky preference.
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function writeCookie(value: Lang) {
  try {
    // Path=/ so all routes see it. SameSite=Lax so it's sent on navigation.
    // No Secure flag — we want it to work on http://localhost during dev.
    document.cookie = `${COOKIE_KEY}=${value}; Max-Age=${COOKIE_MAX_AGE}; Path=/; SameSite=Lax`;
  } catch {
    // ignore
  }
}

function readCookie(): Lang | null {
  try {
    const match = document.cookie.match(new RegExp("(?:^|; )" + COOKIE_KEY + "=([^;]*)"));
    if (!match) return null;
    const v = decodeURIComponent(match[1]);
    return v === "en" || v === "mr" ? v : null;
  } catch {
    return null;
  }
}

export function I18nProvider({ children, defaultLang = "en" as Lang }: { children: ReactNode; defaultLang?: Lang }) {
  const [lang, setLangState] = useState<Lang>(defaultLang);
  const [mounted, setMounted] = useState(false);

  // After hydration, read stored preference. Cookie takes priority (server
  // may already have rendered using it). Fall back to localStorage.
  useEffect(() => {
    setMounted(true);
    let chosen: Lang | null = readCookie();
    if (!chosen) {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored === "en" || stored === "mr") chosen = stored;
      } catch {
        // ignore
      }
    }
    if (chosen && chosen !== defaultLang) {
      setLangState(chosen);
    }
    // Sync cookie + localStorage so they don't drift
    if (chosen) {
      writeCookie(chosen);
      try { localStorage.setItem(STORAGE_KEY, chosen); } catch {}
    }
  }, [defaultLang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
    writeCookie(next);
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
    return {
      lang: "en",
      setLang: () => {},
      t: (key) => translate(key, "en"),
      mounted: false,
    };
  }
  return ctx;
}
