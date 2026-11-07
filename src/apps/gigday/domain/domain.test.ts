import { describe, expect, it } from 'vitest';
import { DEFAULT_GIGDAY, type Gig } from '../../../core/types';
import { estimateTravel, generateTimeline, mergeTimeline, nowNext, phaseOf, shiftSteps, LATE_KINDS, stepState, timeOnGig, type ExistingStep } from './timeline';
import { overtime, overtimeLine } from './overtime';
import { wrapUpItems } from './wrapup';
import { DEFAULT_TASK_TEMPLATES, gigDayIcs, itemsFor, readiness } from './prep';

const L = (k: string, p?: Record<string, string>) => [k, p?.name, p?.who].filter(Boolean).join(' ');
const hm = (iso: string) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

const wedding = {
  date: '2026-12-12', startTime: '20:00', endTime: '01:00',
  setSlots: [
    { id: 's1', start: '20:00', end: '22:30', performers: ['gijs' as const] },
    { id: 's2', start: '22:30', end: '01:00', performers: ['coen' as const] },
  ],
  setup: 'standard' as const, travel: { gijs: 40, coen: 30 }, moments: [{ id: 'm1', title: 'Openingsdans', at: '21:00' }, { id: 'm2', title: 'Taart' }],
  curfew: '01:00', defaults: DEFAULT_GIGDAY,
};

