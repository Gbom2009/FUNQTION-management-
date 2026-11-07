import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { DEFAULT_SETTINGS, type Clause, type ContractSignature, type ContractTemplate, type Gig, type Quote } from '../../../core/types';
import { TERMS_EN, TERMS_NL } from '../../invoicing/terms';
import { paperLogo } from '../../invoicing/domain/pdfDoc';
import { DEFAULT_CLAUSES, DEFAULT_TEMPLATES } from './library';
import {
  buildSnapshot, cancellationFeePct, cancellationRows, cancellationText, canonical, clauseStates, currentClauses, fill, hashSnapshot, signByDate,
  snapshotDiff, unresolved, warningsFor,
} from './render';
import { contractDefinition } from './pdfDoc';

const base = { createdAt: '', createdBy: 'gijs' as const, updatedAt: '', updatedBy: 'gijs' as const };
const clauses: Clause[] = DEFAULT_CLAUSES.map((c, i) => ({ ...base, ...c, id: c.key, version: 1, sort: i, active: true }));
const tpl = (name: string): ContractTemplate => {
  const { rider: _r, ...t } = DEFAULT_TEMPLATES.find((x) => x.name === name)!;
  return { ...base, ...t, id: name };
};
const settings = { ...DEFAULT_SETTINGS, legalNames: 'G. Gijsen en C. Coenen', termsNl: TERMS_NL, termsEn: TERMS_EN, address: 'Dorpsstraat 1', postcode: '5735 AA', city: 'Aarle-Rixtel' };
const gig: Gig = {
  ...base, id: 'g', reference: 'FQ-2027-014', title: 'Bruiloft Lisa & Tom', eventType: 'wedding', setting: 'outdoor', date: '2027-06-12', startTime: '21:00', endTime: '01:00',
  setupTime: '19:00', setupRequired: true, stage: 'quote_sent', stageChangedAt: '', ownerId: 'gijs', performers: ['gijs', 'coen'], setSlots: [], contacts: [], musicWishes: [],
};
const quote: Quote = {
  ...base, id: 'q', gigId: 'g', version: 1, number: 'O2027-G-0001', status: 'sent', language: 'nl', depositPct: 50, vatMode: 'private',
  lines: [
    { id: 'l1', description: 'DJ-set', quantity: 5, unit: 'hour', unitPrice: 15000, vatRate: 0 },
    { id: 'l2', description: 'Geluidsset', quantity: 1, unit: 'flat', unitPrice: 15000, vatRate: 0 },
    { id: 'l3', description: 'Lasershow', quantity: 1, unit: 'flat', unitPrice: 12500, vatRate: 0, optional: true, selected: false },
  ],
};
const snap = (over: Partial<Parameters<typeof buildSnapshot>[0]> = {}) => buildSnapshot({
  contract: { number: 'C-FQ-2027-014', clientKind: 'consumer', language: 'nl', clauseOverrides: {}, overtimeRate: 7500 },
  gig, quote, template: tpl('Bruiloft'), clauses, settings, today: '2026-11-07', termsSha256: 'abc',
  client: { name: 'Lisa van den Heuvel', address: 'Kerkstraat 5\n5735 AB Aarle-Rixtel', email: 'lisa@example.nl' },
  venue: { ...base, id: 'v', name: 'Kasteel Croy', street: 'Croy 11', postcode: '5735 PN', city: 'Aarle-Rixtel', soundLimitDb: 95 },
  memberNames: { gijs: 'Gijs', coen: 'Coen' }, ...over,
});

describe('cancellation table', () => {
  const scale = DEFAULT_SETTINGS.cancellationScaleConsumer;
  it('turns days into real dates and drops bands that already passed', () => {
    const rows = cancellationRows(scale, '2027-06-12', '2026-11-07');
    expect(rows[0]).toMatchObject({ pct: 10, until: '2026-12-11' });
    expect(rows[1]).toMatchObject({ pct: 25, from: '2026-12-12', until: '2027-03-13' });
    expect(rows.at(-1)).toMatchObject({ pct: 100, from: '2027-05-30', until: '2027-06-12' });
    const late = cancellationRows(scale, '2027-06-12', '2027-05-01');
    expect(late.map((r) => r.pct)).toEqual([50, 75, 100]);
    expect(late[0].from).toBeUndefined();
    expect(cancellationText(late, 'nl')).toContain('tot en met 13 mei 2027: 50%');
    expect(cancellationText(late, 'en')).toContain('including the day itself: 100%');
  });
  it('computes the fee from the frozen rows', () => {
    const rows = cancellationRows(scale, '2027-06-12', '2026-11-07');
    expect(cancellationFeePct(rows, '2027-06-12', '2026-12-01').pct).toBe(10);
    expect(cancellationFeePct(rows, '2027-06-12', '2027-05-20').pct).toBe(75);
    expect(cancellationFeePct(rows, '2027-06-12', '2027-06-12').pct).toBe(100);
  });
});

