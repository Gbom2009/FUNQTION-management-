import { describe, expect, it } from 'vitest';
import {
  acceptedLines, cancellationPct, computeTotals, creditLines, depositLines, dueDateFrom, finalLines, finaliseProblems,
  invoiceState, nextNumber, quoteTotals, seriesFor,
} from './money';
import { DEFAULT_SETTINGS, type Invoice, type Quote, type QuoteLine } from '../../../core/types';

let n = 0;
const id = () => `id${n++}`;
const base = { createdAt: '', createdBy: 'gijs' as const, updatedAt: '', updatedBy: 'gijs' as const };
const line = (p: Partial<QuoteLine>): QuoteLine => ({ id: id(), description: 'x', quantity: 1, unit: 'flat', unitPrice: 10000, vatRate: 21, ...p });
const quote = (p: Partial<Quote>): Quote => ({ ...base, id: 'q', gigId: 'g', version: 1, status: 'accepted', lines: [], vatMode: 'vat', ...p });
const inv = (p: Partial<Invoice>): Invoice => ({ ...base, id: id(), kind: 'standard', status: 'sent', language: 'nl', lines: [], client: { name: 'A', address: 'B' }, vatMode: 'vat', ...p });

describe('totals', () => {
  it('sums lines with discounts and VAT per rate', () => {
    const t = computeTotals([line({ quantity: 4, unitPrice: 15000 }), line({ unitPrice: 20000, vatRate: 9, discountPct: 10 })], { vatMode: 'vat', discountPct: 0 });
    expect(t.ex).toBe(60000 + 18000);
    expect(t.perRate).toEqual([{ rate: 21, base: 60000, vat: 12600 }, { rate: 9, base: 18000, vat: 1620 }]);
    expect(t.total).toBe(78000 + 14220);
  });
  it('charges no VAT in private and KOR mode', () => {
    expect(computeTotals([line({})], { vatMode: 'kor' })).toMatchObject({ vat: 0, total: 10000 });
    expect(computeTotals([line({})], { vatMode: 'private' })).toMatchObject({ vat: 0, total: 10000 });
  });
  it('applies a total discount', () => {
    expect(computeTotals([line({ unitPrice: 100000 })], { vatMode: 'private', discountPct: 10 })).toMatchObject({ ex: 90000, discount: 10000 });
  });
  it('counts only chosen optional extras', () => {
    const q = quote({ lines: [line({}), line({ optional: true, selected: false, unitPrice: 5000 }), line({ optional: true, selected: true, unitPrice: 2500 })] });
    expect(quoteTotals(q).ex).toBe(12500);
    expect(quoteTotals(q, true).ex).toBe(17500);
  });
});

describe('quote to invoices', () => {
  const q = quote({ discountPct: 10, lines: [line({ unitPrice: 100000 }), line({ unitPrice: 20000, optional: true, selected: true }), line({ unitPrice: 5000, optional: true })] });
  it('keeps the agreed total when the quote discount is pushed into lines', () => {
    const lines = acceptedLines(q, id);
    expect(lines).toHaveLength(2);
    expect(computeTotals(lines, { vatMode: 'vat' }).ex).toBe(quoteTotals(q).ex);
  });
  it('deposit + final add up to the accepted total', () => {
    const dep = inv({ kind: 'deposit', number: 'F2026-G-0001', lines: depositLines(q, 50, () => 'Aanbetaling', id) });
    expect(computeTotals(dep.lines, { vatMode: 'vat' }).ex).toBe(54000);
    const fin = finalLines(q, [dep], (nr) => `Aanbetaling ${nr}`, id);
    const finT = computeTotals(fin, { vatMode: 'vat' });
    expect(finT.ex + 54000).toBe(quoteTotals(q).ex);
    expect(fin.at(-1)?.refInvoiceId).toBe(dep.id);
  });
  it('credit note negates the invoice', () => {
    const i = inv({ lines: [line({ unitPrice: 30000 })] });
    expect(computeTotals(creditLines(i, id), { vatMode: 'vat' }).total).toBe(-36300);
  });
});

describe('state, numbering, rules', () => {
  it('derives overdue / partially paid / paid', () => {
    const i = inv({ dueDate: '2026-01-10', lines: [line({})], vatMode: 'private' });
    expect(invoiceState(i, [], '2026-01-05')).toBe('sent');
    expect(invoiceState(i, [], '2026-01-11')).toBe('overdue');
    const pay = { ...base, id: 'p', invoiceId: i.id, date: '2026-01-04', amount: 4000, method: 'bank' as const };
    expect(invoiceState(i, [pay], '2026-01-05')).toBe('partially_paid');
    expect(invoiceState(i, [{ ...pay, amount: 10000 }], '2026-02-01')).toBe('paid');
  });
  it('numbers gapless per member series', () => {
    const s = seriesFor('invoice', 2026, 'gijs');
    expect(s).toBe('F2026-G');
    expect(nextNumber(s, ['F2026-G-0001', 'F2026-G-0002', 'F2026-C-0007', undefined])).toBe('F2026-G-0003');
    expect(nextNumber('F2027-C', [])).toBe('F2027-C-0001');
  });
  it('picks the cancellation percentage from the scale', () => {
    const sc = DEFAULT_SETTINGS.cancellationScale;
    expect(cancellationPct(sc, '2026-12-31', '2026-01-01').pct).toBe(25);
    expect(cancellationPct(sc, '2026-03-01', '2026-01-15').pct).toBe(50);
    expect(cancellationPct(sc, '2026-01-20', '2026-01-15').pct).toBe(100);
  });
  it('due date never after the gig when requested', () => {
    expect(dueDateFrom('2026-05-01', 14)).toBe('2026-05-15');
    expect(dueDateFrom('2026-05-01', 14, '2026-05-08', true)).toBe('2026-05-07');
  });
  it('requires KvK/VAT id only in the matching mode', () => {
    const s = { ...DEFAULT_SETTINGS, address: 'Straat 1', city: 'Aarle-Rixtel' };
    const i = inv({ lines: [line({})] });
    expect(finaliseProblems({ ...i, vatMode: 'private' }, s)).toEqual([]);
    expect(finaliseProblems({ ...i, vatMode: 'kor' }, s)).toEqual(['kvk']);
    expect(finaliseProblems({ ...i, vatMode: 'vat', client: { name: '' } }, s)).toEqual(['client_name', 'client_address', 'kvk', 'vat_id']);
  });
});