describe('timeline', () => {
  it('builds backwards from the first set and forwards from the last', () => {
    const s = generateTimeline(wedding, L);
    const find = (k: string) => s.find((x) => x.key === k)!;
    expect(hm(find('doors').plannedAt)).toBe('19:30');        // 30 min before the first set
    expect(hm(find('soundcheck').plannedAt)).toBe('19:00');   // 30 min before doors (standard)
    expect(hm(find('setup').plannedAt)).toBe('17:30');        // 90 min set-up
    expect(hm(find('arrive').plannedAt)).toBe('17:15');
    expect(hm(find('leave_home:gijs').plannedAt)).toBe('16:20'); // 40 travel + 15 buffer
    expect(hm(find('leave_home:coen').plannedAt)).toBe('16:30');
    expect(hm(find('moment:m1').plannedAt)).toBe('21:00');
    expect(hm(find('moment:m2').plannedAt)).toBe('22:30');    // no time → after the first set
    const end = find('set_end:s2');
    expect(new Date(end.plannedAt).getDate()).toBe(13);       // past midnight = next day
    expect(hm(find('leave_venue').plannedAt)).toBe('02:00');  // + 60 min breakdown
    expect(s.map((x) => x.plannedAt)).toEqual([...s.map((x) => x.plannedAt)].sort());
  });

  it('uses the set-up time from Bookings, DJ-only durations and a pick-up detour', () => {
    const s = generateTimeline({ ...wedding, setupTime: '18:30', setup: 'dj_only', pickup: { by: 'gijs', minutes: 20 } }, L);
    expect(hm(s.find((x) => x.key === 'setup')!.plannedAt)).toBe('18:30');
    expect(hm(s.find((x) => x.key === 'soundcheck')!.plannedAt)).toBe('19:15'); // 15 min (DJ only)
    expect(hm(s.find((x) => x.key === 'leave_home:gijs')!.plannedAt)).toBe('17:00'); // 18:15 − 40 − 15 − 20
    expect(s.some((x) => x.key === 'pickup:gijs')).toBe(true);
  });

  it('a gig without set slots is one set; times after midnight belong to the night', () => {
    const s = generateTimeline({ ...wedding, setSlots: [], moments: [], curfew: undefined }, L);
    expect(s.filter((x) => x.kind === 'set_start')).toHaveLength(1);
    expect(timeOnGig('2026-12-12', '20:00', '00:30').getDate()).toBe(13);
    expect(estimateTravel(42, true, DEFAULT_GIGDAY)).toBe(50);   // 42 km at 55 km/h = 45.8 → 50
    expect(estimateTravel(undefined, false, DEFAULT_GIGDAY)).toBeUndefined();
  });

  it('regeneration keeps done and hand-set steps, updates the rest', () => {
    const fresh = generateTimeline(wedding, L);
    const existing: ExistingStep[] = fresh.map((f, i) => ({ ...f, id: `id${i}` }));
    const arrive = existing.find((e) => e.kind === 'arrive')!;
    arrive.actualAt = '2026-12-12T16:20:00.000Z';
    const doors = existing.find((e) => e.kind === 'doors')!;
    doors.locked = true; doors.plannedAt = '2026-12-12T18:45:00.000Z';
    existing.push({ key: 'custom:x', kind: 'custom', label: 'Foto met bruidspaar', plannedAt: '2026-12-12T21:30:00.000Z', id: 'c' });
    const later = generateTimeline({ ...wedding, setSlots: wedding.setSlots.map((x) => ({ ...x, start: x.start === '20:00' ? '20:30' : x.start })) }, L);
    const m = mergeTimeline(later, existing);
    expect(m.keep.map((k) => k.id)).toEqual(expect.arrayContaining([arrive.id, doors.id, 'c']));
    expect(m.update.some((u) => u.kind === 'set_start')).toBe(true);
    expect(m.remove).toHaveLength(0);
  });

  it('"we zijn later" moves the run-up only; done steps and the curfew never move', () => {
    const steps = generateTimeline(wedding, L).map((f, i) => ({ ...f, id: `id${i}`, actualAt: undefined as string | undefined }));
    steps.find((s) => s.key === 'leave_home:gijs')!.actualAt = 'x';
    const from = steps.find((s) => s.kind === 'arrive')!;
    const moved = shiftSteps(steps, from.id, 30, LATE_KINDS);
    expect(moved.map((m) => m.kind).sort()).toEqual(['arrive', 'setup', 'soundcheck']);
    expect(hm(moved.find((m) => m.kind === 'arrive')!.plannedAt)).toBe('17:45');
    const all = shiftSteps(steps, from.id, 15);
    expect(all.some((m) => m.kind === 'curfew')).toBe(false);
    expect(all.some((m) => m.kind === 'set_start')).toBe(true);
  });

  it('now/next per person, state colours and phase', () => {
    const steps = generateTimeline(wedding, L).map((f, i) => ({ ...f, id: `id${i}`, actualAt: undefined as string | undefined }));
    expect(nowNext(steps, 'coen').now?.key).toBe('leave_home:coen');
    expect(nowNext(steps, 'gijs').now?.key).toBe('leave_home:gijs');
    const doors = steps.find((s) => s.kind === 'doors')!;
    expect(stepState(doors, new Date(Date.parse(doors.plannedAt) + 10 * 60000))).toBe('behind');
    expect(stepState(doors, new Date(Date.parse(doors.plannedAt) + 20 * 60000))).toBe('late');
    expect(phaseOf(steps, new Date('2026-12-11T12:00:00'), wedding.date)).toBe('prep');
    steps.find((s) => s.kind === 'arrive')!.actualAt = 'x';
    expect(phaseOf(steps, new Date(), wedding.date)).toBe('setup');
    steps.filter((s) => s.kind === 'set_start').forEach((s) => (s.actualAt = 'x'));
    expect(phaseOf(steps, new Date(), wedding.date)).toBe('playing');
    steps.filter((s) => s.kind === 'set_end').forEach((s) => (s.actualAt = 'x'));
    expect(phaseOf(steps, new Date(), wedding.date)).toBe('breakdown');
  });
});

