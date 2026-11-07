import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../core/db';
import { alive, nowIso, save, uid } from '../../core/repo';
import { addDays, toDateStr, todayStr } from '../../core/dates';
import { translate } from '../../core/i18n';
import {
  DEFAULT_SETTINGS, type Gig, type Invoice, type InvoiceKind, type MemberId, type Package, type PartySnapshot, type Payment,
  type Product, type Quote, type QuoteLine, type Settings,
} from '../../core/types';
import { changeStage, personLabel } from '../bookings/data';
import { findConflicts } from '../bookings/domain/conflicts';
import { runTaskSync } from '../bookings/domain/taskSync';
import {
  acceptedLines, cancellationPct, computeTotals, creditLines, depositLines, dueDateFrom, finalLines, finaliseProblems,
  invoiceTotals, nextNumber, paidAmount, quoteTotals, sellerSnapshot, seriesFor,
} from './domain/money';

const EMPTY: never[] = [];
export const useInvoices = () => alive(useLiveQuery(() => db.invoices.toArray(), []) ?? EMPTY) as Invoice[];
export const usePayments = () => alive(useLiveQuery(() => db.payments.toArray(), []) ?? EMPTY) as Payment[];
export const useAllQuotes = () => alive(useLiveQuery(() => db.quotes.toArray(), []) ?? EMPTY) as Quote[];
export const usePackages = () => alive(useLiveQuery(() => db.packages.toArray(), []) ?? EMPTY) as Package[];
export const useProducts = () => alive(useLiveQuery(() => db.products.toArray(), []) ?? EMPTY) as Product[];

async function settings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...((await db.settings.get('settings')) ?? {}) };
}

export async function clientSnapshotForGig(gig: Gig): Promise<PartySnapshot> {
  const person = gig.clientPersonId ? await db.persons.get(gig.clientPersonId) : undefined;
  const org = gig.clientOrganisationId ? await db.organisations.get(gig.clientOrganisationId) : undefined;
  if (org) {
    return { name: org.name, attention: person ? personLabel(person) : undefined, address: org.billingAddress ?? '',
      email: org.invoiceEmail || person?.email, phone: person?.phone, vatId: org.vatNumber, kvk: org.kvk };
  }
  return { name: person ? personLabel(person) : gig.title, address: '', email: person?.email, phone: person?.phone };
}

export function productLine(p: Product, lang: 'nl' | 'en', qty = 1, optional = false): QuoteLine {
  return { id: uid(), description: (lang === 'en' && p.nameEn) || p.name, quantity: qty, unit: p.unit, unitPrice: p.price,
    vatRate: p.vatRate, optional: optional || !!p.optionalByDefault, selected: false, productId: p.id };
}

export function packageLines(pkg: Package, products: Product[], lang: 'nl' | 'en'): QuoteLine[] {
  return pkg.items.flatMap((it) => {
    const p = products.find((x) => x.id === it.productId);
    return p ? [{ ...productLine(p, lang, it.quantity, it.optional), packageId: pkg.id }] : [];
  });
}

/** New draft quote for a gig, pre-filled from the gig, client and the best package. */
export async function createQuoteForGig(gigId: string): Promise<Quote> {
  const s = await settings();
  const gig = (await db.gigs.get(gigId))!;
  const person = gig.clientPersonId ? await db.persons.get(gig.clientPersonId) : undefined;
  const lang = person?.language ?? s.language;
  const pkgs = alive(await db.packages.toArray()).filter((p) => p.active);
  const products = alive(await db.products.toArray());
  const pkg = pkgs.find((p) => p.eventTypes.includes(gig.eventType)) ?? pkgs[0];
  const existing = alive(await db.quotes.where('gigId').equals(gigId).toArray());
  for (const q of existing) if (q.status === 'draft' || q.status === 'sent') await save<Quote>('quotes', { ...q, status: 'superseded' });
  return save<Quote>('quotes', {
    gigId, version: existing.reduce((m, q) => Math.max(m, q.version), 0) + 1, status: 'draft', language: lang,
    lines: pkg ? packageLines(pkg, products, lang) : [], vatMode: s.vatMode, depositPct: s.depositPct,
    validUntil: toDateStr(addDays(new Date(), s.quoteValidDays)), client: await clientSnapshotForGig(gig),
  });
}

/** Copy a quote into a new draft version (the old one is superseded). */
export async function newQuoteVersion(q: Quote): Promise<Quote> {
  const s = await settings();
  if (q.status === 'draft' || q.status === 'sent') await save<Quote>('quotes', { ...q, status: 'superseded' });
  const all = alive(await db.quotes.where('gigId').equals(q.gigId).toArray());
  const { id: _id, number: _n, sentAt: _s, acceptedAt: _a, acceptedBy: _b, acceptedVia: _v, acceptedNote: _no, issueDate: _i, seller: _se, ...rest } = q;
  return save<Quote>('quotes', { ...rest, version: all.reduce((m, x) => Math.max(m, x.version), 0) + 1, status: 'draft',
    lines: q.lines.map((l) => ({ ...l, id: uid() })), validUntil: toDateStr(addDays(new Date(), s.quoteValidDays)), vatMode: s.vatMode });
}

