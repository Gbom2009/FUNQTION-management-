import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { useTestDatabase } from '../../core/db';
import { save, setActor } from '../../core/repo';
import { ensureSeed } from '../../core/seed';
import { addDays, toDateStr } from '../../core/dates';
import type { Venue } from '../../core/types';
import { blankGig, createGig } from '../bookings/data';
import { desiredTasks } from '../bookings/domain/reminders';
import { runTaskSync } from '../bookings/domain/taskSync';
import {
  allConflicts, finishLoading, finishReturn, getOrCreatePackList, importGearCsv, regenerate, reportIssue, resolveIssue, saveRental, scanInto, returnRental, setParent, splitCounted,
} from './data';

// End-to-end through the database with the real (temporary) gear list.

let n = 0;
beforeEach(async () => { useTestDatabase('gear-' + n++); setActor('gijs'); await ensureSeed(); });
afterEach(async () => { await runTaskSync(); });
const inDays = (d: number) => toDateStr(addDays(new Date(), d));
const csv = readFileSync('docs/gear-inventory/gear-list.csv', 'utf8');

describe('gear flow', () => {
  it('imports the list, packs the standard set, loads, unloads with a missing item', async () => {
    const { db } = await import('../../core/db');
    const r = await importGearCsv(csv);
    expect(r.added).toBeGreaterThan(20);
    expect(await importGearCsv(csv)).toMatchObject({ added: 0, updated: 0 }); // idempotent by code
    // An older import without the flight case: re-importing adds the case and puts the controller in it.
    const ctrl = (await db.gearItems.where('code').equals('FQ-0001').first())!;
    await save('gearItems', { ...ctrl, parentId: undefined, brand: undefined, labelType: undefined });
    await save('gearItems', { ...(await db.gearItems.where('code').equals('FQ-0009').first())!, deletedAt: new Date().toISOString(), code: 'FQ-9009' });
    const again = await importGearCsv(csv);
    expect(again.added).toBe(1);
    const ctrl2 = (await db.gearItems.get(ctrl.id))!;
    expect(ctrl2.brand).toBe('Pioneer DJ');
    expect((await db.gearItems.get(ctrl2.parentId!))!.code).toBe('FQ-0009');
    const standard = (await db.gearKits.toArray()).find((k) => k.role === 'standard')!;
    expect(standard.lines.length).toBeGreaterThanOrEqual(8);
    const bag = (await db.gearItems.where('code').equals('FQ-0103').first())!;
    expect((await db.gearItems.where('parentId').equals(bag.id).count())).toBeGreaterThan(3);

    const gig = await createGig(blankGig('gijs', { title: 'Bruiloft', eventType: 'wedding', date: inDays(20), startTime: '20:00', endTime: '01:00', setupTime: '18:00', stage: 'confirmed' }));
    let list = await getOrCreatePackList(gig.id);
    expect(list.setup).toBe('standard');
    const codes = async () => { const all = await db.gearItems.toArray(); return new Map(all.map((i) => [i.id, i.code])); };
    const byId = await codes();
    expect(list.lines.map((l) => byId.get(l.itemId))).toEqual(expect.arrayContaining(['FQ-0001', 'FQ-0003', 'FQ-0006', 'FQ-0103', 'FQ-0043']));

    // Scan everything; the bag ticks off its contents.
    let res = await scanInto(list, 'FQ-0103', 'out');
    expect(res.outcome.kind).toBe('ticked');
    expect((res.outcome as { lineIds: string[] }).lineIds.length).toBeGreaterThan(3);
    list = res.list;
    for (const l of list.lines.filter((x) => x.out < x.qty)) list = (await scanInto(list, byId.get(l.itemId)!, 'out')).list;
    expect(list.lines.every((l) => l.out >= l.qty)).toBe(true);
    list = await finishLoading(list);
    const laser = (await db.gearItems.where('code').equals('FQ-0003').first())!;
    expect(laser.status).toBe('out');

    // Back: everything except the laser.
    for (const l of list.lines) if (l.itemId !== laser.id) list = (await scanInto(list, byId.get(l.itemId)!, 'back')).list;
    list = { ...list, lines: list.lines.map((l) => (l.itemId === laser.id ? { ...l, missing: 'lost' as const } : l)) };
    list = await finishReturn(list, 'coen', { empty: true, hitchLock: true });
    expect(list).toMatchObject({ status: 'done', trailer: { empty: true, hitchLock: true } });
    expect((await db.gearItems.get(laser.id))!.status).toBe('missing');
    const controller = (await db.gearItems.where('code').equals('FQ-0001').first())!;
    expect(controller).toMatchObject({ status: 'available', usageGigs: 1, usageHours: 5 }); // 20:00–01:00 playing time
    const tasks = desiredTasks({ gigs: await db.gigs.toArray(), enquiries: [], quotes: [], reviews: [],
      gear: { items: await db.gearItems.toArray(), lists: await db.packLists.toArray(), rentals: [] } }, (await db.settings.get('settings'))!);
    expect(tasks.some((t) => t.kind === 'gear_missing' && t.params.code === 'FQ-0003')).toBe(true);
  });

  it('switches to a DJ-only set-up for venues with their own sound, and finds conflicts', async () => {
    const { db } = await import('../../core/db');
    await importGearCsv(csv);
    const v = await save<Venue>('venues', { name: 'Club', houseSound: true });
    const a = await createGig(blankGig('gijs', { title: 'Club', eventType: 'club', date: inDays(10), startTime: '22:00', endTime: '02:00', venueId: v.id, stage: 'confirmed' }));
    const b = await createGig(blankGig('coen', { title: 'Feest', eventType: 'private_party', date: inDays(10), startTime: '20:00', endTime: '23:00', stage: 'confirmed' }));
    let la = await getOrCreatePackList(a.id);
    expect(la.setup).toBe('dj_controller');
    la = await regenerate(la, 'dj_usb');
    const codes = new Map((await db.gearItems.toArray()).map((i) => [i.id, i.code]));
    expect(la.lines.map((l) => codes.get(l.itemId))).not.toContain('FQ-0001'); // USB only: no controller
    await regenerate(la, 'dj_controller');
    await getOrCreatePackList(b.id);
    const c = await allConflicts();
    expect(c.some((x) => codes.get(x.itemId) === 'FQ-0001')).toBe(true); // the one controller, two gigs the same evening
  });

  it('links repairs and rented-in gear to Money & accounting as expenses', async () => {
    const { db } = await import('../../core/db');
    await importGearCsv(csv);
    const sub = (await db.gearItems.where('code').equals('FQ-0006').first())!;
    const issue = await reportIssue(sub, { title: 'Kraakt', severity: 'out_of_service' });
    expect((await db.gearItems.get(sub.id))!.status).toBe('out_of_service');
    await resolveIssue(issue, { work: 'Conus vervangen', cost: 8500, repairBy: 'Audio Service' });
    expect((await db.gearItems.get(sub.id))!.status).toBe('available');
    const exp = (await db.expenses.toArray()).find((e) => e.amount === 8500)!;
    expect(exp).toMatchObject({ supplier: 'Audio Service', status: 'missing_receipt' });
    const rental = await saveRental({ direction: 'in', party: 'Verhuur BV', from: inDays(3), until: inDays(4), price: 6000, lines: [{ description: 'Extra sub', qty: 1 }] });
    expect(rental.expenseId).toBeTruthy();
    const lend = await saveRental({ direction: 'out', party: 'Bas', from: inDays(0), until: inDays(7), lines: [{ itemId: sub.id, description: 'Sub', qty: 1 }] });
    expect((await db.gearItems.get(sub.id))!.status).toBe('lent');
    await returnRental(lend);
    expect((await db.gearItems.get(sub.id))!.status).toBe('available');
  });

  it('loads by case (group) and unloads piece by piece (each); splits counted cables into labelled items', async () => {
    const { db } = await import('../../core/db');
    await importGearCsv(csv);
    const byCode = async (c: string) => (await db.gearItems.where('code').equals(c).first())!;
    const flight = await byCode('FQ-0009');
    expect((await db.gearItems.where('parentId').equals(flight.id).toArray()).map((i) => i.code).sort()).toEqual(['FQ-0001', 'FQ-0014']);
    expect(await setParent(flight, (await byCode('FQ-0001')).id)).toBe('cycle');
    const gig = await createGig(blankGig('gijs', { title: 'Feest', eventType: 'private_party', date: inDays(15), stage: 'confirmed' }));
    let list = await getOrCreatePackList(gig.id);
    const ids = [flight.id, (await byCode('FQ-0001')).id, (await byCode('FQ-0014')).id];
    list = { ...list, lines: list.lines.filter((l) => ids.includes(l.itemId)) };
    list = (await scanInto(list, 'FQ-0009', 'out', true)).list;
    expect(list.lines.every((l) => l.out === 1)).toBe(true);
    list = await finishLoading(list);
    list = (await scanInto(list, 'FQ-0009', 'back', false)).list;
    expect(list.lines.filter((l) => l.back === 1)).toHaveLength(1);
    list = (await scanInto(list, 'FQ-0001', 'back', false)).list;
    list = (await scanInto(list, 'FQ-0014', 'back', false)).list;
    expect(list.lines.every((l) => l.back === 1)).toBe(true);

    const xlr = await byCode('FQ-0040');
    const made = await splitCounted(xlr);
    expect(made).toHaveLength(xlr.quantity);
    expect(new Set(made.map((m) => m.code)).size).toBe(xlr.quantity);
    expect(made.every((m) => m.kind === 'unique' && m.quantity === 1 && m.parentId === xlr.parentId)).toBe(true);
    const standard = (await db.gearKits.toArray()).find((k) => k.role === 'standard')!;
    expect(made.every((m) => standard.lines.some((l) => l.itemId === m.id))).toBe(true);
  });
});
