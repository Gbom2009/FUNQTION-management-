import type {
  Asset, Category, Expense, Gig, HourEntry, Invoice, MemberId, PartnerEntry, Payment, Settings, SplitRule, Trip, VatMode,
} from '../../../core/types';
import { at, gigWindow, parseDate, toDateStr } from '../../../core/dates';
import { invoiceTotals } from '../../invoicing/domain/money';

// All bookkeeping maths for App 3. Pure functions over the stored records:
// reports are always computed from source documents, never stored twice.

export const MEMBERS: MemberId[] = ['gijs', 'coen'];
export const other = (m: MemberId): MemberId => (m === 'gijs' ? 'coen' : 'gijs');

// ---------------------------------------------------------------------------
// Periods

export type PeriodKind = 'month' | 'quarter' | 'year';
export interface Period { from: string; to: string; key: string }

export function periodOf(kind: PeriodKind, date: string): Period {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  if (kind === 'year') return { from: `${y}-01-01`, to: `${y}-12-31`, key: String(y) };
  if (kind === 'quarter') {
    const q = Math.floor((m - 1) / 3);
    const from = toDateStr(new Date(y, q * 3, 1));
    const to = toDateStr(new Date(y, q * 3 + 3, 0));
    return { from, to, key: `${y}-Q${q + 1}` };
  }
  return { from: toDateStr(new Date(y, m - 1, 1)), to: toDateStr(new Date(y, m, 0)), key: date.slice(0, 7) };
}

export const shiftPeriod = (kind: PeriodKind, p: Period, n: number): Period => {
  const d = parseDate(p.from);
  if (kind === 'year') d.setFullYear(d.getFullYear() + n);
  else d.setMonth(d.getMonth() + n * (kind === 'quarter' ? 3 : 1));
  return periodOf(kind, toDateStr(d));
};

export const within = (date: string | undefined, p: Period) => !!date && date >= p.from && date <= p.to;

// ---------------------------------------------------------------------------
// Profit split

export function ruleAt(s: Pick<Settings, 'splitRules'>, date: string): SplitRule {
  const rules = [...(s.splitRules?.length ? s.splitRules : [{ validFrom: '2000-01-01', method: 'fixed' as const, gijsPct: 50, soloPct: 80 }])]
    .sort((a, b) => a.validFrom.localeCompare(b.validFrom));
  return rules.filter((r) => r.validFrom <= date).pop() ?? rules[0];
}

/** Share (0..1) of a member in an item, given the rule and (optional) gig lineup. */
export function shareOf(member: MemberId, rule: SplitRule, performers?: MemberId[]): number {
  const fixed = member === 'gijs' ? rule.gijsPct / 100 : 1 - rule.gijsPct / 100;
  if (rule.method === 'by_lineup' && performers && performers.length === 1) {
    const solo = rule.soloPct / 100;
    return performers[0] === member ? solo + (1 - solo) * fixed : (1 - solo) * fixed;
  }
  return fixed;
}

// ---------------------------------------------------------------------------
// Amounts

export interface CostView {
  cash: number;        // business part actually paid (incl. VAT)
  costEx: number;      // cost for the P&L (excl. reclaimable VAT)
  deductible: number;  // fiscal cost (after partial-deduction rules)
  vatReclaim: number;  // input VAT (VAT mode only)
}

export function expenseView(e: Expense, cat: Category | undefined, vatMode: VatMode): CostView {
  const bp = e.businessPct / 100;
  const cash = Math.round(e.amount * bp);
  const reclaim = vatMode === 'vat' && !e.reverseCharge ? Math.round(e.vatAmount * bp) : 0;
  const costEx = cash - reclaim;
  const deductible = e.assetId ? 0 : Math.round((costEx * (cat?.deductiblePct ?? 100)) / 100);
  return { cash, costEx: e.assetId ? 0 : costEx, deductible, vatReclaim: reclaim };
}

export const tripKm = (t: Trip) => t.km * (t.roundTrip ? 2 : 1);
export const tripCost = (t: Trip, rateCents: number) => Math.round(tripKm(t) * rateCents) + (t.parking ?? 0);

/** Straight-line depreciation per month from the purchase month. */
export function depreciationBetween(a: Asset, from: string, to: string): number {
  const base = Math.round((a.cost - a.residual) * (a.businessPct / 100));
  if (base <= 0 || a.lifeYears <= 0) return 0;
  const months = a.lifeYears * 12;
  const perMonth = base / months;
  const start = parseDate(a.purchaseDate);
  const startIdx = start.getFullYear() * 12 + start.getMonth();
  const endIdx = startIdx + months - 1;
  const dispIdx = a.disposedAt ? parseDate(a.disposedAt).getFullYear() * 12 + parseDate(a.disposedAt).getMonth() : Infinity;
  const f = parseDate(from); const t = parseDate(to);
  const lo = Math.max(startIdx, f.getFullYear() * 12 + f.getMonth());
  const hi = Math.min(endIdx, t.getFullYear() * 12 + t.getMonth(), dispIdx);
  return hi < lo ? 0 : Math.round(perMonth * (hi - lo + 1));
}