export async function assignQuoteNumber(q: Quote, me: MemberId) {
  if (q.number) return q.number;
  const all = await db.quotes.toArray();
  return nextNumber(seriesFor('quote', new Date().getFullYear(), me), all.map((x) => x.number));
}

/** Freeze and mark the quote as sent; gig moves to "quote sent". */
export async function markQuoteSent(q: Quote, me: MemberId): Promise<Quote> {
  const s = await settings();
  const saved = await save<Quote>('quotes', { ...q, number: await assignQuoteNumber(q, me), status: q.status === 'draft' ? 'sent' : q.status,
    issueDate: q.issueDate ?? todayStr(), sentAt: q.sentAt ?? nowIso(), seller: sellerSnapshot(s), vatMode: q.vatMode ?? s.vatMode });
  const gig = await db.gigs.get(q.gigId);
  if (gig && ['enquiry', 'option'].includes(gig.stage)) await changeStage(gig, { to: 'quote_sent' });
  if (gig && gig.stage === 'quote_sent') await save<Gig>('gigs', { ...(await db.gigs.get(q.gigId))!, quoteSentAt: saved.sentAt });
  runTaskSync();
  return saved;
}

export interface AcceptanceInput { name: string; via: NonNullable<Quote['acceptedVia']>; note?: string; selected: string[] }

/** Mark the quote accepted (with the chosen extras) and copy fee + deposit to the gig. Does not change the gig stage. */
export async function recordQuoteAcceptance(q: Quote, me: MemberId, a: AcceptanceInput): Promise<Quote> {
  const s = await settings();
  const lines = q.lines.map((l) => (l.optional ? { ...l, selected: a.selected.includes(l.id) } : l));
  const accepted = await save<Quote>('quotes', { ...q, lines, status: 'accepted', acceptedAt: nowIso(), acceptedBy: a.name, acceptedVia: a.via,
    acceptedNote: a.note, number: await assignQuoteNumber(q, me), issueDate: q.issueDate ?? todayStr(), seller: q.seller ?? sellerSnapshot(s) });
  const gig = await db.gigs.get(q.gigId);
  if (gig) {
    const total = quoteTotals(accepted).total;
    await save<Gig>('gigs', { ...gig, agreedFee: total, deposit: Math.round((total * (accepted.depositPct ?? s.depositPct)) / 100) });
  }
  return accepted;
}

/** Confirm the gig unless that would create a hard conflict. */
export async function confirmGigIfFree(gigId: string, note: string): Promise<'ok' | 'conflict'> {
  const s = await settings();
  const fresh = await db.gigs.get(gigId);
  if (!fresh || !['enquiry', 'option', 'quote_sent'].includes(fresh.stage)) return 'ok';
  const gigs = alive(await db.gigs.toArray());
  const blocks = alive(await db.availability.toArray());
  if (findConflicts({ ...fresh, stage: 'confirmed' }, gigs, blocks, s).some((c) => c.level === 'hard')) return 'conflict';
  await changeStage(fresh, { to: 'confirmed', note });
  return 'ok';
}

/**
 * Record the client's acceptance. Returns 'conflict' when the gig could not be confirmed automatically,
 * and 'contract' when this event type needs a signed contract first (App 4).
 */
export async function acceptQuote(q: Quote, me: MemberId, a: AcceptanceInput): Promise<'ok' | 'conflict' | 'contract'> {
  const accepted = await recordQuoteAcceptance(q, me, a);
  const gig = await db.gigs.get(q.gigId);
  if (!gig) return 'ok';
  const { flowForGig, onQuoteAccepted } = await import('../contracts/data');
  if ((await flowForGig(gig)) !== 'none') {
    const r = await onQuoteAccepted(accepted, me, a);
    runTaskSync();
    return r;
  }
  const r = await confirmGigIfFree(gig.id, `${a.name} (${a.via})`);
  runTaskSync();
  return r;
}

export async function declineQuote(q: Quote, reason: string, note?: string) {
  await save<Quote>('quotes', { ...q, status: 'declined', declinedReason: reason });
  const gig = await db.gigs.get(q.gigId);
  if (gig && ['enquiry', 'option', 'quote_sent'].includes(gig.stage)) await changeStage(gig, { to: 'lost', reason, note });
  runTaskSync();
}

// ---------------------------------------------------------------------------
// Invoices

