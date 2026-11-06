import { describe, expect, it } from 'vitest';
import { checkDate, findConflicts } from './conflicts';
import { checkStageChange, nextReference, quoteTotals } from './pipeline';
import { desiredTasks, planTaskSync } from './reminders';
import { fillTemplate, toWhatsAppNumber } from './messaging';
import { DEFAULT_SETTINGS, type AvailabilityBlock, type Gig, type Task } from '../../../core/types';
import { gigWindow } from '../../../core/dates';

const base = { createdAt: '', createdBy: 'gijs' as const, updatedAt: '', updatedBy: 'gijs' as const };
function gig(p: Partial<Gig>): Gig {
  return {
    ...base, id: Math.random().toString(36), reference: 'FQ-2027-001', title: 'Test', eventType: 'wedding',
    date: '2027-06-12', startTime: '20:00', endTime: '00:00', setupRequired: false, stage: 'confirmed',
    stageChangedAt: '2027-01-01T10:00:00.000Z', ownerId: 'gijs', performers: ['gijs'], setSlots: [], contacts: [],
    musicWishes: [], ...p,
  };
}
const S = DEFAULT_SETTINGS;

describe('gigWindow', () => {
  it('handles sets past midnight', () => {
    const w = gigWindow({ date: '2027-06-12', startTime: '22:00', endTime: '02:00' });
    expect(w.end.getDate()).toBe(13);
    expect(w.end.getHours()).toBe(2);
  });
});

describe('conflicts', () => {
  it('flags overlapping gigs for the same person as hard', () => {
    const a = gig({ startTime: '20:00', endTime: '01:00' });
    const b = gig({ startTime: '23:00', endTime: '03:00' });
    const c = findConflicts(a, [b], [], S);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ level: 'hard', kind: 'overlap', member: 'gijs' });
  });

  it('allows two same-day gigs without build-up when the gap is at least 2 hours', () => {
    const a = gig({ startTime: '14:00', endTime: '17:00' });
    const b = gig({ startTime: '19:00', endTime: '23:00' });
    expect(findConflicts(a, [b], [], S)).toHaveLength(0);
  });

  it('refuses same-day gigs closer than 2 hours', () => {
    const a = gig({ startTime: '14:00', endTime: '17:00' });
    const b = gig({ startTime: '18:30', endTime: '23:00' });
    const c = findConflicts(a, [b], [], S);
    expect(c[0]).toMatchObject({ kind: 'gap_too_short', gapMinutes: 90, level: 'hard' });
  });

  it('refuses a second same-day gig when either needs build-up', () => {
    const a = gig({ startTime: '14:00', endTime: '16:00', setupRequired: true });
    const b = gig({ startTime: '21:00', endTime: '23:00' });
    expect(findConflicts(a, [b], [], S)[0]).toMatchObject({ kind: 'setup_same_day', level: 'hard' });
  });

  it('does not clash when different people play', () => {
    const a = gig({ performers: ['gijs'] });
    const b = gig({ performers: ['coen'] });
    expect(findConflicts(a, [b], [], S)).toHaveLength(0);
  });

  it('warns softly when both gigs need our gear on the same day', () => {
    const a = gig({ performers: ['gijs'], setupRequired: true });
    const b = gig({ performers: ['coen'], setupRequired: true });
    expect(findConflicts(a, [b], [], S)[0]).toMatchObject({ kind: 'gear_same_day', level: 'soft' });
  });

  it('treats tentative gigs as soft warnings and ignores lost ones', () => {
    const a = gig({});
    const opt = gig({ stage: 'option' });
    const lost = gig({ stage: 'lost' });
    const c = findConflicts(a, [opt, lost], [], S);
    expect(c).toHaveLength(1);
    expect(c[0].level).toBe('soft');
  });

  it('flags blocked days', () => {
    const block: AvailabilityBlock = { ...base, id: 'b', memberId: 'gijs', from: '2027-06-10', to: '2027-06-14', kind: 'holiday' };
    expect(findConflicts(gig({}), [], [block], S)[0]).toMatchObject({ kind: 'blocked', level: 'hard' });
    expect(findConflicts(gig({ performers: ['coen'] }), [], [block], S)).toHaveLength(0);
  });

  it('checkDate reports booked members', () => {
    const r = checkDate('2027-06-12', [gig({ performers: ['gijs', 'coen'] })], []);
    expect(r.status).toBe('booked');
    expect(r.bookedMembers).toEqual(['gijs', 'coen']);
    expect(checkDate('2027-06-13', [gig({})], []).status).toBe('free');
  });
});