export function bookValue(a: Asset, asOf: string): number {
  if (a.disposedAt && a.disposedAt <= asOf) return 0;
  return Math.round(a.cost * (a.businessPct / 100)) - depreciationBetween(a, a.purchaseDate, asOf);
}

// ---------------------------------------------------------------------------
// Profit & loss

export interface LedgerData {
  invoices: Invoice[];
  payments: Payment[];
  expenses: Expense[];
  trips: Trip[];
  assets: Asset[];
  partnerEntries: PartnerEntry[];
  gigs: Gig[];
  categories: Category[];
  settings: Settings;
}

const finalised = (i: Invoice) => i.status !== 'draft' && !i.deletedAt;

export interface Pnl {
  revenueEx: number;         // invoiced, excl. VAT (accrual)
  revenueByType: Record<string, number>;
  costsByCategory: Record<string, { costEx: number; deductible: number }>;
  costsEx: number;
  deductibleCosts: number;
  mileage: number;
  km: number;
  depreciation: number;
  result: number;            // revenue − costs − mileage − depreciation (P&L view)
  fiscalResult: number;      // with partial deductions applied (indication)
  cashIn: number;
  cashOut: number;           // business share of expenses paid (incl. assets)
  cashResult: number;        // cashIn − cashOut − mileage
  outputVat: number;
  inputVat: number;
}

export function pnl(d: LedgerData, p: Period): Pnl {
  const mode = d.settings.vatMode;
  const gigs = new Map(d.gigs.map((g) => [g.id, g]));
  const cats = new Map(d.categories.map((c) => [c.id, c]));
  const out: Pnl = { revenueEx: 0, revenueByType: {}, costsByCategory: {}, costsEx: 0, deductibleCosts: 0, mileage: 0, km: 0, depreciation: 0,
    result: 0, fiscalResult: 0, cashIn: 0, cashOut: 0, cashResult: 0, outputVat: 0, inputVat: 0 };
  for (const i of d.invoices) {
    if (!finalised(i) || !within(i.issueDate, p)) continue;
    const t = invoiceTotals(i);
    out.revenueEx += t.ex;
    out.outputVat += t.vat;
    const type = (i.gigId && gigs.get(i.gigId)?.eventType) || 'other';
    out.revenueByType[type] = (out.revenueByType[type] ?? 0) + t.ex;
  }
  for (const pay of d.payments) if (!pay.deletedAt && within(pay.date, p)) out.cashIn += pay.amount;
  for (const e of d.expenses) {
    if (e.deletedAt || !within(e.date, p)) continue;
    const v = expenseView(e, cats.get(e.categoryId), mode);
    out.cashOut += v.cash;
    out.inputVat += v.vatReclaim;
    if (e.reverseCharge && mode === 'vat') { const rc = Math.round((e.amount * e.businessPct * 21) / 10000); out.outputVat += rc; out.inputVat += rc; }
    if (e.assetId) continue;
    const c = (out.costsByCategory[e.categoryId] ??= { costEx: 0, deductible: 0 });
    c.costEx += v.costEx; c.deductible += v.deductible;
    out.costsEx += v.costEx; out.deductibleCosts += v.deductible;
  }
  for (const t of d.trips) {
    if (t.deletedAt || !within(t.date, p)) continue;
    out.km += tripKm(t);
    out.mileage += tripCost(t, d.settings.mileageRate);
  }
  for (const a of d.assets) if (!a.deletedAt) out.depreciation += depreciationBetween(a, p.from, p.to);
  out.result = out.revenueEx - out.costsEx - out.mileage - out.depreciation;
  out.fiscalResult = out.revenueEx - out.deductibleCosts - out.mileage - out.depreciation;
  out.cashResult = out.cashIn - out.cashOut - out.mileage;
  return out;
}

// ---------------------------------------------------------------------------
// Profit per gig

export interface GigProfit {
  gigId: string;
  revenueEx: number;
  directCosts: number;
  travel: number;
  km: number;
  margin: number;
  hours: number;
  perHour: number;
}

export function gigHours(g: Pick<Gig, 'date' | 'startTime' | 'endTime' | 'setupTime'>) {
  const w = gigWindow(g);
  return Math.max(0, (w.end.getTime() - w.busyFrom.getTime()) / 3600_000);
}