export async function createInvoiceFromQuote(q: Quote, kind: Extract<InvoiceKind, 'standard' | 'deposit' | 'final'>, pct?: number): Promise<Invoice> {
  const s = await settings();
  const gig = await db.gigs.get(q.gigId);
  const lang = q.language ?? s.language;
  const title = gig?.title ?? '';
  let lines: QuoteLine[];
  if (kind === 'deposit') {
    const p = pct ?? q.depositPct ?? s.depositPct;
    lines = depositLines(q, p, () => translate(lang, 'i.depositLabel', { pct: p, title }), uid);
  } else if (kind === 'final') {
    const deposits = alive(await db.invoices.where('quoteId').equals(q.id).toArray()).filter((i) => i.kind === 'deposit' && i.status !== 'draft' && i.status !== 'credited');
    lines = finalLines(q, deposits, (nr) => translate(lang, 'i.deductLabel', { number: nr }), uid);
  } else {
    lines = acceptedLines(q, uid);
  }
  return save<Invoice>('invoices', {
    kind, gigId: q.gigId, quoteId: q.id, personId: gig?.clientPersonId, organisationId: gig?.clientOrganisationId, status: 'draft',
    language: lang, supplyDate: gig?.date, lines, client: q.client ?? (gig ? await clientSnapshotForGig(gig) : { name: '' }), vatMode: s.vatMode,
  });
}

export async function createBlankInvoice(gigId?: string): Promise<Invoice> {
  const s = await settings();
  const gig = gigId ? await db.gigs.get(gigId) : undefined;
  return save<Invoice>('invoices', { kind: 'standard', gigId, personId: gig?.clientPersonId, organisationId: gig?.clientOrganisationId, status: 'draft',
    language: s.language, supplyDate: gig?.date, lines: [], client: gig ? await clientSnapshotForGig(gig) : { name: '', address: '' }, vatMode: s.vatMode });
}

/** Cancellation by the client: fee from the scale minus deposits already invoiced. Consumers get the softer scale. */
export async function cancellationPreview(q: Quote, override?: { pct: number; days: number }) {
  const s = await settings();
  const gig = await db.gigs.get(q.gigId);
  const total = quoteTotals(q).total;
  const business = !!gig?.clientOrganisationId;
  const scale = !business && s.cancellationScaleConsumer?.length ? s.cancellationScaleConsumer : s.cancellationScale;
  const { pct, days } = override ?? cancellationPct(scale, gig?.date ?? todayStr());
  const fee = Math.round((total * pct) / 100);
  const deposits = alive(await db.invoices.where('quoteId').equals(q.id).toArray()).filter((i) => i.kind === 'deposit' && i.status !== 'draft' && i.status !== 'credited');
  const depositTotal = deposits.reduce((sum, d) => sum + invoiceTotals(d).total, 0);
  return { pct, days, fee, total, deposits, depositTotal, gig };
}

export async function createCancellationInvoice(q: Quote, cancelGig: boolean, override?: { pct: number; days: number }): Promise<Invoice> {
  const s = await settings();
  const pv = await cancellationPreview(q, override);
  const lang = q.language ?? s.language;
  const tt = quoteTotals(q);
  // One fee line per VAT rate of the agreed quote, so VAT follows the quote.
  const lines: QuoteLine[] = tt.perRate.filter((r) => r.base > 0).map((r) => ({
    id: uid(), description: translate(lang, 'i.cancelLabel', { pct: pv.pct, days: Math.max(0, pv.days) }), quantity: 1, unit: 'flat',
    unitPrice: Math.round((r.base * pv.pct) / 100), vatRate: r.rate,
  }));
  for (const d of pv.deposits) for (const l of d.lines) {
    lines.push({ id: uid(), description: translate(lang, 'i.deductLabel', { number: d.number ?? '' }), quantity: 1, unit: 'flat', unitPrice: -Math.round(l.quantity * l.unitPrice), vatRate: l.vatRate, refInvoiceId: d.id });
  }
  const inv = await save<Invoice>('invoices', { kind: 'cancellation', gigId: q.gigId, quoteId: q.id, personId: pv.gig?.clientPersonId, organisationId: pv.gig?.clientOrganisationId,
    status: 'draft', language: lang, supplyDate: pv.gig?.date, lines, client: q.client ?? { name: '' }, vatMode: s.vatMode,
    reason: translate(lang, 'i.cancelLabel', { pct: pv.pct, days: Math.max(0, pv.days) }) });
  if (cancelGig && pv.gig && ['confirmed', 'option', 'quote_sent', 'enquiry'].includes(pv.gig.stage)) {
    if (pv.gig.stage === 'confirmed') await changeStage(pv.gig, { to: 'cancelled', reason: 'event_cancelled', extra: { cancelledBy: 'client', cancellationFee: pv.fee } });
    else await changeStage(pv.gig, { to: 'lost', reason: 'event_cancelled' });
  }
  return inv;
}

