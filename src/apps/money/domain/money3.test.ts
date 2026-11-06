import { describe, expect, it } from 'vitest';
import { parseAmounts, parseDate, parseReceiptText } from './receipt';
import { parseStatement, toCents } from './bank';
import { bookValue, depreciationBetween, gigProfit, hoursFor, partnerBalances, periodOf, pnl, shareOf, vatBoxes, type LedgerData } from './ledger';
import { ruleKey, suggestFor } from './match';
import { DEFAULT_SETTINGS, type Asset, type BankLine, type Category, type Expense, type Gig, type Invoice, type Payment, type Trip } from '../../../core/types';

const base = { createdAt: '', createdBy: 'gijs' as const, updatedAt: '', updatedBy: 'gijs' as const };

describe('receipt OCR parsing', () => {
  it('reads amounts in Dutch and English notation', () => {
    expect(parseAmounts('Totaal € 1.234,56')).toEqual([123456]);
    expect(parseAmounts('TOTAL 12.50 EUR')).toEqual([1250]);
    expect(parseAmounts('2 x 3,50 7,00')).toEqual([350, 700]);
  });
  it('reads dates', () => {
    expect(parseDate('Datum: 06-11-2026 14:32')).toBe('2026-11-06');
    expect(parseDate('2026-03-01')).toBe('2026-03-01');
    expect(parseDate('6 nov. 2026')).toBe('2026-11-06');
    expect(parseDate('6/11/26')).toBe('2026-11-06');
  });
  it('parses a typical Dutch till receipt', () => {
    const text = `BAX-SHOP.NL
Kabelstraat 1, Goes
Datum 14-10-2026 13:05
XLR kabel 6m            2x 12,50   25,00
Koptelefoonhoes                    19,95
SUBTOTAAL                          44,95
TOTAAL                       EUR   44,95
BTW 21%     37,15     7,80
PIN                                44,95`;
    const g = parseReceiptText(text);
    expect(g.total).toBe(4495);
    expect(g.date).toBe('2026-10-14');
    expect(g.vatRate).toBe(21);
    expect(g.vatAmount).toBe(780);
    expect(g.supplier).toBe('BAX-SHOP.NL');
  });
  it('survives OCR misreading 21% as 214', () => {
    const g = parseReceiptText('BAX-SHOP.NL\nDatum 14-10-2026 13:05\nTOTAAL EUR 44,95\nBTW 214 37,15 7,80\nPIN 44,95');
    expect(g).toMatchObject({ total: 4495, vatRate: 21, vatAmount: 780 });
  });
  it('detects 9% from (total, vat) amounts', () => {
    const g = parseReceiptText('Snackbar\nTotaal 23,50\nBTW laag 23,50 1,94');
    expect(g).toMatchObject({ vatRate: 9, vatAmount: 194 });
  });
  it('prefers a known supplier and estimates VAT from the rate', () => {
    const g = parseReceiptText('Shell Station A2\n05/11/2026\nEuro95 30,12 L\nTe betalen 60,00\n21% btw', ['Shell']);
    expect(g.supplier).toBe('Shell');
    expect(g.total).toBe(6000);
    expect(g.vatAmount).toBe(1041);
  });
});

