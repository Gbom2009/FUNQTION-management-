import type { Gig, Invoice, Lang, Quote, QuoteLine, Settings, Venue, PartySnapshot, VatMode } from '../../../core/types';
import { translate } from '../../../core/i18n';
import { euro, fmtDate } from '../../../core/format';
import { computeTotals, countedLines, invoiceTotals, lineNet, quoteTotals, type Totals } from './money';
import { renderTerms } from '../terms';

// Builds pdfmake document definitions (plain objects) for quotes, invoices and
// credit notes. Kept free of the pdfmake runtime so it can be tested in Node.
// Look: white paper, near-black text, one orange accent, Archivo Black for the
// title and the amount due, JetBrains Mono for everything else.

const INK = '#141414';
const DIM = '#6b6b6b';
const RULE = '#cfcfcf';
const ACCENT = '#f68712';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Node = any;

export interface DocContext {
  settings: Settings;
  gig?: Gig;
  venue?: Venue;
  logoSvg?: string; // dark variant for paper
  payments?: number; // already paid (invoices)
  refNumber?: string; // credited invoice number (credit notes)
}

const hr = (color = RULE, w = 0.5): Node => ({ canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: w, lineColor: color }], margin: [0, 6, 0, 6] });

function party(label: string, p?: PartySnapshot, lang: Lang = 'nl'): Node {
  if (!p) return { text: '' };
  const t = (k: Parameters<typeof translate>[1]) => translate(lang, k);
  return {
    stack: [
      { text: label.toUpperCase(), color: DIM, fontSize: 7, characterSpacing: 1, margin: [0, 0, 0, 3] },
      { text: p.name, bold: true },
      p.attention ? { text: p.attention } : '',
      p.address ? { text: p.address } : '',
      p.email ? { text: p.email, color: DIM } : '',
      p.phone ? { text: p.phone, color: DIM } : '',
      p.kvk ? { text: `${t('pdf.kvk')} ${p.kvk}`, color: DIM } : '',
      p.vatId ? { text: `${t('pdf.vatId')} ${p.vatId}`, color: DIM } : '',
    ].filter(Boolean),
    fontSize: 8.5,
  };
}

function metaTable(rows: [string, string][]): Node {
  return {
    table: { widths: ['auto', '*'], body: rows.filter(([, v]) => v).map(([k, v]) => [{ text: k, color: DIM }, { text: v, alignment: 'right' }]) },
    layout: 'noBorders', fontSize: 8.5,
  };
}

function linesTable(lines: QuoteLine[], lang: Lang, vatMode: VatMode, opts: { checkbox?: boolean } = {}): Node {
  const t = (k: Parameters<typeof translate>[1]) => translate(lang, k);
  const showVat = vatMode === 'vat';
  const head = [t('pdf.description'), t('pdf.qty'), t('pdf.price'), ...(showVat ? [t('pdf.vat')] : []), t('pdf.amount')]
    .map((h, i) => ({ text: h.toUpperCase(), color: DIM, fontSize: 7, characterSpacing: 0.5, alignment: i === 0 ? 'left' : 'right' }));
  const body = lines.map((l) => {
    const desc = `${opts.checkbox ? (l.selected ? '[x] ' : '[ ] ') : ''}${l.description}${l.discountPct ? `  (-${l.discountPct}%)` : ''}`;
    return [
      { text: desc },
      { text: `${String(l.quantity).replace('.', ',')} ${t(`unit.${l.unit}`)}`, alignment: 'right', noWrap: true },
      { text: euro(l.unitPrice, lang), alignment: 'right', noWrap: true },
      ...(showVat ? [{ text: `${l.vatRate}%`, alignment: 'right' }] : []),
      { text: euro(lineNet(l), lang), alignment: 'right', noWrap: true },
    ];
  });
  return {
    table: { headerRows: 1, widths: ['*', 'auto', 'auto', ...(showVat ? ['auto'] : []), 'auto'], body: [head, ...body] },
    layout: {
      hLineWidth: (i: number) => (i === 1 ? 0.8 : 0.3),
      hLineColor: (i: number) => (i === 1 ? INK : RULE),
      vLineWidth: () => 0,
      paddingTop: () => 5, paddingBottom: () => 5, paddingLeft: () => 0, paddingRight: (i: number) => (i === (showVat ? 4 : 3) ? 0 : 10),
    },
    fontSize: 8.5,
  };
}