export async function createCreditNote(inv: Invoice, reason: string): Promise<Invoice> {
  return save<Invoice>('invoices', { kind: 'credit_note', gigId: inv.gigId, quoteId: inv.quoteId, creditsInvoiceId: inv.id, personId: inv.personId,
    organisationId: inv.organisationId, status: 'draft', language: inv.language, supplyDate: inv.supplyDate, lines: creditLines(inv, uid),
    client: inv.client, vatMode: inv.vatMode, reason });
}

export async function previewNumber(inv: Invoice, me: MemberId) {
  if (inv.number) return inv.number;
  const year = Number((inv.issueDate ?? todayStr()).slice(0, 4));
  return nextNumber(seriesFor('invoice', year, me), (await db.invoices.toArray()).map((i) => i.number));
}

/** Give the invoice its number and lock it. Returns problems if it cannot be finalised. */
export async function finaliseInvoice(inv: Invoice, me: MemberId): Promise<{ ok: true; invoice: Invoice } | { ok: false; problems: string[] }> {
  const s = await settings();
  const problems = finaliseProblems(inv, s);
  if (problems.length) return { ok: false, problems };
  const issueDate = inv.issueDate ?? todayStr();
  const year = Number(issueDate.slice(0, 4));
  const gig = inv.gigId ? await db.gigs.get(inv.gigId) : undefined;
  const result = await db.transaction('rw', db.invoices, db.audit, async () => {
    const series = seriesFor('invoice', year, me);
    const number = nextNumber(series, (await db.invoices.toArray()).map((i) => i.number));
    return save<Invoice>('invoices', {
      ...inv, number, series, issueDate, status: 'sent', finalisedAt: nowIso(), seller: sellerSnapshot(s),
      dueDate: inv.kind === 'credit_note' ? undefined : (inv.dueDate ?? dueDateFrom(issueDate, s.paymentTermDays, gig?.date, inv.kind === 'deposit')),
    });
  });
  // Credit note: mark the original as credited when fully credited.
  if (result.kind === 'credit_note' && result.creditsInvoiceId) {
    const orig = await db.invoices.get(result.creditsInvoiceId);
    if (orig && invoiceTotals(orig).total + invoiceTotals(result).total === 0) await save<Invoice>('invoices', { ...orig, status: 'credited' });
  }
  if (gig) {
    if (result.kind === 'deposit') await save<Gig>('gigs', { ...gig, deposit: invoiceTotals(result).total });
    if ((result.kind === 'final' || result.kind === 'standard') && ['confirmed', 'played'].includes(gig.stage) && gig.date <= todayStr()) {
      if (gig.stage === 'confirmed') await changeStage(gig, { to: 'played' });
      await changeStage((await db.gigs.get(gig.id))!, { to: 'invoiced' });
    }
  }
  runTaskSync();
  return { ok: true, invoice: result };
}

export async function markInvoiceSent(inv: Invoice) {
  if (!inv.sentAt) await save<Invoice>('invoices', { ...inv, sentAt: nowIso() });
}

export async function registerPayment(inv: Invoice, p: { amount: number; date: string; method: Payment['method']; note?: string; receivedBy?: Payment['receivedBy']; bankLineId?: string }): Promise<Payment> {
  const payment = await save<Payment>('payments', { invoiceId: inv.id, ...p });
  const payments = alive(await db.payments.where('invoiceId').equals(inv.id).toArray());
  const paid = paidAmount(inv.id, payments);
  const total = invoiceTotals(inv).total;
  if (paid >= total && inv.status === 'sent') await save<Invoice>('invoices', { ...inv, status: 'paid', paidAt: nowIso() });
  await syncGigPaid(inv.gigId, inv.kind === 'deposit' && paid >= total ? p.date : undefined);
  runTaskSync();
  return payment;
}

/** Gig becomes "paid" when every non-credited invoice for it is paid; deposit date is copied. */
async function syncGigPaid(gigId?: string, depositPaidOn?: string) {
  if (!gigId) return;
  let gig = await db.gigs.get(gigId);
  if (!gig) return;
  if (depositPaidOn && !gig.depositPaidAt) gig = await save<Gig>('gigs', { ...gig, depositPaidAt: depositPaidOn });
  const invs = alive(await db.invoices.where('gigId').equals(gigId).toArray()).filter((i) => i.status !== 'draft' && i.kind !== 'credit_note' && i.status !== 'credited');
  const hasFinal = invs.some((i) => i.kind === 'final' || i.kind === 'standard' || i.kind === 'cancellation');
  if (hasFinal && invs.every((i) => i.status === 'paid') && gig.stage === 'invoiced') await changeStage(gig, { to: 'paid' });
}

export const totalsOf = { quote: quoteTotals, invoice: invoiceTotals, lines: computeTotals };
