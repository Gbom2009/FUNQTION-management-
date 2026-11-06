import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../core/db';
import { alive, nowIso, save, uid } from '../../core/repo';
import { useSession } from '../../core/session';
import type {
  Asset, BankAccount, BankLine, BankRule, Category, Expense, Gig, HourEntry, Invoice, MemberId, PartnerEntry, Payer, Payment, Receipt, Trip, VatPeriod, Venue,
} from '../../core/types';
import { lineHash, parseStatement, type ParseResult } from './domain/bank';
import type { LedgerData } from './domain/ledger';
import { sha256 } from './ocr';
import { registerPayment } from '../invoicing/data';

const EMPTY: never[] = [];
const live = <T>(q: () => Promise<T[]>, deps: unknown[] = []) => alive((useLiveQuery(q, deps) ?? EMPTY) as (T & { deletedAt?: string | null })[]) as T[];

export const useCategories = () => live<Category>(() => db.categories.toArray()).sort((a, b) => a.name.localeCompare(b.name));
export const useExpenses = () => live<Expense>(() => db.expenses.toArray());
export const useBankAccounts = () => live<BankAccount>(() => db.bankAccounts.toArray());
export const useBankLines = () => live<BankLine>(() => db.bankLines.toArray());
export const useBankRules = () => live<BankRule>(() => db.bankRules.toArray());
export const useTrips = () => live<Trip>(() => db.trips.toArray());
export const useHours = () => live<HourEntry>(() => db.hours.toArray());
export const useAssets = () => live<Asset>(() => db.assets.toArray());
export const usePartnerEntries = () => live<PartnerEntry>(() => db.partnerEntries.toArray());
export const useVatPeriods = () => live<VatPeriod>(() => db.vatPeriods.toArray());

/** Everything the ledger maths needs, live. */
export function useLedger(): LedgerData | null {
  const { settings } = useSession();
  const invoices = live<Invoice>(() => db.invoices.toArray());
  const payments = live<Payment>(() => db.payments.toArray());
  const expenses = useExpenses();
  const trips = useTrips();
  const assets = useAssets();
  const partnerEntries = usePartnerEntries();
  const gigs = live<Gig>(() => db.gigs.toArray());
  const categories = useCategories();
  if (!categories.length) return null;
  return { invoices, payments, expenses, trips, assets, partnerEntries, gigs, categories, settings };
}

// ---------------------------------------------------------------------------
// Expenses & receipts

export async function storeReceipt(blob: Blob, name?: string): Promise<Receipt> {
  return save<Receipt>('receipts', { blob, mime: blob.type || 'image/jpeg', size: blob.size, sha256: await sha256(blob), name });
}

export async function saveExpense(e: Partial<Expense> & Pick<Expense, 'date' | 'supplier' | 'categoryId' | 'amount' | 'paidBy'>): Promise<Expense> {
  const saved = await save<Expense>('expenses', {
    vatAmount: 0, vatRate: 0, businessPct: 100, receiptIds: [], ...e,
    status: (e.receiptIds?.length ?? 0) > 0 ? 'ok' : 'missing_receipt',
  } as Expense);
  for (const rid of saved.receiptIds) {
    const r = await db.receipts.get(rid);
    if (r && r.expenseId !== saved.id) await save<Receipt>('receipts', { ...r, expenseId: saved.id });
  }
  return saved;
}

/** Previous expenses from the same supplier, newest first (for pre-filling). */
export async function supplierMemory(supplier: string): Promise<Expense | undefined> {
  const s = supplier.trim().toLowerCase();
  if (s.length < 2) return undefined;
  const all = alive(await db.expenses.toArray());
  return all.filter((e) => e.supplier.toLowerCase() === s).sort((a, b) => b.date.localeCompare(a.date))[0];
}

export async function knownSuppliers(): Promise<string[]> {
  const all = alive(await db.expenses.toArray());
  return Array.from(new Set(all.map((e) => e.supplier).filter(Boolean)));
}

// ---------------------------------------------------------------------------
// Bank

export async function importStatement(accountId: string, text: string): Promise<ParseResult & { inserted: number; duplicates: number }> {
  const parsed = parseStatement(text);
  const batchId = uid();
  let inserted = 0;
  let duplicates = 0;
  const seen = new Map<string, number>();
  for (const l of parsed.lines) {
    const k = `${l.date}|${l.amount}|${l.counterparty}|${l.description}`;
    const occ = (seen.get(k) ?? 0) + 1;
    seen.set(k, occ);
    const hash = await lineHash(accountId, l, occ);
    if (await db.bankLines.where('hash').equals(hash).first()) { duplicates++; continue; }
    await save<BankLine>('bankLines', { accountId, ...l, hash, batchId, status: 'unmatched', matches: [] });
    inserted++;
  }
  await autoApplyRules();
  return { ...parsed, inserted, duplicates };
}

