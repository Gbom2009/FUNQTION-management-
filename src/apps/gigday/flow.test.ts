import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useTestDatabase } from '../../core/db';
import { patch, save, setActor } from '../../core/repo';
import { ensureSeed } from '../../core/seed';
import type { GigDay, Quote, Venue } from '../../core/types';
import { blankGig, createGig } from '../bookings/data';
import { runTaskSync } from '../bookings/domain/taskSync';
import { createQuoteForGig } from '../invoicing/data';
import { gigDayId } from '../maps/features/shared/mapping';
import {
  addLog, closeGigDay, doneStep, ensureGigDay, exportPlan, importPlan, overtimeFor, regenerate, runningLate, setWish,
  updateGigDay, wrapInvoice, wrapPlayed, wrapThanks, wrapTrips,
} from './data';

let n = 0;
beforeEach(async () => { useTestDatabase('gigday-' + n++); setActor('coen'); await ensureSeed(); });
afterEach(async () => { await runTaskSync(); });
const hm = (iso?: string) => (iso ? new Date(iso).toTimeString().slice(0, 5) : '');

async function setupGig(date = '2026-11-01') {
  const venue = await save<Venue>('venues', { name: 'De Hoeve', city: 'Gemert', distanceKm: { gijs: 22, coen: 18 }, curfew: '01:00', defaultDoors: '19:30' });
  const gig = await createGig({
    ...blankGig('gijs'), title: 'Bruiloft Lisa & Tom', date, startTime: '20:00', endTime: '00:30', venueId: venue.id, stage: 'confirmed', eventType: 'wedding',
    setSlots: [{ id: 's1', start: '20:00', end: '22:15', performers: ['gijs'] }, { id: 's2', start: '22:15', end: '00:30', performers: ['coen'] }],
    musicWishes: [{ id: 'w1', kind: 'special_moment', text: 'Openingsdans', at: '21:00', track: 'Ed Sheeran – Perfect' }, { id: 'w2', kind: 'do_not_play', text: 'Macarena' }],
  });
  return { venue, gig };
}