describe('bank statements', () => {
  it('parses cents in any notation', () => {
    expect(toCents('1.234,56')).toBe(123456);
    expect(toCents('-12.30')).toBe(-1230);
    expect(toCents('+5,00')).toBe(500);
  });
  it('ING', () => {
    const csv = `"Datum";"Naam / Omschrijving";"Rekening";"Tegenrekening";"Code";"Af Bij";"Bedrag (EUR)";"Mutatiesoort";"Mededelingen"
"20261101";"Bax Shop";"NL01INGB0000000001";"NL02RABO0000000002";"GT";"Af";"44,95";"Online bankieren";"Order 123"
"20261102";"L van den Heuvel";"NL01INGB0000000001";"NL03ABNA0000000003";"GT";"Bij";"567,00";"Overschrijving";"F2026-G-0001"`;
    const r = parseStatement(csv);
    expect(r.format).toBe('ing');
    expect(r.lines.map((l) => [l.date, l.amount, l.counterparty])).toEqual([['2026-11-01', -4495, 'Bax Shop'], ['2026-11-02', 56700, 'L van den Heuvel']]);
  });
  it('Rabobank', () => {
    const csv = `"IBAN/BBAN","Munt","BIC","Volgnr","Datum","Rentedatum","Bedrag","Saldo na trn","Tegenrekening IBAN/BBAN","Naam tegenpartij","Omschrijving-1","Omschrijving-2","Omschrijving-3"
"NL01RABO0000000001","EUR","RABONL2U","000000000000001","2026-11-03","2026-11-03","-9,99","100,00","","Spotify AB","Premium","",""`;
    const r = parseStatement(csv);
    expect(r.format).toBe('rabobank');
    expect(r.lines[0]).toMatchObject({ date: '2026-11-03', amount: -999, counterparty: 'Spotify AB', description: 'Premium' });
  });
  it('Revolut personal and Business, skipping non-completed', () => {
    const p = parseStatement(`Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
CARD_PAYMENT,Current,2026-11-04 10:00:00,2026-11-04 12:00:00,Beatport,-25.50,0.00,EUR,COMPLETED,100.00
TOPUP,Current,2026-11-05 10:00:00,,Top-up,50.00,0.00,EUR,PENDING,150.00`);
    expect(p.format).toBe('revolut');
    expect(p.lines).toEqual([{ date: '2026-11-04', amount: -2550, counterparty: 'Beatport', description: 'CARD_PAYMENT' }]);
    expect(p.skipped).toBe(1);
    const b = parseStatement(`Date started (UTC),Date completed (UTC),ID,Type,State,Description,Reference,Payer,Card number,Orig currency,Orig amount,Payment currency,Amount,Total amount,Fee,Balance
2026-11-06,2026-11-06,abc,TRANSFER,COMPLETED,Kermiscomite,F2026-C-0003,,,EUR,600.00,EUR,600.00,600.00,0.00,700.00`);
    expect(b.format).toBe('revolut_business');
    expect(b.lines[0]).toMatchObject({ amount: 60000, counterparty: 'Kermiscomite', description: 'F2026-C-0003 · TRANSFER' });
  });
  it('bunq and ABN AMRO TXT', () => {
    const bunq = parseStatement(`"Date";"Interest Date";"Amount";"Account";"Counterparty";"Name";"Description"
"2026-11-07";"2026-11-07";"-15,00";"NL01BUNQ0000000001";"NL05INGB0000000005";"Parkeren Utrecht";"Parking"`);
    expect(bunq.format).toBe('bunq');
    expect(bunq.lines[0]).toMatchObject({ amount: -1500, counterparty: 'Parkeren Utrecht', counterIban: 'NL05INGB0000000005' });
    const abn = parseStatement('123456789\tEUR\t20261108\t100,00\t50,00\t20261108\t-50,00\t/TRTP/SEPA OVERBOEKING/IBAN/NL09INGB0001234567/BIC/INGBNL2A/NAME/Thomann GmbH/REMI/Order 9/');
    expect(abn.format).toBe('abnamro');
    expect(abn.lines[0]).toMatchObject({ date: '2026-11-08', amount: -5000, counterparty: 'Thomann GmbH', counterIban: 'NL09INGB0001234567' });
  });
  it('CAMT.053', () => {
    const xml = `<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt>
<Ntry><Amt Ccy="EUR">120.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><Dt>2026-11-09</Dt></BookgDt>
<NtryDtls><TxDtls><RltdPties><Dbtr><Nm>Jansen BV</Nm></Dbtr><DbtrAcct><Id><IBAN>NL10RABO0000000010</IBAN></Id></DbtrAcct></RltdPties><RmtInf><Ustrd>F2026-G-0002</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
</Stmt></BkToCstmrStmt></Document>`;
    const r = parseStatement(xml);
    expect(r.format).toBe('camt053');
    expect(r.lines[0]).toEqual({ date: '2026-11-09', amount: 12000, counterparty: 'Jansen BV', counterIban: 'NL10RABO0000000010', description: 'F2026-G-0002' });
  });
});

// ---------------------------------------------------------------------------

const cat = (id: string, p: Partial<Category> = {}): Category => ({ ...base, id, key: id, name: id, nameEn: id, kind: 'expense', deductiblePct: 100, defaultVatRate: 21, defaultBusinessPct: 100, active: true, ...p });
const gig = (p: Partial<Gig>): Gig => ({ ...base, id: 'g1', reference: 'FQ', title: 'Bruiloft', eventType: 'wedding', date: '2026-06-12', startTime: '21:00', endTime: '01:00',
  setupTime: '19:00', setupRequired: true, stage: 'paid', stageChangedAt: '', ownerId: 'gijs', performers: ['gijs', 'coen'], setSlots: [], contacts: [], musicWishes: [], ...p });