/** Apply "private / transfer / ignore" rules automatically; expense rules stay suggestions. */
export async function autoApplyRules() {
  const rules = alive(await db.bankRules.toArray()).filter((r) => r.action !== 'expense');
  if (!rules.length) return;
  for (const l of await db.bankLines.where('status').equals('unmatched').toArray()) {
    const text = `${l.counterparty} ${l.description}`.toLowerCase();
    const r = rules.find((x) => x.match && text.includes(x.match));
    if (r) await save<BankLine>('bankLines', { ...l, status: r.action === 'private' ? 'private' : r.action === 'transfer' ? 'transfer' : 'ignored' });
  }
}

export async function setLineStatus(l: BankLine, status: BankLine['status'], rememberAs?: string) {
  await save<BankLine>('bankLines', { ...l, status, matches: status === 'unmatched' ? [] : l.matches });
  if (rememberAs && status !== 'unmatched' && status !== 'matched') {
    await save<BankRule>('bankRules', { match: rememberAs, action: status === 'private' ? 'private' : status === 'transfer' ? 'transfer' : 'ignore' });
    await autoApplyRules();
  }
}

export async function matchLineToInvoice(l: BankLine, inv: Invoice, account: BankAccount | undefined) {
  const pay = await registerPayment(inv, { amount: l.amount, date: l.date, method: 'bank', receivedBy: account?.owner ?? 'business', bankLineId: l.id });
  await save<BankLine>('bankLines', { ...l, status: 'matched', matches: [{ type: 'payment', id: pay.id, amount: l.amount }] });
}

export async function matchLineToExpense(l: BankLine, e: Expense) {
  await save<Expense>('expenses', { ...e, bankLineId: l.id });
  await save<BankLine>('bankLines', { ...l, status: 'matched', matches: [{ type: 'expense', id: e.id, amount: l.amount }] });
}

export async function expenseFromLine(l: BankLine, account: BankAccount | undefined, categoryId: string, businessPct = 100, rememberAs?: string) {
  const cat = await db.categories.get(categoryId);
  const rate = cat?.defaultVatRate ?? 21;
  const amount = Math.abs(l.amount);
  const e = await saveExpense({ date: l.date, supplier: l.counterparty || l.description.slice(0, 40), description: l.description, categoryId, amount,
    vatRate: rate, vatAmount: Math.round((amount * rate) / (100 + rate)), businessPct, paidBy: account?.owner ?? 'business', bankLineId: l.id });
  await save<BankLine>('bankLines', { ...l, status: 'matched', matches: [{ type: 'expense', id: e.id, amount: l.amount }] });
  if (rememberAs) await save<BankRule>('bankRules', { match: rememberAs, action: 'expense', categoryId, businessPct });
  return e;
}

export async function partnerFromLine(l: BankLine, account: BankAccount | undefined, kind: PartnerEntry['kind'], memberId: MemberId) {
  const e = await save<PartnerEntry>('partnerEntries', { memberId, date: l.date, kind, amount: Math.abs(l.amount), note: l.description,
    toMemberId: kind === 'settlement' ? (memberId === 'gijs' ? 'coen' : 'gijs') : undefined });
  await save<BankLine>('bankLines', { ...l, status: 'matched', matches: [{ type: 'partner', id: e.id, amount: l.amount }] });
  void account;
}

// ---------------------------------------------------------------------------
// Trips

export async function saveTripForGig(gig: Gig, venue: Venue | undefined, driver: MemberId, km: number, roundTrip: boolean, from: string, parking?: number) {
  await save<Trip>('trips', { date: gig.date, gigId: gig.id, driver, from, to: venue ? [venue.name, venue.city].filter(Boolean).join(', ') : gig.title,
    purpose: `${gig.title} (${gig.reference})`, km, roundTrip, source: venue?.distanceKm?.[driver] === km ? 'venue' : 'manual', parking });
  if (venue && km > 0 && venue.distanceKm?.[driver] !== km) await save<Venue>('venues', { ...venue, distanceKm: { ...(venue.distanceKm ?? {}), [driver]: km } });
}

export const payerLabel = (p: Payer, business: string) => (p === 'business' ? business : p === 'gijs' ? 'Gijs' : 'Coen');
export { nowIso };