function totalsBlock(tt: Totals, lang: Lang, vatMode: VatMode, extra: { label: string; value: number; strong?: boolean }[] = [], dueLabel?: string): Node {
  const t = (k: Parameters<typeof translate>[1]) => translate(lang, k);
  const rows: Node[] = [];
  const row = (k: string, v: string, o: Node = {}) => rows.push([{ text: k, color: DIM, ...o }, { text: v, alignment: 'right', ...o }]);
  if (tt.discount) { row(t('pdf.subtotal'), euro(tt.gross, lang)); row(t('pdf.discount'), `- ${euro(tt.discount, lang)}`); }
  if (vatMode === 'vat') {
    for (const r of tt.perRate) { row(`${t('pdf.exVat')} ${r.rate}%`, euro(r.base, lang)); row(`${t('pdf.vat')} ${r.rate}%`, euro(r.vat, lang)); }
  }
  const last = extra.find((e) => e.strong);
  if (rows.length || extra.length) row(t('pdf.total'), euro(tt.total, lang), { bold: true, color: INK });
  for (const e of extra) if (!e.strong) row(e.label, euro(e.value, lang));
  return {
    columns: [
      { width: '*', text: '' },
      {
        width: 230,
        stack: [
          rows.length ? { table: { widths: ['*', 'auto'], body: rows }, layout: 'noBorders', fontSize: 8.5 } : '',
          { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 230, y2: 0, lineWidth: 1.2, lineColor: ACCENT }], margin: [0, 6, 0, 4] },
          { columns: [
            { text: (dueLabel ?? t('pdf.total')).toUpperCase(), fontSize: 8, color: DIM, margin: [0, 6, 0, 0] },
            { text: euro(last ? last.value : tt.total, lang), font: 'Display', fontSize: 18, alignment: 'right' },
          ] },
        ],
      },
    ],
    margin: [0, 10, 0, 0],
  };
}

function vatNote(vatMode: VatMode, s: Settings, lang: Lang): string {
  if (vatMode === 'kor') return lang === 'en' ? translate('en', 'pdf.noteKor') : s.noteKor;
  if (vatMode === 'private') return lang === 'en' ? translate('en', 'pdf.notePrivate') : s.notePrivate;
  return '';
}

function eventLine(ctx: DocContext, lang: Lang): string {
  const g = ctx.gig;
  if (!g) return '';
  const where = ctx.venue ? [ctx.venue.name, ctx.venue.city].filter(Boolean).join(', ') : '';
  return [g.title, fmtDate(g.date, lang, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }), g.startTime && `${g.startTime}–${g.endTime}`, where].filter(Boolean).join('  ·  ');
}

function frame(title: string, ctx: DocContext, lang: Lang, content: Node[], seller?: PartySnapshot): Node {
  const s = ctx.settings;
  const foot = [s.businessName, seller?.kvk ? `${translate(lang, 'pdf.kvk')} ${seller.kvk}` : '', s.website, '@funqtionofficial'].filter(Boolean).join('  ·  ');
  return {
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 56],
    defaultStyle: { font: 'Mono', fontSize: 9, color: INK, lineHeight: 1.25 },
    info: { title, author: s.businessName, creator: 'Funqtion Hub' },
    footer: (page: number, pages: number) => ({
      margin: [40, 18, 40, 0],
      columns: [
        { text: foot, fontSize: 6.5, color: DIM },
        { text: `FEEL THE MUSIQ   ${page}/${pages}`, fontSize: 6.5, color: ACCENT, alignment: 'right', width: 'auto' },
      ],
    }),
    content: [
      {
        columns: [
          ctx.logoSvg ? { svg: ctx.logoSvg, width: 54, height: 54 } : { text: '', width: 54 },
          { width: '*', stack: [{ text: title.toUpperCase(), font: 'Display', fontSize: 24, margin: [14, 6, 0, 0] }, { text: s.businessName, margin: [14, 2, 0, 0], color: DIM, fontSize: 8 }] },
          { width: 190, ...party(translate(lang, 'pdf.from'), seller, lang), alignment: 'right' },
        ],
      },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1.5, lineColor: ACCENT }], margin: [0, 14, 0, 14] },
      ...content,
    ],
  };
}

