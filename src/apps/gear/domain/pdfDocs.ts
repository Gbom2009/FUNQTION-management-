import type { GearItem, LabelType, Lang } from '../../../core/types';
import type { Bars } from './barcode';
import { barcodeArt, colors, logoArt, qrArt, type LabelPreset } from './labelArt';
import { translate } from '../../../core/i18n';
import { euro } from '../../../core/format';

// pdfmake document definitions for QR label sheets and the insurance list.
// Pure (no pdfmake runtime) so they render in Node tests.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Node = any;
const INK = '#141414';
const DIM = '#6b6b6b';

type LabelItem = Pick<GearItem, 'code' | 'name' | 'owner'>;

export interface LabelArt {
  qr: Record<string, { size: number; dark: boolean[] }>; // per code (error correction H when the design has a logo)
  bars: Record<string, Bars>;
  logoSvg?: string;                                      // public/logo.svg
}

const LAYOUT: Record<LabelType, { cols: number; rowH: number }> = {
  qr_large: { cols: 2, rowH: 106 },  // 2 × 7 (≈ 99 × 38 mm): cases, speakers, big gear
  qr_small: { cols: 4, rowH: 70 },   // 4 × 10 (≈ 48 × 25 mm): small gear
  barcode: { cols: 2, rowH: 58 },    // 2 × 13 strips (≈ 99 × 21 mm): wrap lengthwise around a cable
};

function textLines(p: LabelPreset, it: LabelItem, ownerLine: string, big: boolean): Node[] {
  const c = colors(p);
  return [
    p.showCode ? { text: it.code, bold: true, fontSize: big ? 16 : 9, color: c.accent } : '',
    p.showName ? { text: it.name, fontSize: big ? 9 : 6, color: c.text, margin: [0, 2, 0, 0] } : '',
    p.showOwner ? { text: ownerLine, fontSize: big ? 6.5 : 5, color: c.text, opacity: 0.75, margin: [0, big ? 6 : 2, 0, 0] } : '',
    p.customText ? { text: p.customText, fontSize: big ? 7 : 5.5, color: c.text, margin: [0, 2, 0, 0] } : '',
    p.showTagline ? { text: 'FEEL THE MUSIQ', fontSize: big ? 6.5 : 5, color: c.accent, characterSpacing: 1, margin: [0, big ? 4 : 2, 0, 0] } : '',
  ].filter(Boolean);
}

function cell(p: LabelPreset, it: LabelItem, ownerLine: string, art: LabelArt): Node {
  const c = colors(p);
  if (p.size !== 'barcode') {
    const big = p.size === 'qr_large';
    const m = art.qr[it.code];
    const side = big ? 92 : 56;
    const qr = m ? { svg: qrArt(m, p, art.logoSvg), width: side, height: side } : { qr: it.code, fit: side, foreground: c.ink, background: c.behind };
    return { fillColor: c.bg, columns: [{ width: side, ...qr }, { width: '*', stack: textLines(p, it, ownerLine, big), margin: [big ? 6 : 4, big ? 4 : 5, 0, 0] }], columnGap: 2 };
  }
  // Barcode strip for cables: the same barcode 1–3 times, so one is always readable after wrapping.
  const b = art.bars[it.code] ?? { modules: 0, bars: [] };
  const svg = barcodeArt(b, p);
  const units = Number(svg.match(/width="(\d+)"/)?.[1] ?? b.modules);
  const logoW = p.logo && art.logoSvg ? 30 : 0;
  const scale = Math.min(1.1, (262 - logoW - (p.repeat - 1) * 8) / (p.repeat * Math.max(1, units)));
  const w = units * scale;
  const h = Number(svg.match(/height="(\d+)"/)?.[1] ?? 30) * Math.min(1, scale + 0.2);
  const copies = Array.from({ length: p.repeat }, () => ({ width: w, stack: [{ svg, width: w, height: h }, p.showCode ? { text: it.code, fontSize: 6.5, alignment: 'center', color: c.accent, margin: [0, 1, 0, 0] } : ''].filter(Boolean) }));
  const logo = p.logo && art.logoSvg ? [{ width: 22, svg: logoArt(p, art.logoSvg), height: 22, margin: [0, 4, 0, 0] }] : [];
  const extra = textLines({ ...p, showCode: false }, it, ownerLine, false);
  return { fillColor: c.bg, stack: [{ columns: [...logo, ...copies], columnGap: 8 }, ...extra.map((x: Node) => ({ ...x, fontSize: 5.5 }))] };
}

function grid(cells: Node[], cols: number, rowH: number, bg: string): Node {
  const body: Node[][] = [];
  for (let i = 0; i < cells.length; i += cols) {
    const row = cells.slice(i, i + cols);
    while (row.length < cols) row.push({ text: '', fillColor: bg });
    body.push(row);
  }
  return { table: { widths: Array(cols).fill('*'), heights: rowH, body, dontBreakRows: true },
    layout: { hLineWidth: () => 0.3, vLineWidth: () => 0.3, hLineColor: () => '#bbbbbb', vLineColor: () => '#bbbbbb', paddingLeft: () => 6, paddingTop: () => 4 } };
}

/**
 * A4 label sheets: one section per design (each starts on a new page). Thin grey
 * lines between labels are cutting guides; coloured designs fill the whole label.
 */
export function labelSheets(sections: { preset: LabelPreset; items: LabelItem[] }[], ownerLine: string, art: LabelArt): Node {
  const used = sections.filter((x) => x.items.length);
  const content: Node[] = used.flatMap((sec, i) => [
    { text: `${sec.preset.name} · ${sec.items.length}`, fontSize: 6, color: DIM, margin: [0, 0, 0, 4], ...(i > 0 ? { pageBreak: 'before' } : {}) },
    grid(sec.items.map((it) => cell(sec.preset, it, ownerLine, art)), LAYOUT[sec.preset.size].cols, LAYOUT[sec.preset.size].rowH, colors(sec.preset).bg),
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
