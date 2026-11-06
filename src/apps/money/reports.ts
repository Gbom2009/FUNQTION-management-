import { strToU8, zipSync } from 'fflate';
import { db } from '../../core/db';
import { alive } from '../../core/repo';
import { translate } from '../../core/i18n';
import { euro } from '../../core/format';
import type { Lang } from '../../core/types';
import { invoiceTotals, paidAmount } from '../invoicing/domain/money';
import { bookValue, depreciationBetween, expenseView, gigProfit, hoursFor, pnl, resultShares, tripCost, tripKm, type LedgerData, type Period } from './domain/ledger';

const csv = (rows: (string | number | undefined)[][]) =>
  '﻿' + rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\n');
const e2 = (c: number) => (c / 100).toFixed(2).replace('.', ',');

/** Year report as a pdfmake definition (light/print style, like the App 2 invoices). */
export function yearReportDefinition(d: LedgerData, p: Period, lang: Lang, hours: Record<string, number>) {
  const t = (k: Parameters<typeof translate>[1], x?: Record<string, string | number>) => translate(lang, k, x);
  const r = pnl(d, p);
  const shares = resultShares(d, p);
  const cats = new Map(d.categories.map((c) => [c.id, c]));
  const row = (a: string, b: number, bold = false) => [{ text: a, bold }, { text: euro(b, lang), alignment: 'right', bold }];
  return {
    pageSize: 'A4', pageMargins: [40, 40, 40, 50], defaultStyle: { font: 'Mono', fontSize: 9, color: '#141414' },
    footer: (page: number, pages: number) => ({ text: `Team Funqtion · ${t('m.yearReport')} ${p.key} · ${page}/${pages}`, fontSize: 7, color: '#6b6b6b', margin: [40, 18, 40, 0] }),
    content: [
      { text: `${t('m.yearReport').toUpperCase()} ${p.key}`, font: 'Display', fontSize: 22 },
      { text: `${d.settings.businessName} · ${t(`s.vatMode.${d.settings.vatMode}`)}`, color: '#6b6b6b', margin: [0, 2, 0, 10] },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1.5, lineColor: '#f68712' }], margin: [0, 0, 0, 12] },
      { text: t('m.pnl').toUpperCase(), fontSize: 8, color: '#6b6b6b', margin: [0, 0, 0, 4] },
      { table: { widths: ['*', 'auto'], body: [
        row(t('m.revenue'), r.revenueEx),
        ...Object.entries(r.revenueByType).map(([k, v]) => [{ text: `   ${t(`event.${k}` as never)}`, color: '#6b6b6b' }, { text: euro(v, lang), alignment: 'right', color: '#6b6b6b' }]),
        ...Object.entries(r.costsByCategory).map(([k, v]) => row(`− ${cats.get(k)?.name ?? k}${v.deductible !== v.costEx ? ` (${t('m.deductible')} ${euro(v.deductible, lang)})` : ''}`, -v.costEx)),
        row(`− ${t('m.mileage')} (${Math.round(r.km)} km)`, -r.mileage),
        row(`− ${t('m.depreciation')}`, -r.depreciation),
        row(t('m.result'), r.result, true),
        row(t('m.fiscalResult'), r.fiscalResult, true),
      ] }, layout: 'lightHorizontalLines' },
      { text: t('m.perPartner').toUpperCase(), fontSize: 8, color: '#6b6b6b', margin: [0, 16, 0, 4] },
      { table: { widths: ['*', 'auto', 'auto'], body: [
        [{ text: '' }, { text: t('m.fiscalResult'), alignment: 'right' }, { text: t('m.hours'), alignment: 'right' }],
        ['Gijs', { text: euro(shares.gijs, lang), alignment: 'right' }, { text: String(hours.gijs ?? 0), alignment: 'right' }],
        ['Coen', { text: euro(shares.coen, lang), alignment: 'right' }, { text: String(hours.coen ?? 0), alignment: 'right' }],
      ] }, layout: 'lightHorizontalLines' },
      { text: t('m.assets').toUpperCase(), fontSize: 8, color: '#6b6b6b', margin: [0, 16, 0, 4] },
      d.assets.length ? { table: { widths: ['*', 'auto', 'auto', 'auto'], body: [
        [t('common.name'), { text: t('m.cost'), alignment: 'right' }, { text: t('m.depreciation'), alignment: 'right' }, { text: t('m.bookValue'), alignment: 'right' }],
        ...d.assets.filter((a) => !a.deletedAt).map((a) => [a.name, { text: euro(a.cost, lang), alignment: 'right' }, { text: euro(depreciationBetween(a, p.from, p.to), lang), alignment: 'right' }, { text: euro(bookValue(a, p.to), lang), alignment: 'right' }]),
      ] }, layout: 'lightHorizontalLines' } : { text: '—' },
      { text: t('m.reportDisclaimer'), fontSize: 7, color: '#6b6b6b', margin: [0, 18, 0, 0] },
    ],
  };
}

