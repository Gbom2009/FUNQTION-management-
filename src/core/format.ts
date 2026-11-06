import type { Lang } from './types';
import { parseDate } from './dates';

const loc = (l: Lang) => (l === 'nl' ? 'nl-NL' : 'en-GB');

export const euro = (cents: number | undefined, lang: Lang) =>
  cents == null ? '—' : new Intl.NumberFormat(loc(lang), { style: 'currency', currency: 'EUR' }).format(cents / 100);

export const centsFromInput = (v: string): number | undefined => {
  if (v.trim() === '') return undefined;
  const n = Number(v.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : undefined;
};
export const inputFromCents = (c?: number) => (c == null ? '' : String(c / 100).replace('.', ','));

export const fmtDate = (d: string | undefined, lang: Lang, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) =>
  d ? new Intl.DateTimeFormat(loc(lang), opts).format(parseDate(d)) : '—';

export const fmtDateLong = (d: string | undefined, lang: Lang) =>
  fmtDate(d, lang, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

export const fmtDateTime = (iso: string | undefined, lang: Lang) =>
  iso ? new Intl.DateTimeFormat(loc(lang), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '—';

export const fmtMonth = (y: number, m: number, lang: Lang) =>
  new Intl.DateTimeFormat(loc(lang), { month: 'long', year: 'numeric' }).format(new Date(y, m, 1));

export const personName = (p?: { firstName: string; lastName: string } | null) =>
  p ? `${p.firstName} ${p.lastName}`.trim() : '';
