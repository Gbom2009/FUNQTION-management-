import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { GearItem, GearKit, MaintenanceLog, MaintenancePlan, PackLine } from '../../../core/types';
import {
  applyScan, defaultSetup, gearConflicts, generateLines, insuranceTotals, itemsFromCsv, itemsToCsv, loadByTransport, maintenanceDue, mergeLines, nextCode, makeCode, checkChar, codeProblem, codeMatchesParent, normaliseCode,
  parseCsv, progress, safetyDue, trailerPayload,
} from './gear';
import { insuranceList, labelSheets } from './pdfDocs';
import { DEFAULT_PRESETS } from './labelArt';

const base = { createdAt: '2026-01-01T00:00:00.000Z', createdBy: 'gijs' as const, updatedAt: '', updatedBy: 'gijs' as const };
const item = (id: string, p: Partial<GearItem> = {}): GearItem => ({
  ...base, id, code: `FQ-${id.padStart(4, '0')}`, kind: 'unique', name: `Item ${id}`, category: 'speakers', quantity: 1, owner: 'shared', status: 'available',
  transport: 'trailer', electrical: 'class1', usageHours: 0, usageGigs: 0, ...p,
});
const kit = (role: GearKit['role'], lines: [string, number][], id: string = role): GearKit => ({ ...base, id, role, name: role, lines: lines.map(([itemId, qty]) => ({ itemId, qty })) });
let n = 0;
const uid = () => `l${n++}`;

describe('codes', () => {
  it('numbers top-level items after the highest number in use (old codes included)', () => {
    expect(nextCode([{ code: 'FQ-0001' }, { code: 'FQ-0103' }])).toBe(makeCode('104'));
    expect(nextCode([])).toBe('FQ-01-' + checkChar('01'));
    expect(nextCode([{ code: makeCode('01') }, { code: makeCode('01.1') }])).toBe(makeCode('02'));
  });
  it('gives things in a case the case number + their own number, at any depth', () => {
    const rack = { code: makeCode('04') };
    const items = [rack, { code: makeCode('04.1') }, { code: makeCode('04.2') }, { code: makeCode('05.7') }];
    expect(nextCode(items, rack)).toBe(makeCode('04.3'));
    const drawer = { code: makeCode('04.2') };
    expect(nextCode(items, drawer)).toBe(makeCode('04.2.1'));
    // A case with an old flat code: its number is the tree number.
    expect(nextCode([{ code: 'FQ-0009' }, { code: makeCode('9.1') }], { code: 'FQ-0009' })).toBe(makeCode('9.2'));
  });
  it('counts aliases, so a relabelled item never gets its old number reused', () => {
    expect(nextCode([{ code: makeCode('01.3'), aliases: [makeCode('01.5')] }], { code: makeCode('01') })).toBe(makeCode('01.6'));
  });
  it('check character catches every single typo and every swap of neighbours', () => {
    const base = '04.12';
    const good = makeCode(base);
    expect(normaliseCode(good)).toBe(good);
    const chars = '0123456789.';
    for (let i = 0; i < base.length; i++) {
      for (const c of chars) {
        if (c === base[i]) continue;
        const typo = base.slice(0, i) + c + base.slice(i + 1);
        if (!/^\d+(\.\d+)*$/.test(typo)) continue;
        expect(checkChar(typo)).not.toBe(checkChar(base));
      }
      if (i < base.length - 1 && base[i] !== base[i + 1]) {
        const swap = base.slice(0, i) + base[i + 1] + base[i] + base.slice(i + 2);
        if (/^\d+(\.\d+)*$/.test(swap)) expect(checkChar(swap)).not.toBe(checkChar(base));
      }
    }
    const wrong = `FQ-${base}-${checkChar(base) === '0' ? '1' : '0'}`;
    expect(normaliseCode(wrong)).toBeNull();
    expect(codeProblem(wrong)).toBe('check');
    expect(codeProblem(good)).toBeNull();
  });
  it('understands typed, scanned and old codes', () => {
    const c = makeCode('01.2');
    expect(normaliseCode(c.toLowerCase())).toBe(c);
    expect(normaliseCode(` ${c.replace('FQ-', 'fq ')} `)).toBe(c);
    expect(normaliseCode(`https://funqtion.example/g/${c}`)).toBe(c);
    expect(normaliseCode('42')).toBe('FQ-0042');
    expect(normaliseCode('fq-0042')).toBe('FQ-0042');
    expect(normaliseCode('FQ0042')).toBe('FQ-0042');
    expect(normaliseCode('FQ-0031-DUP-AB12')).toBe('FQ-0031-DUP-AB12');
    expect(normaliseCode('hallo')).toBeNull();
  });
  it('knows when a code no longer matches its case (offer a new label)', () => {
    const caseA = { code: makeCode('01') };
    const caseB = { code: makeCode('02') };
    expect(codeMatchesParent({ code: makeCode('01.3') }, caseA)).toBe(true);
    expect(codeMatchesParent({ code: makeCode('01.3') }, caseB)).toBe(false);
    expect(codeMatchesParent({ code: makeCode('01.3') }, null)).toBe(false);
    expect(codeMatchesParent({ code: makeCode('03') }, null)).toBe(true);
    expect(codeMatchesParent({ code: makeCode('03') }, caseA)).toBe(false);
    expect(codeMatchesParent({ code: 'FQ-0014' }, caseB)).toBe(true); // old flat codes make no claim
    expect(codeMatchesParent({ code: makeCode('9.1') }, { code: 'FQ-0009' })).toBe(true);
  });
});