/** Accountant pack: report PDF + CSVs + receipt files, one ZIP. */
export async function accountantPack(d: LedgerData, p: Period, pdf: Blob): Promise<Uint8Array> {
  const cats = new Map(d.categories.map((c) => [c.id, c]));
  const gigs = new Map(d.gigs.map((g) => [g.id, g]));
  const inP = (date?: string) => !!date && date >= p.from && date <= p.to;
  const files: Record<string, Uint8Array> = {};
  files[`jaaroverzicht-${p.key}.pdf`] = new Uint8Array(await pdf.arrayBuffer());
  files['facturen.csv'] = strToU8(csv([['nummer', 'soort', 'datum', 'leverdatum', 'klant', 'excl', 'btw', 'totaal', 'betaald', 'gig'],
    ...d.invoices.filter((i) => i.status !== 'draft' && !i.deletedAt && inP(i.issueDate)).map((i) => {
      const tt = invoiceTotals(i);
      return [i.number, i.kind, i.issueDate, i.supplyDate, i.client.name, e2(tt.ex), e2(tt.vat), e2(tt.total), e2(paidAmount(i.id, d.payments)), i.gigId ? gigs.get(i.gigId)?.reference : ''];
    })]));
  files['ontvangsten.csv'] = strToU8(csv([['datum', 'factuur', 'bedrag', 'methode', 'ontvangen_door'],
    ...d.payments.filter((x) => !x.deletedAt && inP(x.date)).map((x) => [x.date, d.invoices.find((i) => i.id === x.invoiceId)?.number, e2(x.amount), x.method, x.receivedBy ?? 'business'])]));
  const receipts = new Map((await db.receipts.toArray()).filter((r) => !r.deletedAt).map((r) => [r.id, r]));
  const expRows: (string | number | undefined)[][] = [['datum', 'leverancier', 'omschrijving', 'categorie', 'grootboek', 'bedrag_incl', 'btw', 'zakelijk_pct', 'aftrekbaar', 'betaald_door', 'gig', 'bon']];
  for (const e of d.expenses.filter((x) => !x.deletedAt && inP(x.date)).sort((a, b) => a.date.localeCompare(b.date))) {
    const c = cats.get(e.categoryId);
    const v = expenseView(e, c, d.settings.vatMode);
    const names: string[] = [];
    for (const rid of e.receiptIds) {
      const r = receipts.get(rid);
      if (!r) continue;
      const name = `bonnen/${e.date}_${e.supplier.replace(/[^\w-]+/g, '_').slice(0, 30)}_${rid.slice(0, 6)}.${r.mime.includes('pdf') ? 'pdf' : 'jpg'}`;
      files[name] = new Uint8Array(await r.blob.arrayBuffer());
      names.push(name);
    }
    expRows.push([e.date, e.supplier, e.description, c?.name, c?.accountCode, e2(e.amount), e2(e.vatAmount), e.businessPct, e2(v.deductible), e.paidBy, e.gigId ? gigs.get(e.gigId)?.reference : '', names.join(' ') || (e.status === 'missing_receipt' ? 'ONTBREEKT' : '')]);
  }
  files['uitgaven.csv'] = strToU8(csv(expRows));
  files['ritten.csv'] = strToU8(csv([['datum', 'bestuurder', 'van', 'naar', 'doel', 'km', 'vergoeding'],
    ...d.trips.filter((x) => !x.deletedAt && inP(x.date)).map((x) => [x.date, x.driver, x.from, x.to, x.purpose, tripKm(x), e2(tripCost(x, d.settings.mileageRate))])]));
  files['activa.csv'] = strToU8(csv([['naam', 'aanschaf', 'kosten_excl', 'restwaarde', 'jaren', 'afschrijving_periode', 'boekwaarde_einde'],
    ...d.assets.filter((a) => !a.deletedAt).map((a) => [a.name, a.purchaseDate, e2(a.cost), e2(a.residual), a.lifeYears, e2(depreciationBetween(a, p.from, p.to)), e2(bookValue(a, p.to))])]));
  files['partners.csv'] = strToU8(csv([['datum', 'soort', 'persoon', 'naar', 'bedrag', 'notitie'],
    ...d.partnerEntries.filter((x) => !x.deletedAt && inP(x.date)).map((x) => [x.date, x.kind, x.memberId, x.toMemberId, e2(x.amount), x.note])]));
  files['winst-per-gig.csv'] = strToU8(csv([['datum', 'gig', 'omzet_excl', 'directe_kosten', 'reiskosten', 'marge'],
    ...d.gigs.filter((g) => !g.deletedAt && inP(g.date)).map((g) => ({ g, x: gigProfit(d, g) })).filter(({ x }) => x.revenueEx || x.directCosts)
      .map(({ g, x }) => [g.date, g.title, e2(x.revenueEx), e2(x.directCosts), e2(x.travel), e2(x.margin)])]));
  const hours = alive(await db.hours.toArray());
  files['uren.csv'] = strToU8(csv([['persoon', 'jaar', 'uren_totaal'], ...(['gijs', 'coen'] as const).map((m) => [m, p.key.slice(0, 4), hoursFor(m, p.key.slice(0, 4), hours, d.gigs).total])]));
  files['LEESMIJ.txt'] = strToU8(`Team Funqtion – administratie ${p.key}\nGemaakt met Funqtion Hub op ${new Date().toISOString()}.\n\n` +
    `Bedragen in euro, decimaal met komma, CSV gescheiden met puntkomma.\nBtw-situatie: ${d.settings.vatMode}. Kilometertarief: ${e2(d.settings.mileageRate)} per km.\n` +
    `Bonnen staan in de map bonnen/ en zijn per uitgave gekoppeld (kolom 'bon').\n`);
  return zipSync(files, { level: 6 });
}