export function gigProfit(d: LedgerData, gig: Gig): GigProfit {
  const cats = new Map(d.categories.map((c) => [c.id, c]));
  const revenueEx = d.invoices.filter((i) => i.gigId === gig.id && finalised(i)).reduce((s, i) => s + invoiceTotals(i).ex, 0);
  const directCosts = d.expenses.filter((e) => !e.deletedAt && e.gigId === gig.id && !e.assetId)
    .reduce((s, e) => s + expenseView(e, cats.get(e.categoryId), d.settings.vatMode).costEx, 0);
  const trips = d.trips.filter((t) => !t.deletedAt && t.gigId === gig.id);
  const travel = trips.reduce((s, t) => s + tripCost(t, d.settings.mileageRate), 0);
  const km = trips.reduce((s, t) => s + tripKm(t), 0);
  const margin = revenueEx - directCosts - travel;
  const hours = gigHours(gig) * Math.max(1, gig.performers.length);
  return { gigId: gig.id, revenueEx, directCosts, travel, km, margin, hours, perHour: hours ? Math.round(margin / hours) : 0 };
}

// ---------------------------------------------------------------------------
// Partner balances (cash view): who paid what, who is owed what.

export interface PartnerBalance {
  member: MemberId;
  entitlement: number;  // share of (cash in − costs − mileage)
  paid: number;         // business costs paid privately + mileage driven + contributions + settlements paid
  received: number;     // business money received privately + withdrawals + settlements received
  balance: number;      // entitlement + paid − received: what this partner still has coming
}

export interface Balances {
  partners: Record<MemberId, PartnerBalance>;
  businessCash: number; // money held on the business account (by the records)
  settle?: { from: MemberId; to: MemberId; amount: number };
  /** When the business account holds the money: pay each partner out from it. */
  payout?: Record<MemberId, number>;
}

export function partnerBalances(d: LedgerData, asOf: string): Balances {
  const gigs = new Map(d.gigs.map((g) => [g.id, g]));
  const p: Record<MemberId, PartnerBalance> = {
    gijs: { member: 'gijs', entitlement: 0, paid: 0, received: 0, balance: 0 },
    coen: { member: 'coen', entitlement: 0, paid: 0, received: 0, balance: 0 },
  };
  let businessCash = 0;
  const addShare = (amount: number, date: string, gigId?: string) => {
    const rule = ruleAt(d.settings, date);
    const perf = gigId ? gigs.get(gigId)?.performers : undefined;
    const g = Math.round(amount * shareOf('gijs', rule, perf));
    p.gijs.entitlement += g;
    p.coen.entitlement += amount - g;
  };
  for (const pay of d.payments) {
    if (pay.deletedAt || pay.date > asOf) continue;
    const inv = d.invoices.find((i) => i.id === pay.invoiceId);
    addShare(pay.amount, pay.date, inv?.gigId);
    const who = pay.receivedBy ?? 'business';
    if (who === 'business') businessCash += pay.amount; else p[who].received += pay.amount;
  }
  for (const e of d.expenses) {
    if (e.deletedAt || e.date > asOf) continue;
    const cash = Math.round(e.amount * (e.businessPct / 100));
    addShare(-cash, e.date, e.gigId);
    if (e.paidBy === 'business') businessCash -= cash; else p[e.paidBy].paid += cash;
  }
  for (const t of d.trips) {
    if (t.deletedAt || t.date > asOf) continue;
    const c = tripCost(t, d.settings.mileageRate);
    addShare(-c, t.date, t.gigId);
    p[t.driver].paid += c;
  }
  for (const e of d.partnerEntries) {
    if (e.deletedAt || e.date > asOf) continue;
    if (e.kind === 'contribution') { p[e.memberId].paid += e.amount; businessCash += e.amount; }
    if (e.kind === 'withdrawal') { p[e.memberId].received += e.amount; businessCash -= e.amount; }
    if (e.kind === 'settlement' && e.toMemberId) { p[e.memberId].paid += e.amount; p[e.toMemberId].received += e.amount; }
  }
  for (const m of MEMBERS) p[m].balance = p[m].entitlement + p[m].paid - p[m].received;
  // Equalise the two partners relative to their share of what the business holds.
  const rule = ruleAt(d.settings, asOf);
  const target = Math.round((p.gijs.balance + p.coen.balance) * (rule.gijsPct / 100));
  const t = p.gijs.balance - target;
  if (businessCash >= 100 && p.gijs.balance >= 0 && p.coen.balance >= 0) {
    return { partners: p, businessCash, payout: { gijs: p.gijs.balance, coen: p.coen.balance } };
  }
  const settle = Math.abs(t) >= 1 ? (t > 0 ? { from: 'coen' as MemberId, to: 'gijs' as MemberId, amount: t } : { from: 'gijs' as MemberId, to: 'coen' as MemberId, amount: -t }) : undefined;
  return { partners: p, businessCash, settle };
}