describe('clauses and snapshot', () => {
  it('switches clauses by template, client kind, conditions and overrides', () => {
    const ctx = { clientKind: 'consumer' as const, outdoor: true, setup: false };
    const st = clauseStates(tpl('Bruiloft'), clauses, ctx);
    const on = (k: string) => st.find((x) => x.clause.key === k)?.on;
    expect(on('K3')).toBe(true);           // consumer-only, required
    expect(on('G4')).toBe(true);           // auto: outdoor
    expect(on('G6')).toBe(false);          // auto: setup (false)
    expect(on('G5')).toBe(false);
    expect(clauseStates(tpl('Bruiloft'), clauses, ctx, { G5: true, K1: false }).find((x) => x.clause.key === 'K1')?.on).toBe(true); // locked
    const biz = clauseStates(tpl('Bedrijfsfeest'), clauses, { ...ctx, clientKind: 'business' });
    expect(biz.some((x) => x.clause.key === 'K3')).toBe(false);
  });
  it('uses the newest clause version', () => {
    const v2 = { ...clauses[0], id: 'K1b', version: 2, titleNl: 'Nieuw' };
    expect(currentClauses([...clauses, v2]).find((c) => c.key === 'K1')?.titleNl).toBe('Nieuw');
  });
  it('fills every placeholder and numbers the articles', () => {
    const s = snap();
    expect(s.clauses.flatMap((c) => unresolved(c.body))).toEqual([]);
    expect(s.price.total).toBe(90000);
    expect(s.price.depositAmount).toBe(45000);
    expect(s.extras).toEqual([{ id: 'l3', description: 'Lasershow', amount: 12500 }]);
    const k3 = s.clauses.find((c) => c.key === 'K3')!;
    const a1 = s.clauses.find((c) => c.key === 'A1')!;
    expect(k3.body).toContain(`artikel ${a1.nr}`);
    expect(a1.body).toContain('tot en met 11 december 2026: 10%');
    expect(s.clauses.find((c) => c.key === 'G2')!.body).toContain('95 dB(A)');
    expect(s.clauses.find((c) => c.key === 'K2')!.body).toContain('G. Gijsen en C. Coenen');
    expect(s.terms.text).toContain('Consumenten (particuliere opdrachtgevers):');
    expect(s.rider).toBeNull();
    expect(warningsFor(s, { flow: 'together', legalNames: settings.legalNames, hasVenue: true })).toEqual([]);
  });
  it('uses the business variant and business scale for companies', () => {
    const s = snap({ contract: { number: 'C', clientKind: 'business', language: 'en', clauseOverrides: {} }, template: tpl('Bedrijfsfeest') });
    expect(s.clauses.find((c) => c.key === 'L1')!.body).toContain('indirect damage');
    expect(s.cancellation[0].pct).toBe(25);
  });
  it('warns about missing data and blocks on unresolved fields', () => {
    const s = snap({ venue: undefined, client: { name: 'Lisa' } });
    const w = warningsFor({ ...s, clauses: [...s.clauses, { key: 'X', version: 1, nr: 99, title: 'x', body: 'See {{unknown}}' }] }, { flow: 'together', hasVenue: false });
    expect(w.map((x) => x.key)).toEqual(expect.arrayContaining(['noClientAddress', 'noClientEmail', 'noVenue', 'noLegalNames', 'placeholder']));
    expect(w.find((x) => x.key === 'placeholder')).toMatchObject({ detail: 'unknown', blocking: true });
  });
  it('lists what an addendum changes', () => {
    const a = snap();
    const b = snap({ gig: { ...gig, endTime: '02:00' }, contract: { number: 'C-FQ-2027-014', clientKind: 'consumer', language: 'nl', clauseOverrides: {}, overtimeRate: 7500, specialTerms: 'Extra uur' } });
    expect(snapshotDiff(a, b).map((x) => x.field)).toEqual(['sets', 'special']);
  });
});

