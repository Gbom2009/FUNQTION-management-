import { translate as suiteTranslate, type Key as SuiteKey } from "../../../core/i18n";
import { useApp } from "../store/app";

// Maps' strings live in the suite dictionaries (src/core/i18n/nl.ts / en.ts)
// under the "maps." prefix, so tsc checks that English has every key.
export type Lang = "nl" | "en";
type Strip<T> = T extends `maps.${infer R}` ? R : never;
export type Key = Strip<SuiteKey>;

export function translate(lang: Lang, key: Key): string {
  return suiteTranslate(lang, `maps.${key}` as SuiteKey);
}

export function useT() {
  const lang = useApp((s) => s.lang);
  return (key: Key) => translate(lang, key);
}
