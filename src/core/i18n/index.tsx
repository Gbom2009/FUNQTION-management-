import { createContext, useContext, type ReactNode } from 'react';
import { nl, type Key } from './nl';
import { en } from './en';
import type { Lang } from '../types';

const dicts = { nl, en } as const;

export type T = (key: Key, params?: Record<string, string | number>) => string;

export function translate(lang: Lang, key: Key, params?: Record<string, string | number>) {
  let s: string = dicts[lang][key] ?? nl[key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

const Ctx = createContext<{ lang: Lang; t: T }>({ lang: 'nl', t: (k, p) => translate('nl', k, p) });

export function I18nProvider({ lang, children }: { lang: Lang; children: ReactNode }) {
  const t: T = (k, p) => translate(lang, k, p);
  return <Ctx.Provider value={{ lang, t }}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);
export type { Key };