describe('hashing and helpers', () => {
  it('canonical JSON ignores key order and undefined', async () => {
    expect(canonical({ b: 1, a: [1, { d: undefined, c: 'x' }] })).toBe('{"a":[1,{"c":"x"}],"b":1}');
    const s = snap();
    const h1 = await hashSnapshot(s);
    const h2 = await hashSnapshot(JSON.parse(JSON.stringify(s)));
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h2).toBe(h1);
    expect(await hashSnapshot({ ...s, price: { ...s.price, total: 1 } })).not.toBe(h1);
  });
  it('fills placeholders and keeps unknown ones', () => {
    expect(fill('Hoi {{a}} {{ b.c }} {{x}}', { a: '1', 'b.c': '2' })).toBe('Hoi 1 2 {{x}}');
  });
  it('caps the sign-by date before the gig', () => {
    expect(signByDate('2027-06-01', 7, '2027-06-12')).toBe('2027-06-08');
    expect(signByDate('2027-06-01', 14, '2027-06-12')).toBe('2027-06-10');
    expect(signByDate('2027-06-11', 7, '2027-06-12')).toBe('2027-06-11');
  });
});

// Renders real PDFs with pdfmake's Node printer, like the App 2 tests.
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
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('contract pdf', () => {
  it('renders a draft, a signed contract with certificate and an addendum', async () => {
    const s = snap({ rider: { ...base, id: 'r', name: 'Standaard rider', version: 1, active: true, technical: [{ id: 't', nl: 'Stroom 2 × 16 A', en: 'Power' }], hospitality: [{ id: 'h', nl: 'Drinken voor {{performersCount}}', en: 'x' }] } });
    expect(s.rider?.hospitality[0]).toBe('Drinken voor 2');
    const logo = paperLogo(readFileSync('public/logo.svg', 'utf8'));
    const draft = await render(contractDefinition({ version: { kind: 'contract', label: 'concept', status: 'draft' }, snapshot: s, logoSvg: logo, businessName: 'Team Funqtion' }));
    expect(draft.subarray(0, 4).toString()).toBe('%PDF');
    const hash = await hashSnapshot(s);
    const sig = (party: 'client' | 'funqtion'): ContractSignature => ({ ...base, id: party, contractId: 'c', versionId: 'v', party, name: party === 'client' ? 'Lisa' : 'Gijs (Team Funqtion)',
      method: party === 'client' ? 'reply_akkoord' : 'countersign', channel: party === 'client' ? 'whatsapp' : undefined, level: 'SES', signedAt: '2026-11-08T19:12:00.000Z', contentHash: hash,
      consents: { contract: true, terms: '2026-12', termsSha256: 'abc', photoOptOut: party === 'client' }, selectedExtras: ['l3'], imageDataUrl: party === 'funqtion' ? PNG : undefined, evidenceDataUrl: party === 'client' ? PNG : undefined });
    const version = { kind: 'contract' as const, label: 'v1', contentHash: hash, frozenAt: '2026-11-07T10:00:00.000Z', status: 'signed' as const };
    const signed = await render(contractDefinition({ version, snapshot: s, signatures: [sig('client'), sig('funqtion')], events: [{ ...base, id: 'e', contractId: 'c', type: 'fully_signed', at: '2026-11-08T19:12:00.000Z' }], logoSvg: logo, businessName: 'Team Funqtion' }));
    expect(signed.length).toBeGreaterThan(draft.length);
    if (process.env.PDF_OUT) writeFileSync(`${process.env.PDF_OUT}/contract.pdf`, signed);
    const add = { ...s, addendum: { label: 'Addendum 1', parentLabel: 'v1', parentHash: hash, reason: 'Een uur langer', changes: [{ field: 'sets', old: '21:00–01:00', new: '21:00–02:00' }] } };
    const addPdf = await render(contractDefinition({ version: { ...version, kind: 'addendum', label: 'Addendum 1', prevHash: hash }, snapshot: add, logoSvg: logo, businessName: 'Team Funqtion' }));
    expect(addPdf.subarray(0, 4).toString()).toBe('%PDF');
    if (process.env.PDF_OUT) writeFileSync(`${process.env.PDF_OUT}/addendum.pdf`, addPdf);
  });
});
