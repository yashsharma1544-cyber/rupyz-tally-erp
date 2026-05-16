import { cookies } from "next/headers";
import { translate, type Lang } from "./dictionary";

type TFn = (key: string, vars?: Record<string, string | number>) => string;

/**
 * Returns a callable translator that also exposes .lang and .t for
 * backwards compatibility. All three usage patterns work:
 *   const t = await getT();          t("key")    // call as function
 *   const { t } = await getT();      t("key")    // destructure
 *   const { lang } = await getT();               // just the language
 */
export async function getT(): Promise<TFn & { lang: Lang; t: TFn }> {
  const cookieStore = await cookies();
  const cookie = cookieStore.get("rupyz_lang");
  const lang: Lang = cookie?.value === "mr" ? "mr" : "en";

  const fn = ((key: string, vars?: Record<string, string | number>) =>
    translate(key, lang, vars)) as TFn & { lang: Lang; t: TFn };
  fn.lang = lang;
  fn.t = fn;
  return fn;
}
