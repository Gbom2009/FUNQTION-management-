import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { invoiceDefinition, paperLogo, quoteDefinition } from './pdfDoc';
import { DEFAULT_SETTINGS, type Gig, type Invoice, type Quote } from '../../../core/types';
import { TERMS_NL } from '../terms';

// Renders real PDFs with pdfmake's Node printer, so layout errors surface in CI.
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

const base = { createdAt: '', createdBy: 'gijs' as const, updatedAt: '', updatedBy: 'gijs' as const };
const settings = { ...DEFAULT_SETTINGS, address: 'Dorpsstraat 1', postcode: '5735 AA', city: 'Aarle-Rixtel', legalNames: 'Gijs & Coen', bizEmail: 'info@example.nl', iban: 'NL00 TEST 0123 4567 89', termsNl: TERMS_NL };
const gig = { id: 'g', title: 'Bruiloft Lisa & Tom', date: '2027-06-12', startTime: '21:00', endTime: '01:00' } as Gig;
const client = { name: 'Lisa van den Heuvel', address: 'Kerkstraat 5\n5735 AB Aarle-Rixtel', email: 'lisa@example.nl' };
const lines = [
  { id: '1', description: 'DJ-set Team Funqtion (Gijs & Coen)', quantity: 4, unit: 'hour' as const, unitPrice: 15000, vatRate: 21 },
  { id: '2', description: 'Geluidsset', quantity: 1, unit: 'flat' as const, unitPrice: 15000, vatRate: 21 },
  { id: '3', description: 'Lasershow', quantity: 1, unit: 'flat' as const, unitPrice: 12500, vatRate: 21, optional: true, selected: true },
  { id: '4', description: 'Extra uur', quantity: 1, unit: 'hour' as const, unitPrice: 12500, vatRate: 21, optional: true },
];
const logo = paperLogo(readFileSync('public/logo.svg', 'utf8'));

describe('pdf', () => {
  it('renders a quote with extras and terms', async () => {
    const q: Quote = { ...base, id: 'q', gigId: 'g', version: 1, number: 'O2027-G-0001', status: 'sent', language: 'nl', issueDate: '2027-01-10', validUntil: '2027-01-24',
      lines, client, vatMode: 'private', depositPct: 50, intro: 'Wat leuk dat jullie aan ons denken voor jullie bruiloft!' };
    const pdf = await render(quoteDefinition(q, { settings, gig, logoSvg: logo }));
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    if (process.env.PDF_OUT) writeFileSync(`${process.env.PDF_OUT}/quote.pdf`, pdf);
  });
  it('renders a VAT invoice with deposit deduction and a credit note', async () => {
    const inv: Invoice = { ...base, id: 'i', number: 'F2027-G-0002', kind: 'final', status: 'sent', language: 'en', issueDate: '2027-06-13', supplyDate: '2027-06-12', dueDate: '2027-06-27',
      lines: [...lines.slice(0, 2), { id: 'd', description: 'Less: deposit invoice F2027-G-0001', quantity: 1, unit: 'flat', unitPrice: -30000, vatRate: 21 }],
      client, seller: { name: 'Team Funqtion', kvk: '12345678', vatId: 'NL000000000B01', iban: settings.iban, accountHolder: 'Gijs & Coen', address: 'Dorpsstraat 1\n5735 AA Aarle-Rixtel' }, vatMode: 'vat' };
    const pdf = await render(invoiceDefinition(inv, { settings, gig, logoSvg: logo, payments: 5000 }));
    expect(pdf.length).toBeGreaterThan(1000);
    if (process.env.PDF_OUT) writeFileSync(`${process.env.PDF_OUT}/invoice.pdf`, pdf);
    const credit = await render(invoiceDefinition({ ...inv, kind: 'credit_note', number: 'F2027-G-0003', reason: 'Correctie', lines: inv.lines.map((l) => ({ ...l, unitPrice: -l.unitPrice })) }, { settings, refNumber: 'F2027-G-0002' }));
    expect(credit.length).toBeGreaterThan(1000);
  });
});
