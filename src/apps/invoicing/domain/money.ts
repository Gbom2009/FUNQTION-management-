import type { Invoice, Payment, PartySnapshot, Quote, QuoteLine, Settings, VatMode } from '../../../core/types';
import { addDays, daysBetween, parseDate, toDateStr } from '../../../core/dates';

// Pure money logic for quotes and invoices. All amounts in cents.
// Rounding: per line, then VAT per rate on the summed line totals (one rounding
// per rate, as Dutch invoices show VAT per rate).

export const lineGross = (l: Pick<QuoteLine, 'quantity' | 'unitPrice'>) => Math.round(l.quantity * l.unitPrice);
export const lineNet = (l: Pick<QuoteLine, 'quantity' | 'unitPrice' | 'discountPct'>) =>
  Math.round(lineGross(l) * (1 - (l.discountPct ?? 0) / 100));

/** Lines that count towards the total: non-optional ones plus chosen extras. */
export const countedLines = (lines: QuoteLine[], includeAllOptional = false) =>
  lines.filter((l) => !l.optional || includeAllOptional || l.selected);

export interface Totals {
  gross: number;          // sum of line totals (after line discounts)
  discount: number;       // total-level discount (positive number)
  ex: number;             // excl. VAT after all discounts
  perRate: { rate: number; base: number; vat: number }[];
  vat: number;
  total: number;          // incl. VAT
}

export function computeTotals(lines: QuoteLine[], opts: { discountPct?: number; vatMode: VatMode } = { vatMode: 'vat' }): Totals {
  const pct = opts.discountPct ?? 0;
  const byRate = new Map<number, number>();
  let gross = 0;
  for (const l of lines) {
    const net = lineNet(l);
    gross += net;
    const rate = opts.vatMode === 'vat' ? l.vatRate : 0;
    byRate.set(rate, (byRate.get(rate) ?? 0) + net);
  }
  const perRate = Array.from(byRate.entries()).sort((a, b) => b[0] - a[0]).map(([rate, base]) => {
    const discounted = Math.round(base * (1 - pct / 100));
    return { rate, base: discounted, vat: Math.round((discounted * rate) / 100) };
  });
  const ex = perRate.reduce((s, r) => s + r.base, 0);
  const vat = perRate.reduce((s, r) => s + r.vat, 0);
  return { gross, discount: gross - ex, ex, perRate, vat, total: ex + vat };
}

export const quoteTotals = (q: Pick<Quote, 'lines' | 'discountPct' | 'vatMode'>, withAllExtras = false) =>
  computeTotals(countedLines(q.lines, withAllExtras), { discountPct: q.discountPct, vatMode: q.vatMode ?? 'private' });

export const invoiceTotals = (inv: Pick<Invoice, 'lines' | 'vatMode'>) => computeTotals(inv.lines, { vatMode: inv.vatMode });

export function paidAmount(invoiceId: string, payments: Payment[]) {
  return payments.filter((p) => p.invoiceId === invoiceId && !p.deletedAt).reduce((s, p) => s + p.amount, 0);
}

export type InvoiceState = 'draft' | 'sent' | 'partially_paid' | 'overdue' | 'paid' | 'credited';

/** Display state, derived from status, due date and payments. */
export function invoiceState(inv: Invoice, payments: Payment[], today = toDateStr(new Date())): InvoiceState {
  if (inv.status === 'draft') return 'draft';
  if (inv.status === 'credited') return 'credited';
  if (inv.kind === 'credit_note') return 'paid';
  const total = invoiceTotals(inv).total;
  const paid = paidAmount(inv.id, payments);
  if (inv.status === 'paid' || paid >= total) return 'paid';
  if (inv.dueDate && inv.dueDate < today) return 'overdue';
  return paid > 0 ? 'partially_paid' : 'sent';
}

// ---------------------------------------------------------------------------
// Numbering: gapless per series. Without a server, two devices could create
// the same number, so each member gets their own series (F2026-G, F2026-C).
// Several consecutive series are allowed by the Belastingdienst.

export function seriesFor(kind: 'invoice' | 'quote', year: number, memberId: string) {
  return `${kind === 'invoice' ? 'F' : 'O'}${year}-${memberId.slice(0, 1).toUpperCase()}`;
}