describe('pipeline', () => {
  it('requires a reason to mark lost', () => {
    const g = gig({ stage: 'quote_sent' });
    expect(checkStageChange(g, 'lost').errors).toContain('reason_required');
    expect(checkStageChange(g, 'lost', { reason: 'too_expensive' }).errors).toHaveLength(0);
  });
  it('cannot mark played before the gig date', () => {
    expect(checkStageChange(gig({ date: '2099-01-01' }), 'played', { today: '2027-01-01' }).errors).toContain('played_in_future');
  });
  it('lists missing info for confirmation', () => {
    const r = checkStageChange(gig({ stage: 'quote_sent', venueId: undefined, agreedFee: undefined }), 'confirmed');
    expect(r.missing).toEqual(expect.arrayContaining(['venue', 'fee']));
  });
  it('does not allow cancelling an enquiry (that is "lost")', () => {
    expect(checkStageChange(gig({ stage: 'enquiry' }), 'cancelled', { reason: 'x' }).errors).toContain('not_allowed');
  });
  it('numbers references per year', () => {
    expect(nextReference([{ reference: 'FQ-2027-004' }, { reference: 'FQ-2026-010' }], 2027)).toBe('FQ-2027-005');
    expect(nextReference([], 2028)).toBe('FQ-2028-001');
  });
  it('computes totals with 0% VAT', () => {
    expect(quoteTotals([{ quantity: 4, unitPrice: 15000, vatRate: 0 }])).toEqual({ ex: 60000, vat: 0, total: 60000 });
  });
});

describe('reminders', () => {
  const now = new Date('2027-03-01T12:00:00');
  it('creates quote follow-ups and drops them once confirmed', () => {
    const g = gig({ stage: 'quote_sent', quoteSentAt: '2027-02-27T10:00:00.000Z' });
    const d = desiredTasks({ gigs: [g], enquiries: [], quotes: [], reviews: [] }, S, now);
    expect(d.map((t) => t.kind)).toEqual(['follow_up_quote', 'follow_up_quote']);
    const tasks = d.map((x) => ({ ...base, id: x.ruleKey, title: '', status: 'open', ruleKey: x.ruleKey, kind: x.kind, dueAt: x.dueAt, assignedTo: x.assignedTo })) as Task[];
    const after = desiredTasks({ gigs: [{ ...g, stage: 'confirmed' }], enquiries: [], quotes: [], reviews: [] }, S, now);
    const plan = planTaskSync(after, tasks);
    expect(plan.cancel).toHaveLength(2);
    expect(plan.create.map((t) => t.kind)).toEqual(expect.arrayContaining(['music_wishes', 'final_check', 'gear_check']));
  });
  it('does not recreate a completed task', () => {
    const g = gig({ stage: 'played', date: '2027-02-27' });
    const d = desiredTasks({ gigs: [g], enquiries: [], quotes: [], reviews: [] }, S, now);
    const done = d.map((x) => ({ ...base, id: x.ruleKey, title: '', status: 'done', ruleKey: x.ruleKey, kind: x.kind, dueAt: x.dueAt, assignedTo: x.assignedTo })) as Task[];
    expect(planTaskSync(d, done)).toEqual({ create: [], cancel: [] });
  });
  it('skips stale tasks for old imported gigs', () => {
    const g = gig({ stage: 'played', date: '2024-01-01' });
    expect(desiredTasks({ gigs: [g], enquiries: [], quotes: [], reviews: [] }, S, now)).toHaveLength(0);
  });
  it('suggests rebooking recurring events', () => {
    const g = gig({ stage: 'paid', date: '2026-11-01', seriesName: 'Kermis' });
    const d = desiredTasks({ gigs: [g], enquiries: [], quotes: [], reviews: [{ ...base, id: 'r', gigId: g.id, requestedAt: 'x' }] }, S, now);
    expect(d.map((t) => t.kind)).toEqual(['rebook']);
  });
});

describe('messaging', () => {
  it('fills templates', () => {
    expect(fillTemplate('Hoi {{firstName}}, {{ gigDate }}!', { firstName: 'Lisa', gigDate: '12 juni' })).toBe('Hoi Lisa, 12 juni!');
  });
  it('normalises Dutch numbers', () => {
    expect(toWhatsAppNumber('06-12345678')).toBe('31612345678');
    expect(toWhatsAppNumber('+31 6 1234 5678')).toBe('31612345678');
  });
});

describe('payment reminders', () => {
  const now = new Date('2027-03-01T12:00:00');
  const inv = {
    ...base, id: 'inv1', number: 'F2027-G-0001', kind: 'standard' as const, status: 'sent' as const, language: 'nl' as const,
    dueDate: '2027-02-20', lines: [{ id: 'l', description: 'x', quantity: 1, unit: 'flat' as const, unitPrice: 10000, vatRate: 0 }],
    client: { name: 'Klant' }, vatMode: 'private' as const,
  };
  it('plans friendly, firm and formal reminders after the due date', () => {
    const d = desiredTasks({ gigs: [], enquiries: [], quotes: [], reviews: [], invoices: [inv], payments: [] }, S, now);
    expect(d.map((t) => [t.ruleKey, t.templateKind])).toEqual([['dun1:inv1', 'reminder_1'], ['dun2:inv1', 'reminder_2'], ['dun3:inv1', 'reminder_3']]);
  });
  it('stops reminding once paid or paused', () => {
    const pay = { ...base, id: 'p', invoiceId: 'inv1', date: '2027-02-25', amount: 10000, method: 'bank' as const };
    expect(desiredTasks({ gigs: [], enquiries: [], quotes: [], reviews: [], invoices: [inv], payments: [pay] }, S, now)).toHaveLength(0);
    expect(desiredTasks({ gigs: [], enquiries: [], quotes: [], reviews: [], invoices: [{ ...inv, dunningPaused: true }], payments: [] }, S, now)).toHaveLength(0);
  });
});