// ---------------------------------------------------------------------------
// VAT return boxes (mode C)

export function vatBoxes(d: LedgerData, p: Period) {
  const b: Record<string, number> = { '1a_base': 0, '1a_vat': 0, '1b_base': 0, '1b_vat': 0, '1e_base': 0, '4b_base': 0, '4b_vat': 0, '5a': 0, '5b': 0, total: 0 };
  for (const i of d.invoices) {
    if (!finalised(i) || i.vatMode !== 'vat' || !within(i.issueDate, p)) continue;
    for (const r of invoiceTotals(i).perRate) {
      if (r.rate === 21) { b['1a_base'] += r.base; b['1a_vat'] += r.vat; }
      else if (r.rate === 9) { b['1b_base'] += r.base; b['1b_vat'] += r.vat; }
      else b['1e_base'] += r.base;
    }
  }
  for (const e of d.expenses) {
    if (e.deletedAt || !within(e.date, p)) continue;
    const bp = e.businessPct / 100;
    if (e.reverseCharge) {
      const base = Math.round(e.amount * bp);
      const vat = Math.round(base * 0.21);
      b['4b_base'] += base; b['4b_vat'] += vat; b['5b'] += vat;
    } else b['5b'] += Math.round(e.vatAmount * bp);
  }
  b['5a'] = b['1a_vat'] + b['1b_vat'] + b['4b_vat'];
  b.total = b['5a'] - b['5b'];
  return b;
}

// ---------------------------------------------------------------------------
// Hours (urencriterium indication)

export function hoursFor(member: MemberId, year: string, entries: HourEntry[], gigs: Gig[], today = toDateStr(new Date())) {
  const manual = entries.filter((h) => !h.deletedAt && h.memberId === member && h.date.startsWith(year));
  const auto = gigs.filter((g) => !g.deletedAt && g.date.startsWith(year) && g.date <= today && g.performers.includes(member)
    && ['confirmed', 'played', 'invoiced', 'paid'].includes(g.stage) && !manual.some((h) => h.gigId === g.id));
  const byKind: Record<string, number> = {};
  for (const h of manual) byKind[h.kind] = (byKind[h.kind] ?? 0) + h.hours;
  const gigHoursTotal = auto.reduce((s, g) => s + gigHours(g), 0);
  byKind.gig = (byKind.gig ?? 0) + gigHoursTotal;
  const total = Object.values(byKind).reduce((s, v) => s + v, 0);
  return { total: Math.round(total * 10) / 10, byKind, autoGigs: auto.length };
}

/** Tasks the dashboard shows. */
export function tripSuggestions(gigs: Gig[], trips: Trip[], today = toDateStr(new Date())) {
  return gigs.filter((g) => !g.deletedAt && g.venueId && g.date <= today && ['confirmed', 'played', 'invoiced', 'paid'].includes(g.stage)
    && !trips.some((t) => !t.deletedAt && t.gigId === g.id));
}

export const isoNow = () => at(toDateStr(new Date()), '00:00').toISOString();

/** Fiscal result per partner for a period: revenue by lineup rule, costs/mileage/depreciation by rule. */
export function resultShares(d: LedgerData, p: Period): Record<MemberId, number> {
  const gigs = new Map(d.gigs.map((g) => [g.id, g]));
  const cats = new Map(d.categories.map((c) => [c.id, c]));
  const out: Record<MemberId, number> = { gijs: 0, coen: 0 };
  const add = (amount: number, date: string, gigId?: string) => {
    const g = Math.round(amount * shareOf('gijs', ruleAt(d.settings, date), gigId ? gigs.get(gigId)?.performers : undefined));
    out.gijs += g; out.coen += amount - g;
  };
  for (const i of d.invoices) if (finalised(i) && within(i.issueDate, p)) add(invoiceTotals(i).ex, i.issueDate!, i.gigId);
  for (const e of d.expenses) if (!e.deletedAt && within(e.date, p)) add(-expenseView(e, cats.get(e.categoryId), d.settings.vatMode).deductible, e.date, e.gigId);
  for (const t of d.trips) if (!t.deletedAt && within(t.date, p)) add(-tripCost(t, d.settings.mileageRate), t.date, t.gigId);
  for (const a of d.assets) if (!a.deletedAt) add(-depreciationBetween(a, p.from, p.to), p.to);
  return out;
}
