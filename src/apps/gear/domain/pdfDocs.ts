import type { GearItem, LabelType, Lang } from '../../../core/types';
import type { Bars } from './barcode';
import { translate } from '../../../core/i18n';
import { euro } from '../../../core/format';

// pdfmake document definitions for QR label sheets and the insurance list.
// Pure (no pdfmake runtime) so they render in Node tests.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Node = any;
const INK = '#141414';
const DIM = '#6b6b6b';

type LabelItem = Pick<GearItem, 'code' | 'name' | 'owner'>;

const grid = (cells: Node[], cols: number, rowH: number): Node => {
  const body: Node[][] = [];
  for (let i = 0; i < cells.length; i += cols) {
    const row = cells.slice(i, i + cols);
    while (row.length < cols) row.push({ text: '' });
    body.push(row);
  }
  return { table: { widths: Array(cols).fill('*'), heights: rowH, body, dontBreakRows: true }, layout: { hLineWidth: () => 0.2, vLineWidth: () => 0.2, hLineColor: () => '#dddddd', vLineColor: () => '#dddddd', paddingLeft: () => 6, paddingTop: () => 4 } };
};

/** Code 128 as an SVG of rectangles (crisp at any size); `module` = width of the thinnest bar in points. */
export function barcodeSvg(b: Bars, height = 30): string {
  const rects = b.bars.map(([x, w]) => `<rect x="${x}" y="0" width="${w}" height="${height}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${b.modules}" height="${height}" viewBox="0 0 ${b.modules} ${height}" preserveAspectRatio="none"><g fill="#000000">${rects}</g></svg>`;
}

export function barcodeNode(b: Bars, module: number, height: number): Node {
  return { svg: barcodeSvg(b, height), width: Math.max(1, b.modules * module), height };
}

function cell(type: LabelType, it: LabelItem, ownerLine: string, bars?: Bars): Node {
  if (type === 'qr_small') {
    return { columns: [{ width: 56, qr: it.code, fit: 56, margin: [0, 2, 0, 0] }, { width: '*', stack: [{ text: it.code, bold: true, fontSize: 9 }, { text: it.name, fontSize: 6, color: DIM, margin: [0, 2, 0, 0] }], margin: [4, 6, 0, 0] }], columnGap: 2 };
  }
  if (type === 'qr_large') {
    return { columns: [{ width: 92, qr: it.code, fit: 92 }, { width: '*', stack: [{ text: it.code, bold: true, fontSize: 16 }, { text: it.name, fontSize: 9, margin: [0, 3, 0, 0] }, { text: ownerLine, fontSize: 6.5, color: DIM, margin: [0, 6, 0, 0] }], margin: [6, 4, 0, 0] }], columnGap: 4 };
  }
  // Barcode strip for cables: the same barcode twice, so one is always readable after wrapping.
  const b = bars ?? { modules: 0, bars: [] };
  const w = b.modules * 1.1;
  const one = (): Node => ({ width: w, stack: [barcodeNode(b, 1.1, 30), { text: it.code, fontSize: 7, alignment: 'center', margin: [0, 1, 0, 0] }] });
  // White space around each barcode (quiet zone) so scanners find the start and end.
  return { stack: [{ columns: [one(), one()], columnGap: 20, margin: [8, 0, 0, 0] }, { text: it.name, fontSize: 5.5, color: DIM, margin: [8, 1, 0, 0] }] };
}

const LAYOUT: Record<LabelType, { cols: number; rowH: number }> = {
  qr_large: { cols: 2, rowH: 106 },  // 2 × 7 (≈ 99 × 38 mm): cases, speakers, big gear
  qr_small: { cols: 4, rowH: 70 },   // 4 × 10 (≈ 48 × 25 mm): small gear
  barcode: { cols: 2, rowH: 58 },    // 2 × 13 strips (≈ 99 × 21 mm): wrap lengthwise around a cable
};

/**
 * A4 label sheets, one section per label type (each starts on a new page).
 * Black on white for reliable scanning; the code in mono under every symbol.
 */
export function labelSheets(sections: { type: LabelType; items: LabelItem[] }[], ownerLine: string, bars: Record<string, Bars> = {}): Node {
  const used = sections.filter((x) => x.items.length);
  const content: Node[] = used.flatMap((sec, i) => [
    { text: `${sec.type === 'barcode' ? 'BARCODE' : 'QR'} · ${sec.items.length}`, fontSize: 6, color: DIM, margin: [0, 0, 0, 4], ...(i > 0 ? { pageBreak: 'before' } : {}) },
    grid(sec.items.map((it) => cell(sec.type, it, ownerLine, bars[it.code])), LAYOUT[sec.type].cols, LAYOUT[sec.type].rowH),
  ]);
  return {
    pageSize: 'A4',
    pageMargins: [20, 30, 20, 30],
    defaultStyle: { font: 'Mono', fontSize: 8, color: INK },
    info: { title: 'Funqtion gear labels', creator: 'Funqtion Hub' },
    content: content.length ? content : [{ text: '—' }],
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