// ---------------------------------------------------------------------------

export function quoteDefinition(q: Quote, ctx: DocContext): Node {
  const lang = q.language ?? 'nl';
  const t = (k: Parameters<typeof translate>[1], p?: Record<string, string | number>) => translate(lang, k, p);
  const vatMode = q.vatMode ?? 'private';
  const main = q.lines.filter((l) => !l.optional);
  const extras = q.lines.filter((l) => l.optional);
  const tt = quoteTotals(q);
  const s = ctx.settings;
  const content: Node[] = [
    { columns: [
      party(t('pdf.to'), q.client, lang),
      { width: 200, ...metaTable([
        [t('pdf.quoteNumber'), `${q.number ?? t('pdf.draft')}${q.version > 1 ? ` (v${q.version})` : ''}`],
        [t('pdf.date'), fmtDate(q.issueDate ?? q.sentAt?.slice(0, 10), lang, { day: 'numeric', month: 'long', year: 'numeric' })],
        [t('pdf.validUntil'), fmtDate(q.validUntil, lang, { day: 'numeric', month: 'long', year: 'numeric' })],
      ]) },
    ] },
    ctx.gig ? { text: eventLine(ctx, lang), margin: [0, 14, 0, 0], fontSize: 9.5, bold: true } : '',
    q.intro ? { text: q.intro, margin: [0, 10, 0, 0] } : '',
    { text: '', margin: [0, 8, 0, 0] },
    linesTable(main, lang, vatMode),
  ];
  if (extras.length) {
    content.push({ text: t('pdf.extras').toUpperCase(), margin: [0, 14, 0, 4], fontSize: 7, color: DIM, characterSpacing: 1 });
    content.push({ text: t('pdf.extrasHint'), fontSize: 7.5, color: DIM, margin: [0, 0, 0, 4] });
    content.push(linesTable(extras, lang, vatMode, { checkbox: true }));
  }
  const withAll = quoteTotals(q, true);
  content.push(totalsBlock(tt, lang, vatMode, [], t('pdf.total')));
  if (extras.length && withAll.total !== tt.total) {
    content.push({ text: t('pdf.totalWithAllExtras', { amount: euro(withAll.total, lang) }), alignment: 'right', fontSize: 7.5, color: DIM, margin: [0, 4, 0, 0] });
  }
  const dep = q.depositPct ?? s.depositPct;
  content.push({ stack: [
    hr(),
    vatNote(vatMode, s, lang) ? { text: vatNote(vatMode, s, lang), fontSize: 8, color: DIM } : '',
    dep ? { text: t('pdf.depositNote', { pct: dep, amount: euro(Math.round((tt.total * dep) / 100), lang) }), fontSize: 8 } : '',
    { text: t('pdf.acceptNote'), fontSize: 8, margin: [0, 4, 0, 0] },
    q.notes ? { text: q.notes, fontSize: 8, margin: [0, 4, 0, 0] } : '',
  ], margin: [0, 12, 0, 0] });
  content.push({
    margin: [0, 18, 0, 0],
    table: { widths: ['*', '*', '*'], body: [[t('pdf.signName'), t('pdf.signDate'), t('pdf.signature')].map((x) => ({ text: x.toUpperCase(), fontSize: 7, color: DIM, margin: [0, 26, 0, 0] }))] },
    layout: { hLineWidth: (i: number) => (i === 1 ? 0.5 : 0), vLineWidth: () => 0, hLineColor: () => INK, paddingLeft: () => 0, paddingRight: () => 16 },
  });
  const terms = lang === 'en' ? s.termsEn : s.termsNl;
  if (terms) {
    content.push({ text: renderTerms(terms, s, lang), fontSize: 6.8, lineHeight: 1.2, pageBreak: 'before', color: INK });
  }
  return frame(t('pdf.quote'), ctx, lang, content, q.seller);
}

