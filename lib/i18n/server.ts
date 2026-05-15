// Server-side i18n helper.
//
// Use in server components (any file without "use client") to translate strings
// based on the user's selected language. Reads the rupyz_lang cookie.
//
// Usage:
//   const { t, lang } = await getT();
//   return <h1>{t("loading.page_title")}</h1>;
//
// If the cookie is missing or invalid, defaults to English.

import { cookies } from "next/headers";
import { translate, type Lang } from "./dictionary";

export async function getT(): Promise<{
  lang: Lang;
  t: (key: string, vars?: Record<string, string | number>) => string;
}> {
  let lang: Lang = "en";
  try {
    // Next 15+ returns Promise; Next 14 returns sync — await works for both.
    const store = await cookies();
    const cookieValue = store.get("rupyz_lang")?.value;
    if (cookieValue === "mr" || cookieValue === "en") {
      lang = cookieValue;
    }
  } catch {
    // cookies() may throw in some contexts (e.g. static rendering). Default to en.
  }

  return {
    lang,
    t: (key, vars) => translate(key, lang, vars),
  };
}