describe('overtime', () => {
  const planned = '2026-12-13T00:00:00.000Z';
  it('only with a logged request, per started half hour after 5 minutes grace', () => {
    expect(overtime(planned, '2026-12-13T00:50:00.000Z', [], 7500)).toMatchObject({ minutes: 50, halfHours: 0, amount: 0 });
    const req = [{ at: '2026-12-12T23:55:00.000Z', minutes: 30, requestedBy: 'Lisa' }];
    expect(overtime(planned, '2026-12-13T00:04:00.000Z', req, 7500).halfHours).toBe(0);
    expect(overtime(planned, '2026-12-13T00:35:00.000Z', req, 7500)).toMatchObject({ halfHours: 1, amount: 7500 });
    expect(overtime(planned, '2026-12-13T00:50:00.000Z', req, 7500)).toMatchObject({ halfHours: 2, amount: 15000 });
    const line = overtimeLine(overtime(planned, '2026-12-13T00:50:00.000Z', req, 7500), 'nl', 21, 'x');
    expect(line).toMatchObject({ quantity: 2, unitPrice: 7500, vatRate: 21 });
    expect(line.description).toContain('op verzoek van Lisa');
  });
});

describe('wrap-up', () => {
  const gig = { id: 'g', date: '2026-12-12', stage: 'confirmed', ownerId: 'gijs' } as Gig;
  const base = { gig, trips: [], invoices: [], reviews: [], logs: [], openGearIssues: 0, venueNotesToday: 0, hasAcceptedQuote: true, today: '2026-12-13' };
  it('proposes played, venue-distance trips, final invoice and thank-you', () => {
    const items = wrapUpItems({ ...base, day: { drivers: ['gijs', 'coen'] } as never, venue: { distanceKm: { gijs: 18, coen: 22 } } as never });
    const get = (k: string) => items.find((i) => i.key === k)!;
    expect(get('played').state).toBe('todo');
    expect(get('trips').trips).toEqual([{ driver: 'gijs', km: 18, roundTrip: true, source: 'venue' }, { driver: 'coen', km: 22, roundTrip: true, source: 'venue' }]);
    expect(get('invoice').state).toBe('todo');
    expect(get('thanks').state).toBe('todo');
  });
  it('nav trips from Maps and an existing review count as done; not played before the date', () => {
    const items = wrapUpItems({ ...base, today: '2026-12-11', trips: [{ gigId: 'g', km: 24, roundTrip: false } as never], reviews: [{ gigId: 'g', requestedAt: 'x' } as never] });
    expect(items.find((i) => i.key === 'played')!.state).toBe('na');
    expect(items.find((i) => i.key === 'trips')!.state).toBe('done');
    expect(items.find((i) => i.key === 'thanks')!.state).toBe('done');
  });
});

describe('prep', () => {
  it('readiness and template selection', () => {
    const r = readiness({ contract: 'signed', deposit: 'open', venueAddress: true, loadingEntrance: false, wishes: 2, packList: 'confirmed', drivers: 1 });
    expect(r.filter((x) => !x.ok && !x.na).map((x) => x.key)).toEqual(['deposit', 'contact', 'entrance']);
    const items = itemsFor(DEFAULT_TASK_TEMPLATES, { setup: 'standard', eventType: 'wedding', laser: false, outdoor: false });
    expect(items.some((i) => i.title.includes('Openingsdans'))).toBe(true);
    expect(items.some((i) => i.laserOnly)).toBe(false);
    expect(itemsFor(DEFAULT_TASK_TEMPLATES, { setup: 'dj_only', eventType: 'club', laser: true, outdoor: true }).some((i) => i.title.includes('Lichtbar'))).toBe(false);
  });
  it('calendar file: leave time with two alarms, day before and wrap-up', () => {
    const steps = generateTimeline(wedding, L);
    const ics = gigDayIcs({ gigId: 'g', title: 'Bruiloft', date: wedding.date, me: 'coen', steps, dayBeforeAt: '18:00', wrapUpAt: '10:00', labels: { dayBefore: 'Morgen', wrapUp: 'Afronden' } });
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(4);
    expect(ics.match(/BEGIN:VALARM/g)).toHaveLength(4);
    expect(ics).toContain('TRIGGER:-PT30M');
    expect(ics).toContain('leave_home Coen');
  });
});