describe('packing list', () => {
  const items = ['1', '2', '3', '4', '5', '6'].map((id) => item(id));
  items.push(item('7', { kind: 'counted', quantity: 6, category: 'audio_cables' }));
  const kits = [kit('standard', [['1', 1], ['2', 1], ['3', 1], ['7', 4]]), kit('dj_controller', [['1', 1]]), kit('always', [['5', 1], ['7', 2]]), kit('outdoor', [['6', 1]]), kit('custom', [['4', 1]], 'laserkit')];
  const products = [{ id: 'p-laser', kitIds: ['laserkit'] }];
  it('uses the standard set unless the venue has its own sound or there is no build-up', () => {
    expect(defaultSetup({ setupRequired: true, setting: '' }, { houseSound: false })).toBe('standard');
    expect(defaultSetup({ setupRequired: true, setting: '' }, { houseSound: true })).toBe('dj_controller');
    expect(defaultSetup({ setupRequired: false, setting: '' })).toBe('dj_controller');
  });
  it('combines the set-up, sold products, outdoor and always-bring, once per item', () => {
    const quote = { lines: [{ id: 'q', description: 'Laser', quantity: 1, unit: 'flat' as const, unitPrice: 1, vatRate: 0, productId: 'p-laser', optional: true, selected: true }] };
    const lines = generateLines({ gig: { setupRequired: true, setting: 'outdoor' }, quote, products, kits, items }, 'standard', uid);
    expect(lines.map((l) => l.itemId).sort()).toEqual(['1', '2', '3', '4', '5', '6', '7']);
    expect(lines.find((l) => l.itemId === '7')!.qty).toBe(4); // max of 4 and 2, not 6
    expect(lines.find((l) => l.itemId === '4')!).toMatchObject({ source: 'quote', reason: 'Laser' });
    const unselected = generateLines({ gig: { setupRequired: true, setting: '' }, quote: { lines: [{ ...quote.lines[0], selected: false }] }, products, kits, items }, 'dj_controller', uid);
    expect(unselected.map((l) => l.itemId).sort()).toEqual(['1', '5', '7']);
  });
  it('keeps manual lines and progress when rebuilding', () => {
    const old: PackLine[] = [{ id: 'a', itemId: '1', qty: 1, source: 'kit', reason: '', out: 1, back: 0 }, { id: 'm', itemId: '9', qty: 1, source: 'manual', reason: '', out: 0, back: 0 }];
    const fresh = generateLines({ gig: { setupRequired: true, setting: '' }, products, kits, items }, 'dj_controller', uid);
    const merged = mergeLines(old, fresh);
    expect(merged.find((l) => l.itemId === '1')).toMatchObject({ id: 'a', out: 1 });
    expect(merged.some((l) => l.itemId === '9')).toBe(true);
  });
  it('ticks off a container with its contents and blocks broken gear', () => {
    const lines: PackLine[] = ['1', '2', '3'].map((id) => ({ id: `l${id}`, itemId: id, qty: 1, source: 'kit', reason: '', out: 0, back: 0 }));
    const r = applyScan(lines, { id: '1', status: 'available' }, ['2'], 'out');
    expect(r.outcome).toEqual({ kind: 'ticked', lineIds: ['l1', 'l2'] });
    expect(progress(r.lines, 'out')).toMatchObject({ lines: 3, done: 2 });
    expect(applyScan(r.lines, { id: '1', status: 'available' }, [], 'out').outcome.kind).toBe('already');
    expect(applyScan(r.lines, { id: '9', status: 'available' }, [], 'out').outcome.kind).toBe('not_on_list');
    expect(applyScan(lines, { id: '3', status: 'out_of_service' }, [], 'out').outcome).toEqual({ kind: 'blocked', reason: 'out_of_service' });
    const back = applyScan(r.lines, { id: '2', status: 'out' }, [], 'back');
    expect(back.lines.find((l) => l.itemId === '2')!.back).toBe(1);
    expect(applyScan(r.lines, { id: '3', status: 'out' }, [], 'back').outcome.kind).toBe('not_on_list'); // never went out
  });
});