export function invoiceDefinition(inv: Invoice, ctx: DocContext): Node {
  const lang = inv.language;
  const t = (k: Parameters<typeof translate>[1], p?: Record<string, string | number>) => translate(lang, k, p);
  const s = ctx.settings;
  const tt = invoiceTotals(inv);
  const isCredit = inv.kind === 'credit_note';
  const paid = ctx.payments ?? 0;
  const due = tt.total - paid;
  const title = isCredit ? t('pdf.creditNote') : inv.kind === 'deposit' ? t('pdf.depositInvoice') : t('pdf.invoice');
  const seller = inv.seller;
  const content: Node[] = [
    { columns: [
      party(t('pdf.to'), inv.client, lang),
      { width: 210, ...metaTable([
        [isCredit ? t('pdf.creditNumber') : t('pdf.invoiceNumber'), inv.number ?? t('pdf.draft')],
        [t('pdf.invoiceDate'), fmtDate(inv.issueDate, lang, { day: 'numeric', month: 'long', year: 'numeric' })],
        [t('pdf.supplyDate'), fmtDate(inv.supplyDate, lang, { day: 'numeric', month: 'long', year: 'numeric' })],
        ...(!isCredit ? [[t('pdf.dueDate'), fmtDate(inv.dueDate, lang, { day: 'numeric', month: 'long', year: 'numeric' })] as [string, string]] : []),
        [t('pdf.reference'), inv.reference ?? ''],
        ...(isCredit && ctx.refNumber ? [[t('pdf.creditFor'), ctx.refNumber] as [string, string]] : []),
      ]) },
    ] },
    ctx.gig ? { text: eventLine(ctx, lang), margin: [0, 14, 0, 0], fontSize: 9.5, bold: true } : '',
    inv.reason ? { text: inv.reason, margin: [0, 6, 0, 0] } : '',
    { text: '', margin: [0, 8, 0, 0] },
    linesTable(inv.lines, lang, inv.vatMode),
    totalsBlock(tt, lang, inv.vatMode, !isCredit && paid ? [{ label: t('pdf.paid'), value: -paid }, { label: t('pdf.amountDue'), value: due, strong: true }] : [],
      isCredit ? t('pdf.creditTotal') : t('pdf.amountDue')),
  ];
  const pay: Node[] = [];
  if (!isCredit && due > 0) {
    pay.push({ text: t('pdf.payBy', { amount: euro(due, lang), date: fmtDate(inv.dueDate, lang, { day: 'numeric', month: 'long', year: 'numeric' }) }), bold: true, fontSize: 8.5 });
    if (seller?.iban) pay.push({ text: t('pdf.payTo', { iban: seller.iban, holder: seller.accountHolder ?? s.businessName, ref: inv.number ?? '' }), fontSize: 8.5 });
  }
  if (isCredit) pay.push({ text: t('pdf.creditNote2', { ref: ctx.refNumber ?? '' }), fontSize: 8.5 });
  content.push({ stack: [hr(), ...pay, vatNote(inv.vatMode, s, lang) ? { text: vatNote(inv.vatMode, s, lang), fontSize: 8, color: DIM, margin: [0, 4, 0, 0] } : '',
    inv.notes ? { text: inv.notes, fontSize: 8, margin: [0, 4, 0, 0] } : '',
    { text: t('pdf.termsRef'), fontSize: 7, color: DIM, margin: [0, 6, 0, 0] }], margin: [0, 12, 0, 0] });
  return frame(title, ctx, lang, content, seller);
}

/** Paper variant of the logo: white parts become ink. */
export const paperLogo = (svg: string) => svg.replace(/fill="#ffffff"/gi, `fill="${INK}"`).replace(/fill="#fff"/gi, `fill="${INK}"`);

export { computeTotals, countedLines };