const inv = (p: Partial<Invoice>): Invoice => ({ ...base, id: 'i1', number: 'F2026-G-0001', kind: 'standard', status: 'paid', language: 'nl', issueDate: '2026-06-13', gigId: 'g1',
  lines: [{ id: 'l', description: 'DJ', quantity: 1, unit: 'flat', unitPrice: 100000, vatRate: 21 }], client: { name: 'Lisa' }, vatMode: 'private', ...p });
const exp = (p: Partial<Expense>): Expense => ({ ...base, id: 'e' + Math.random(), date: '2026-06-12', supplier: 'X', categoryId: 'gear', amount: 12100, vatAmount: 2100, vatRate: 21,
  businessPct: 100, paidBy: 'gijs', receiptIds: [], status: 'ok', ...p });
const data = (p: Partial<LedgerData>): LedgerData => ({ invoices: [], payments: [], expenses: [], trips: [], assets: [], partnerEntries: [], gigs: [gig({})],
  categories: [cat('gear'), cat('food', { deductiblePct: 80 })], settings: { ...DEFAULT_SETTINGS }, ...p });

describe('ledger', () => {
  it('builds a P&L with partial deductions, mileage and depreciation', () => {
    const asset: Asset = { ...base, id: 'a', name: 'Controller', purchaseDate: '2026-01-15', cost: 120000, residual: 0, lifeYears: 5, businessPct: 100, paidBy: 'coen' };
    const trip: Trip = { ...base, id: 't', date: '2026-06-12', gigId: 'g1', driver: 'coen', from: 'Thuis', to: 'Venue', purpose: 'Gig', km: 50, roundTrip: true, source: 'manual' };
    const d = data({ invoices: [inv({})], expenses: [exp({}), exp({ categoryId: 'food', amount: 5000, vatAmount: 400 })], trips: [trip], assets: [asset] });
    const r = pnl(d, periodOf('year', '2026-06-01'));
    expect(r.revenueEx).toBe(100000);
    expect(r.costsEx).toBe(17100);                 // private mode: VAT is a cost
    expect(r.deductibleCosts).toBe(12100 + 4000);  // food 80%
    expect(r.mileage).toBe(100 * 23);
    expect(r.depreciation).toBe(24000);            // 12 months × 2000
    expect(r.result).toBe(100000 - 17100 - 2300 - 24000);
  });
  it('reclaims VAT in VAT mode and fills the return boxes', () => {
    const d = data({ settings: { ...DEFAULT_SETTINGS, vatMode: 'vat' }, invoices: [inv({ vatMode: 'vat' })], expenses: [exp({}), exp({ amount: 1000, vatAmount: 0, reverseCharge: true })] });
    const b = vatBoxes(d, periodOf('quarter', '2026-06-01'));
    expect(b['1a_base']).toBe(100000);
    expect(b['1a_vat']).toBe(21000);
    expect(b['4b_vat']).toBe(210);
    expect(b['5b']).toBe(2100 + 210);
    expect(b.total).toBe(21000 + 210 - 2310);
  });
  it('depreciates pro rata and stops at disposal', () => {
    const a: Asset = { ...base, id: 'a', name: 'Speakers', purchaseDate: '2026-07-01', cost: 60000, residual: 6000, lifeYears: 5, businessPct: 100, paidBy: 'business' };
    expect(depreciationBetween(a, '2026-01-01', '2026-12-31')).toBe(5400);
    expect(depreciationBetween({ ...a, disposedAt: '2027-03-15' }, '2027-01-01', '2027-12-31')).toBe(2700);
    expect(bookValue(a, '2026-12-31')).toBe(54600);
  });
  it('profit per gig includes direct costs and travel', () => {
    const trip: Trip = { ...base, id: 't', date: '2026-06-12', gigId: 'g1', driver: 'gijs', from: '', to: '', purpose: '', km: 25, roundTrip: true, source: 'venue', parking: 500 };
    const r = gigProfit(data({ invoices: [inv({})], expenses: [exp({ gigId: 'g1', amount: 5000, vatAmount: 0 })], trips: [trip] }), gig({}));
    expect(r).toMatchObject({ revenueEx: 100000, directCosts: 5000, travel: 50 * 23 + 500, margin: 100000 - 5000 - 1650, hours: 12 });
  });
  it('splits by lineup and suggests a settlement', () => {
    const rule = { validFrom: '2000-01-01', method: 'by_lineup' as const, gijsPct: 50, soloPct: 80 };
    expect(shareOf('gijs', rule, ['gijs'])).toBeCloseTo(0.9);
    expect(shareOf('coen', rule, ['gijs'])).toBeCloseTo(0.1);
    expect(shareOf('coen', rule, ['gijs', 'coen'])).toBe(0.5);
    // Gijs received €1,000 privately, Coen paid €100 of costs privately → Gijs owes Coen 550.
    const pay: Payment = { ...base, id: 'p', invoiceId: 'i1', date: '2026-06-20', amount: 100000, method: 'bank', receivedBy: 'gijs' };
    const b = partnerBalances(data({ invoices: [inv({})], payments: [pay], expenses: [exp({ paidBy: 'coen', amount: 10000, vatAmount: 0 })] }), '2026-12-31');
    expect(b.partners.gijs.balance).toBe(45000 - 100000);
    expect(b.partners.coen.balance).toBe(45000 + 10000);
    expect(b.settle).toEqual({ from: 'gijs', to: 'coen', amount: 55000 });
  });
  it('suggests paying out from the business account when it holds the money', () => {
    const pay: Payment = { ...base, id: 'p', invoiceId: 'i1', date: '2026-06-20', amount: 100000, method: 'bank', receivedBy: 'business' };
    const b = partnerBalances(data({ invoices: [inv({})], payments: [pay], expenses: [exp({ paidBy: 'coen', amount: 10000, vatAmount: 0 })] }), '2026-12-31');
    expect(b.businessCash).toBe(100000);
    expect(b.payout).toEqual({ gijs: 45000, coen: 55000 });
    expect(b.settle).toBeUndefined();
  });
  it('counts hours from gigs plus manual entries', () => {
    const h = hoursFor('gijs', '2026', [{ ...base, id: 'h', memberId: 'gijs', date: '2026-02-01', hours: 3, kind: 'prep' }], [gig({})], '2026-12-31');
    expect(h.total).toBe(9);
  });
});