describe('conflicts', () => {
  const gig = (id: string, date: string, start: string, end: string) => ({ id, date, startTime: start, endTime: end, stage: 'confirmed' as const });
  const list = (gigId: string, lines: [string, number][]) => ({ gigId, status: 'confirmed' as const, lines: lines.map(([itemId, qty]) => ({ id: itemId, itemId, qty, source: 'kit' as const, reason: '', out: 0, back: 0 })) });
  const items = [item('1'), item('7', { kind: 'counted', quantity: 6 })];
  it('finds the same item in overlapping gigs and counted items beyond stock', () => {
    const c = gearConflicts([
      { list: list('a', [['1', 1], ['7', 4]]), gig: gig('a', '2027-06-12', '14:00', '17:00') },
      { list: list('b', [['1', 1], ['7', 2]]), gig: gig('b', '2027-06-12', '20:00', '23:00') },
    ], items, 120);
    expect(c).toEqual([{ itemId: '1', gigIds: ['a', 'b'], need: 2, have: 1 }]); // 4 + 2 cables = 6 → fine
  });
  it('ignores gigs far enough apart and cancelled gigs', () => {
    expect(gearConflicts([
      { list: list('a', [['1', 1]]), gig: gig('a', '2027-06-12', '12:00', '14:00') },
      { list: list('b', [['1', 1]]), gig: gig('b', '2027-06-12', '20:00', '23:00') },
    ], items, 60)).toEqual([]);
    expect(gearConflicts([
      { list: list('a', [['1', 1]]), gig: gig('a', '2027-06-12', '20:00', '23:00') },
      { list: list('b', [['1', 1]]), gig: { ...gig('b', '2027-06-12', '20:00', '23:00'), stage: 'cancelled' } },
    ], items, 60)).toEqual([]);
  });
});

describe('trailer, maintenance, safety, insurance', () => {
  it('adds up weight per transport against the 750 kg trailer', () => {
    const items = [item('1', { weightKg: 30 }), item('2', { weightKg: 4, transport: 'car' }), item('3', { kind: 'counted', quantity: 6, weightKg: 0.5 }), item('4')];
    const lines = ['1', '2', '3', '4'].map((id) => ({ id, itemId: id, qty: id === '3' ? 4 : 1, source: 'kit' as const, reason: '', out: 0, back: 0 }));
    expect(loadByTransport(lines, items)).toEqual({ trailerKg: 32, carKg: 4, unknownWeight: 1 });
    expect(trailerPayload({ gearTrailerMaxKg: 750 })).toBe(750);
    expect(trailerPayload({ gearTrailerMaxKg: 750, gearTrailerEmptyKg: 180 })).toBe(570);
  });
  it('knows when maintenance is due by date, hours or gigs', () => {
    const laser = item('3', { category: 'lasers', usageHours: 52 });
    const cable = item('7', { category: 'audio_cables', purchaseDate: '2026-01-01' });
    const plans: MaintenancePlan[] = [
      { ...base, id: 'p1', category: 'lasers', title: 'Optiek', trigger: 'hours', interval: 50, active: true },
      { ...base, id: 'p2', category: 'audio_cables', title: 'Kabeltest', trigger: 'days', interval: 180, active: true },
    ];
    const due = maintenanceDue(plans, [laser, cable], [], '2026-11-07');
    expect(due.find((d) => d.planId === 'p1')).toMatchObject({ overdue: true, dueAt: 50 });
    expect(due.find((d) => d.planId === 'p2')).toMatchObject({ overdue: true, dueDate: '2026-06-30' });
    const logs: MaintenanceLog[] = [{ ...base, id: 'x', planId: 'p1', itemId: '3', doneAt: '2026-10-01', result: 'ok', usageHours: 50, usageGigs: 0 }];
    expect(maintenanceDue(plans, [laser], logs, '2026-11-07').find((d) => d.planId === 'p1')).toMatchObject({ overdue: false, dueAt: 100 });
  });
  it('lists electrical gear without a test as overdue', () => {
    const s = { gearSafetyMonths: 12, gearSafetyMonthsPower: 6 };
    const d = safetyDue([item('1'), item('2', { electrical: 'none' })], [{ ...base, id: 't', itemId: '1', date: '2026-01-01', inspector: 'X', passed: true, nextDue: '2027-01-01' }], s, '2026-11-07');
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ overdue: false, dueDate: '2027-01-01' });
  });
  it('totals values per owner', () => {
    const t = insuranceTotals([item('1', { owner: 'gijs', purchasePrice: 100000, replacementValue: 120000 }), item('2', { owner: 'coen', purchasePrice: 50000 }), item('3', { status: 'disposed', purchasePrice: 999 }), item('4')]);
    expect(t).toMatchObject({ count: 3, purchase: 150000, replacement: 170000, withoutValue: 1 });
    expect(t.byOwner).toMatchObject({ gijs: 120000, coen: 50000, shared: 0 });
  });
});

