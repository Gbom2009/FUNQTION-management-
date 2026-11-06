import type { Gig, Stage } from '../../../core/types';
import { at, todayStr } from '../../../core/dates';

export const PIPELINE: Stage[] = ['enquiry', 'option', 'quote_sent', 'confirmed', 'played', 'invoiced', 'paid'];
export const PRE_CONFIRMED: Stage[] = ['enquiry', 'option', 'quote_sent'];

/** Which stages a gig may move to from its current stage. */
export function allowedTargets(from: Stage): Stage[] {
  switch (from) {
    case 'enquiry': return ['option', 'quote_sent', 'confirmed', 'lost'];
    case 'option': return ['enquiry', 'quote_sent', 'confirmed', 'lost'];
    case 'quote_sent': return ['enquiry', 'option', 'confirmed', 'lost'];
    case 'confirmed': return ['quote_sent', 'played', 'cancelled'];
    case 'played': return ['confirmed', 'invoiced', 'paid'];
    case 'invoiced': return ['played', 'paid'];
    case 'paid': return ['invoiced'];
    case 'lost': return ['enquiry'];
    case 'cancelled': return ['confirmed'];
  }
}

export function nextStage(from: Stage): Stage | null {
  const i = PIPELINE.indexOf(from);
  if (i < 0 || i === PIPELINE.length - 1) return null;
  // Option is optional: the natural next step after an enquiry is a quote.
  if (from === 'enquiry') return 'quote_sent';
  return PIPELINE[i + 1];
}

export type Requirement =
  | 'date' | 'times' | 'venue' | 'performers' | 'fee' | 'quote' | 'option_expiry' | 'event_type';

export interface StageCheck {
  /** Blocking problems: the move is refused. */
  errors: ('not_allowed' | 'played_in_future' | 'reason_required')[];
  /** Missing information: the move is allowed but the user is warned. */
  missing: Requirement[];
}

export function checkStageChange(
  gig: Gig,
  to: Stage,
  opts: { hasQuote?: boolean; reason?: string; today?: string } = {},
): StageCheck {
  const errors: StageCheck['errors'] = [];
  const missing: Requirement[] = [];
  if (!allowedTargets(gig.stage).includes(to)) errors.push('not_allowed');

  if (to === 'quote_sent') {
    if (!gig.date) missing.push('date');
    if (!gig.eventType) missing.push('event_type');
    if (!opts.hasQuote && !gig.agreedFee) missing.push('quote');
  }
  if (to === 'option' && !gig.optionExpiresAt) missing.push('option_expiry');
  if (to === 'confirmed') {
    if (!gig.date) missing.push('date');
    if (!gig.startTime || !gig.endTime) missing.push('times');
    if (!gig.venueId) missing.push('venue');
    if (!gig.performers.length) missing.push('performers');
    if (!gig.agreedFee) missing.push('fee');
  }
  if (to === 'played') {
    const today = opts.today ?? todayStr();
    if (gig.date > today) errors.push('played_in_future');
  }
  if ((to === 'lost' || to === 'cancelled') && !opts.reason) errors.push('reason_required');
  return { errors, missing };
}

/** Timestamp fields to stamp when a stage is entered. */
export function stageStamps(to: Stage, nowIso: string): Partial<Gig> {
  switch (to) {
    case 'quote_sent': return { quoteSentAt: nowIso };
    case 'played': return { playedAt: nowIso };
    case 'invoiced': return { invoicedAt: nowIso };
    case 'paid': return { paidAt: nowIso };
    default: return {};
  }
}

export function isUpcoming(g: Gig, now = new Date()) {
  return at(g.date, g.endTime || '23:59') >= new Date(now.getTime() - 12 * 3600_000);
}

export function nextReference(existing: { reference: string }[], year: number) {
  const prefix = `FQ-${year}-`;
  const max = existing
    .filter((g) => g.reference?.startsWith(prefix))
    .reduce((m, g) => Math.max(m, Number(g.reference.slice(prefix.length)) || 0), 0);
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

export const quoteTotals = (lines: { quantity: number; unitPrice: number; vatRate: number }[]) => {
  const ex = lines.reduce((s, l) => s + Math.round(l.quantity * l.unitPrice), 0);
  const vat = lines.reduce((s, l) => s + Math.round((l.quantity * l.unitPrice * l.vatRate) / 100), 0);
  return { ex, vat, total: ex + vat };
};