describe('gig day flow', () => {
  it('creates the day with timeline and tasks, ticks steps, shifts when late', async () => {
    const { db } = await import('../../core/db');
    const { gig } = await setupGig();
    await ensureGigDay(gig.id, 'nl');
    const day = (await db.gigDays.get(gigDayId(gig.id)))!;
    expect(day).toMatchObject({ status: 'draft', setup: 'standard', curfew: '01:00', doorsAt: '19:30', drivers: ['gijs'] });
    const steps = await db.timelineSteps.where('gigId').equals(gig.id).toArray();
    const by = (k: string) => steps.find((s) => s.kind === k)!;
    expect(hm(by('doors').plannedAt)).toBe('19:30');
    expect(hm(by('leave_home').plannedAt)).toBe('16:35'); // arrive 17:15 − 25 min (22 km with trailer at 55 km/h) − 15 min buffer
    expect(steps.find((s) => s.kind === 'moment')?.label).toBe('Openingsdans');
    const tasks = await db.dayTasks.where('gigId').equals(gig.id).toArray();
    expect(tasks.some((t) => t.title.includes('Openingsdans'))).toBe(true); // wedding template

    // Leave, then running late: the run-up moves, sets don't.
    await doneStep(by('leave_home'), 'gijs');
    expect((await db.gigDays.get(day.id))?.status).toBe('live');
    const setBefore = steps.find((s) => s.kind === 'set_start' && s.sourceRef === 's1')!.plannedAt;
    await runningLate(gig.id, 30, 'gijs');
    const after = await db.timelineSteps.where('gigId').equals(gig.id).toArray();
    expect(Date.parse(after.find((s) => s.kind === 'arrive')!.plannedAt) - Date.parse(by('arrive').plannedAt)).toBe(30 * 60000);
    expect(after.find((s) => s.kind === 'set_start' && s.sourceRef === 's1')!.plannedAt).toBe(setBefore);
    expect((await db.gigLogs.where('gigId').equals(gig.id).toArray()).map((l) => l.type).sort()).toEqual(['late', 'leave']);

    // Regenerating keeps the hand-moved (locked) and done steps.
    await updateGigDay(gig.id, { doorsAt: '19:45' }, 'nl');
    const regen = await db.timelineSteps.where('gigId').equals(gig.id).toArray();
    expect(regen.find((s) => s.kind === 'leave_home')!.actualAt).toBeTruthy();
    expect(hm(regen.find((s) => s.kind === 'doors')!.plannedAt)).toBe('19:45');

    // A moment ticked in Booth mode marks the music wish done (App 1).
    await doneStep(regen.find((s) => s.kind === 'moment')!, 'coen');
    expect((await db.gigs.get(gig.id))!.musicWishes.find((w) => w.id === 'w1')!.done).toBe(true);
  });

  it('Maps arrival ticks the arrive step', async () => {
    const { db } = await import('../../core/db');
    const { gig } = await setupGig();
    await ensureGigDay(gig.id, 'nl');
    await patch<GigDay>('gigDays', gigDayId(gig.id), { arrivedAt: '2026-11-01T15:40:00.000Z' });
    await ensureGigDay(gig.id, 'nl');
    const arrive = (await db.timelineSteps.where('gigId').equals(gig.id).toArray()).find((s) => s.kind === 'arrive')!;
    expect(arrive.actualAt).toBe('2026-11-01T15:40:00.000Z');
  });

  it('wrap-up: played, trips, final invoice with overtime, thank-you, close', async () => {
    const { db } = await import('../../core/db');
    const { gig } = await setupGig('2026-11-01');
    await ensureGigDay(gig.id, 'nl');
    const q = await createQuoteForGig(gig.id);
    await save<Quote>('quotes', { ...q, status: 'accepted', lines: [{ id: 'l1', description: 'DJ-show', quantity: 1, unit: 'flat', unitPrice: 120000, vatRate: 21 }] });

    const steps = await db.timelineSteps.where('gigId').equals(gig.id).toArray();
    const lastEnd = steps.find((s) => s.kind === 'set_end' && s.sourceRef === 's2')!;
    await addLog(gig.id, 'overtime_request', { minutes: 60, requestedBy: 'de bruidegom' }, 'coen');
    await doneStep(lastEnd, 'coen', new Date(Date.parse(lastEnd.plannedAt) + 50 * 60000).toISOString());
    const ot = await overtimeFor(gig.id);
    expect(ot).toMatchObject({ minutes: 50, halfHours: 2, amount: 15000 });

    await wrapPlayed((await db.gigs.get(gig.id))!);
    expect((await db.gigs.get(gig.id))!.stage).toBe('played');
    await wrapTrips((await db.gigs.get(gig.id))!, [{ driver: 'gijs', km: 22, roundTrip: true }]);
    expect((await db.trips.where('gigId').equals(gig.id).toArray())[0]).toMatchObject({ km: 22, roundTrip: true, driver: 'gijs' });
    const inv = (await wrapInvoice((await db.gigs.get(gig.id))!))!;
    expect(inv.lines.some((l) => l.description.includes('Verlenging') && l.quantity === 2 && l.unitPrice === 7500)).toBe(true);
    await wrapThanks((await db.gigs.get(gig.id))!);
    expect((await db.reviews.toArray()).some((r) => r.gigId === gig.id && r.requestedAt)).toBe(true);
    await closeGigDay(gig.id);
    const day = (await db.gigDays.get(gigDayId(gig.id)))!;
    expect(day.status).toBe('closed');
    expect(Object.keys(day.wrapUp ?? {}).sort()).toEqual(['invoice', 'played', 'thanks', 'trips']);
  });

  it('shares the plan as a small file the other phone merges', async () => {
    const { db, useTestDatabase: use } = await import('../../core/db');
    const { gig } = await setupGig();
    await ensureGigDay(gig.id, 'nl');
    await setWish(gig.id, 'w1', { mc: 'gijs' });
    await regenerate(gig.id, 'nl');
    const file = await exportPlan(gig.id);
    const count = (await db.timelineSteps.where('gigId').equals(gig.id).count());
    use('gigday-other-' + n);
    await ensureSeed();
    const r = await importPlan(JSON.stringify(file));
    const { db: other } = await import('../../core/db');
    expect(r.inserted).toBeGreaterThan(count);
    expect(await other.timelineSteps.where('gigId').equals(gig.id).count()).toBe(count);
    expect((await other.gigs.get(gig.id))?.musicWishes.find((w) => w.id === 'w1')?.mc).toBe('gijs');
  });
});
