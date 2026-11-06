import type { BankLine, BankRule, Expense, Invoice, Payment } from '../../../core/types';
import { daysBetween, parseDate } from '../../../core/dates';
import { invoiceTotals, paidAmount } from '../../invoicing/domain/money';

export type Suggestion =
  | { type: 'invoice'; invoice: Invoice; open: number; score: number }
  | { type: 'expense'; expense: Expense; score: number }
  | { type: 'rule'; rule: BankRule; score: number };

/** Ranked suggestions for explaining one bank line. */
export function suggestFor(line: BankLine, data: { invoices: Invoice[]; payments: Payment[]; expenses: Expense[]; rules: BankRule[] }): Suggestion[] {
  const out: Suggestion[] = [];
  const text = `${line.counterparty} ${line.description}`.toLowerCase();
  if (line.amount > 0) {
    for (const inv of data.invoices) {
      if (inv.deletedAt || inv.status !== 'sent' || inv.kind === 'credit_note') continue;
      const open = invoiceTotals(inv).total - paidAmount(inv.id, data.payments);
      if (open <= 0) continue;
      let score = 0;
      if (inv.number && text.includes(inv.number.toLowerCase())) score += 60;
      if (open === line.amount) score += 50;
      else if (invoiceTotals(inv).total === line.amount) score += 30;
      if (inv.client.name && text.includes(inv.client.name.toLowerCase().split(' ')[0])) score += 10;
      if (score >= 30) out.push({ type: 'invoice', invoice: inv, open, score });
    }
  } else {
    for (const e of data.expenses) {
      if (e.deletedAt || e.bankLineId || e.amount !== -line.amount) continue;
      const days = Math.abs(daysBetween(parseDate(e.date), parseDate(line.date)));
      if (days > 10) continue;
      out.push({ type: 'expense', expense: e, score: 70 - days * 3 + (text.includes(e.supplier.toLowerCase()) ? 20 : 0) });
    }
  }
  for (const r of data.rules) {
    if (r.deletedAt || !r.match) continue;
    if (text.includes(r.match.toLowerCase())) out.push({ type: 'rule', rule: r, score: 40 });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** A short, reusable rule key from a counterparty name ("PAYPAL *BEATPORT 1234" → "beatport"). */
export function ruleKey(counterparty: string) {
  const words = counterparty.toLowerCase().replace(/paypal \*|sumup \*|zettle_\*|ccv\*|\d+/g, ' ').split(/[^a-zà-ü&]+/).filter((w) => w.length > 2);
  return words.slice(0, 2).join(' ').trim() || counterparty.toLowerCase().trim();
}
