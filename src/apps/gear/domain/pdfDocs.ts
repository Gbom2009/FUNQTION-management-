import type { GearItem, Lang } from '../../../core/types';
import { translate } from '../../../core/i18n';
import { euro } from '../../../core/format';

// pdfmake document definitions for QR label sheets and the insurance list.
// Pure (no pdfmake runtime) so they render in Node tests.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Node = any;
const INK = '#141414';
const DIM = '#6b6b6b';

export type LabelSize = 'small' | 'large';

/**
 * A4 label sheet. small = 4 × 10 (≈ 48 × 25 mm, cables and small cases),
 * large = 2 × 7 (≈ 99 × 38 mm, cases and big gear, with name and "Eigendom van").
 * Black on white for reliable scanning; the code in mono under the QR.
 */
export function labelSheet(items: Pick<GearItem, 'code' | 'name' | 'owner'>[], size: LabelSize, ownerLine: string): Node {
  const cols = size === 'small' ? 4 : 2;
  const rowH = size === 'small' ? 70 : 106;
  const cells: Node[] = items.map((it) => size === 'small'
    ? { columns: [{ qr: it.code, fit: 56, margin: [0, 2, 0, 0] }, { stack: [{ text: it.code, bold: true, fontSize: 10 }, { text: it.name, fontSize: 6.5, color: DIM, margin: [0, 2, 0, 0] }], margin: [4, 6, 0, 0] }], columnGap: 2 }
    : { columns: [{ qr: it.code, fit: 92 }, { stack: [{ text: it.code, bold: true, fontSize: 16 }, { text: it.name, fontSize: 9, margin: [0, 3, 0, 0] }, { text: ownerLine, fontSize: 6.5, color: DIM, margin: [0, 6, 0, 0] }], margin: [6, 4, 0, 0] }], columnGap: 4 });
  const body: Node[][] = [];
  for (let i = 0; i < cells.length; i += cols) {
    const row = cells.slice(i, i + cols);
    while (row.length < cols) row.push({ text: '' });
    body.push(row);
  }
  return {
    pageSize: 'A4',
    pageMargins: size === 'small' ? [20, 30, 20, 30] : [20, 40, 20, 40],
    defaultStyle: { font: 'Mono', fontSize: 8, color: INK },
    info: { title: 'Funqtion gear labels', creator: 'Funqtion Hub' },
    content: body.length ? [{ table: { widths: Array(cols).fill('*'), heights: rowH, body, dontBreakRows: true }, layout: { hLineWidth: () => 0.2, vLineWidth: () => 0.2, hLineColor: () => '#dddddd', vLineColor: () => '#dddddd', paddingLeft: () => 6, paddingTop: () => 4 } }] : [{ text: '—' }],
  };
}

export interface InsuranceRow { item: GearItem; locationName: string; hasPhoto: boolean; hasReceipt: boolean }

export function insuranceList(rows: InsuranceRow[], ctx: { lang: Lang; businessName: string; date: string; total: number; insurer?: string }): Node {
  const t = (k: Parameters<typeof translate>[1], p?: Record<string, string | number>) => translate(ctx.lang, k, p);
  const head = [t('g.code'), t('g.name'), t('g.brandModel'), t('g.serial'), t('g.owner'), t('g.purchaseDate'), t('g.purchasePrice'), t('g.replacementValue'), t('g.docs')]
    .map((h) => ({ text: h.toUpperCase(), fontSize: 6, color: DIM }));
  const body = rows.map(({ item: i, hasPhoto, hasReceipt }) => [
    i.code, `${i.name}${i.kind === 'counted' ? ` × ${i.quantity}` : ''}`, [i.brand, i.model].filter(Boolean).join(' '), i.serial ?? '', t(`g.owner.${i.owner}`),
    i.purchaseDate ?? '', i.purchasePrice != null ? euro(i.purchasePrice, ctx.lang) : '', i.replacementValue != null ? euro(i.replacementValue, ctx.lang) : '',
    [hasPhoto ? t('g.docPhoto') : '', hasReceipt ? t('g.docReceipt') : ''].filter(Boolean).join(', '),
  ].map((x) => ({ text: x, fontSize: 7 })));
  return {
    pageSize: 'A4', pageOrientation: 'landscape', pageMargins: [30, 30, 30, 40],
    defaultStyle: { font: 'Mono', fontSize: 8, color: INK },
    info: { title: `${ctx.businessName} – ${t('g.insuranceTitle')}`, creator: 'Funqtion Hub' },
    footer: (p: number, n: number) => ({ text: `${ctx.businessName} · ${ctx.date} · ${p}/${n}`, fontSize: 6.5, color: DIM, margin: [30, 12, 30, 0] }),
    content: [
      { text: t('g.insuranceTitle').toUpperCase(), font: 'Display', fontSize: 18 },
      { text: `${ctx.businessName} · ${ctx.date}${ctx.insurer ? ` · ${ctx.insurer}` : ''}`, color: DIM, margin: [0, 2, 0, 10] },
      { text: t('g.insuranceTotal', { amount: euro(ctx.total, ctx.lang), n: rows.length }), bold: true, margin: [0, 0, 0, 8] },
      { table: { headerRows: 1, widths: [42, '*', 90, 70, 44, 52, 52, 52, 60], body: [head, ...body] }, layout: { hLineWidth: (i: number) => (i === 1 ? 0.8 : 0.2), vLineWidth: () => 0, hLineColor: () => '#cccccc', paddingLeft: () => 2 } },
    ],
  };
}