describe('gear-list.csv', () => {
  const text = readFileSync('docs/gear-inventory/gear-list.csv', 'utf8');
  it('parses the (temporary) list in the repo, including the confirmed standard set', () => {
    const rows = itemsFromCsv(parseCsv(text));
    expect(rows.length).toBeGreaterThan(20);
    const laser = rows.find((r) => r.item.model === 'DS-1000 Mark III')!;
    expect(laser.item).toMatchObject({ brand: 'Laserworld', category: 'lasers', owner: 'gijs', transport: 'car' });
    expect(laser.kits).toEqual(['standard']);
    expect(rows.find((r) => r.item.code === 'FQ-0001')!.kits).toEqual(['standard', 'dj_controller', 'dj_light']);
    expect(rows.filter((r) => r.kits.includes('standard')).length).toBeGreaterThanOrEqual(8);
    expect(new Set(rows.map((r) => r.item.code)).size).toBe(rows.length);
  });
  it('round-trips through the export format', () => {
    const items = [item('1', { name: 'Kabel, "lang"', notes: 'a,b' })];
    const out = itemsToCsv(items, [kit('standard', [['1', 1]])], { locationKey: () => 'home_gijs', codeOf: () => '' });
    const back = itemsFromCsv(parseCsv(out));
    expect(back[0].item).toMatchObject({ code: 'FQ-0001', name: 'Kabel, "lang"', notes: 'a,b' });
    expect(back[0]).toMatchObject({ homeKey: 'home_gijs', kits: ['standard'] });
  });
});

const require = createRequire(import.meta.url);
const F = 'node_modules/@fontsource/';
function render(def: unknown): Promise<Buffer> {
  const PdfPrinter = require('pdfmake/src/printer');
  const printer = new PdfPrinter({
    Mono: { normal: `${F}jetbrains-mono/files/jetbrains-mono-latin-300-normal.woff`, bold: `${F}jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff`,
      italics: `${F}jetbrains-mono/files/jetbrains-mono-latin-300-normal.woff`, bolditalics: `${F}jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff` },
    Display: { normal: `${F}archivo-black/files/archivo-black-latin-400-normal.woff`, bold: `${F}archivo-black/files/archivo-black-latin-400-normal.woff` },
  });
  const doc = printer.createPdfKitDocument(def);
  const chunks: Buffer[] = [];
  return new Promise((res) => { doc.on('data', (c: Buffer) => chunks.push(c)); doc.on('end', () => res(Buffer.concat(chunks))); doc.end(); });
}

describe('gear pdfs', () => {
  it('renders QR label sheets and the insurance list', async () => {
    const items = Array.from({ length: 23 }, (_, i) => item(String(i + 1), { name: `Item met een vrij lange naam ${i + 1}` }));
    const bars = Object.fromEntries(items.map((i) => [i.code, { modules: 20, bars: [[0, 2], [3, 1], [6, 3]] as [number, number][] }]));
    const qr = Object.fromEntries(items.map((i) => [i.code, { size: 21, dark: Array.from({ length: 441 }, (_, k) => k % 3 === 0) }]));
    const logoSvg = readFileSync('public/logo.svg', 'utf8');
    const sheet = await render(labelSheets(DEFAULT_PRESETS.map((preset, k) => ({ preset, items: items.slice(k * 4, k * 4 + 4) })), 'Eigendom van Team Funqtion', { qr, bars, logoSvg }));
    expect(sheet.subarray(0, 4).toString()).toBe('%PDF');
    const pdf = await render(insuranceList(items.map((i) => ({ item: { ...i, purchasePrice: 10000 }, locationName: 'Thuis Gijs', hasPhoto: true, hasReceipt: false })), { lang: 'nl', businessName: 'Team Funqtion', date: '2026-11-07', total: 230000 }));
    expect(pdf.length).toBeGreaterThan(1000);
  });
});