describe('bank matching', () => {
  const line = (p: Partial<BankLine>): BankLine => ({ ...base, id: 'b', accountId: 'a', date: '2026-06-20', amount: 100000, counterparty: 'L van den Heuvel', description: 'F2026-G-0001', hash: 'h', batchId: 'x', status: 'unmatched', matches: [], ...p });
  it('suggests the open invoice by number and amount', () => {
    const s = suggestFor(line({}), { invoices: [inv({ status: 'sent' })], payments: [], expenses: [], rules: [] });
    expect(s[0]).toMatchObject({ type: 'invoice', open: 100000 });
  });
  it('suggests an expense with the same amount near the date', () => {
    const e = exp({ date: '2026-06-18', amount: 4495, supplier: 'Bax' });
    const s = suggestFor(line({ amount: -4495, counterparty: 'BAX SHOP', description: '' }), { invoices: [], payments: [], expenses: [e], rules: [] });
    expect(s[0]).toMatchObject({ type: 'expense' });
  });
  it('makes short rule keys', () => {
    expect(ruleKey('PAYPAL *BEATPORT 1234')).toBe('beatport');
    expect(ruleKey('Spotify AB')).toBe('spotify');
  });
});

describe('result shares', () => {
  it('splits the fiscal result by lineup', async () => {
    const { resultShares } = await import('./ledger');
    const d = data({ invoices: [inv({}), inv({ id: 'i2', gigId: 'g2' })], gigs: [gig({}), gig({ id: 'g2', performers: ['coen'] })],
      settings: { ...DEFAULT_SETTINGS, splitRules: [{ validFrom: '2000-01-01', method: 'by_lineup', gijsPct: 50, soloPct: 80 }] } });
    const r = resultShares(d, periodOf('year', '2026-01-01'));
    expect(r.gijs).toBe(50000 + 10000);
    expect(r.coen).toBe(50000 + 90000);
  });
});