export function nextNumber(series: string, existing: (string | undefined)[]) {
  const prefix = `${series}-`;
  const max = existing.filter((n): n is string => !!n && n.startsWith(prefix))
    .reduce((m, n) => Math.max(m, Number(n.slice(prefix.length)) || 0), 0);
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

// ---------------------------------------------------------------------------
// Building invoices from quotes

const cloneLine = (l: QuoteLine, id: () => string): QuoteLine => ({ ...l, id: id(), optional: false, selected: undefined });

/** Accepted quote lines as invoice lines, with the total discount pushed into each line. */
export function acceptedLines(q: Quote, id: () => string): QuoteLine[] {
  const pct = q.discountPct ?? 0;
  return countedLines(q.lines).map((l) => {
    const c = cloneLine(l, id);
    if (pct) c.discountPct = Math.round((100 - (100 - (l.discountPct ?? 0)) * (1 - pct / 100)) * 100) / 100;
    return c;
  });
}

/** A deposit invoice: x% of the accepted total, one line per VAT rate. */
export function depositLines(q: Quote, pct: number, label: (rate: number) => string, id: () => string): QuoteLine[] {
  const t = quoteTotals(q);
  return t.perRate.filter((r) => r.base > 0).map((r) => ({
    id: id(), description: label(r.rate), quantity: 1, unit: 'flat' as const,
    unitPrice: Math.round((r.base * pct) / 100), vatRate: r.rate,
  }));
}

/** Final invoice: accepted lines minus every earlier deposit invoice (per rate). */
export function finalLines(q: Quote, deposits: Invoice[], label: (num: string) => string, id: () => string): QuoteLine[] {
  const lines = acceptedLines(q, id);
  for (const d of deposits) {
    for (const l of d.lines) {
      lines.push({ id: id(), description: label(d.number ?? ''), quantity: 1, unit: 'flat', unitPrice: -lineNet(l), vatRate: l.vatRate, refInvoiceId: d.id });
    }
  }
  return lines;
}

/** Credit note mirroring (part of) an invoice with negative amounts. */
export function creditLines(inv: Invoice, id: () => string, factor = 1): QuoteLine[] {
  return inv.lines.map((l) => ({ ...l, id: id(), unitPrice: -Math.round(l.unitPrice * factor) }));
}

/** Cancellation fee percentage from the scale, by days between today and the gig. */
export function cancellationPct(scale: Settings['cancellationScale'], gigDate: string, today = toDateStr(new Date())) {
  const days = daysBetween(parseDate(today), parseDate(gigDate));
  const sorted = [...scale].sort((a, b) => b.daysBefore - a.daysBefore);
  for (const s of sorted) if (days >= s.daysBefore) return { pct: s.pct, days };
  return { pct: sorted[sorted.length - 1]?.pct ?? 100, days };
}

export const dueDateFrom = (issueDate: string, termDays: number, gigDate?: string, beforeGig = false) => {
  let due = toDateStr(addDays(parseDate(issueDate), termDays));
  if (beforeGig && gigDate && gigDate < due) due = toDateStr(addDays(parseDate(gigDate), -1));
  if (due < issueDate) due = issueDate;
  return due;
};

export function sellerSnapshot(s: Settings): PartySnapshot {
  return {
    name: s.businessName,
    attention: s.legalNames,
    address: [s.address, [s.postcode, s.city].filter(Boolean).join(' ')].filter(Boolean).join('\n'),
    email: s.bizEmail, phone: s.bizPhone, website: s.website,
    kvk: s.vatMode === 'private' ? undefined : s.kvk,
    vatId: s.vatMode === 'vat' ? s.vatId : undefined,
    iban: s.iban, accountHolder: s.accountHolder || s.legalNames || s.businessName,
  };
}

/** Problems that block finalising a document (Dutch invoice requirements). */
export function finaliseProblems(inv: Pick<Invoice, 'client' | 'lines' | 'vatMode' | 'kind' | 'creditsInvoiceId'>, s: Settings) {
  const p: ('client_name' | 'client_address' | 'lines' | 'seller_address' | 'kvk' | 'vat_id' | 'credit_ref')[] = [];
  if (!inv.client?.name?.trim()) p.push('client_name');
  if (!inv.client?.address?.trim()) p.push('client_address');
  if (!inv.lines.length) p.push('lines');
  if (!s.address || !s.city) p.push('seller_address');
  if (inv.vatMode !== 'private' && !s.kvk) p.push('kvk');
  if (inv.vatMode === 'vat' && !s.vatId) p.push('vat_id');
  if (inv.kind === 'credit_note' && !inv.creditsInvoiceId) p.push('credit_ref');
  return p;
}
