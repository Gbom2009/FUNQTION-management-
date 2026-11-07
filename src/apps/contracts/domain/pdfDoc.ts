import type { ContractEvent, ContractSignature, ContractSnapshot, ContractVersion, Lang, PartySnapshot } from '../../../core/types';
import { translate, type Key } from '../../../core/i18n';
import { euro, fmtDate } from '../../../core/format';
import { shortHash } from './render';

// pdfmake document definition for a contract or addendum. Same paper style as
// the App 2 quotes/invoices: white paper, near-black text, one orange accent.
// Kept free of the pdfmake runtime so it can be rendered in Node tests.

const INK = '#141414';
const DIM = '#6b6b6b';
const RULE = '#cfcfcf';
const ACCENT = '#f68712';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Node = any;

export interface ContractDocInput {
  version: Pick<ContractVersion, 'kind' | 'label' | 'contentHash' | 'prevHash' | 'frozenAt' | 'status'> | { kind: 'contract' | 'addendum'; label: string; contentHash?: string; prevHash?: string; frozenAt?: string; status: 'draft' };
  snapshot: ContractSnapshot;
  signatures?: ContractSignature[];
  events?: ContractEvent[];
  logoSvg?: string;
  businessName: string;
}

const label = (text: string): Node => ({ text: text.toUpperCase(), color: DIM, fontSize: 7, characterSpacing: 1, margin: [0, 0, 0, 3] });

function party(title: string, p: PartySnapshot & { legalNames?: string }, lang: Lang): Node {
  const t = (k: Key) => translate(lang, k);
  return {
    stack: [
      label(title),
      { text: p.name || '—', bold: true },
      p.legalNames ? { text: p.legalNames } : '',
      p.attention ? { text: p.attention } : '',
      p.address ? { text: p.address } : '',
      p.email ? { text: p.email, color: DIM } : '',
      p.phone ? { text: p.phone, color: DIM } : '',
      p.kvk ? { text: `${t('pdf.kvk')} ${p.kvk}`, color: DIM } : '',
    ].filter(Boolean),
    fontSize: 8.5,
  };
}

/** Body text: "- " lines become bullets, other lines paragraphs. */
function body(text: string, fontSize = 8.5): Node[] {
  const out: Node[] = [];
  let bullets: string[] = [];
  const flush = () => { if (bullets.length) { out.push({ ul: bullets, fontSize, margin: [6, 1, 0, 2], markerColor: ACCENT }); bullets = []; } };
  for (const line of text.split('\n')) {
    if (line.startsWith('- ')) bullets.push(line.slice(2));
    else { flush(); if (line.trim()) out.push({ text: line, fontSize, margin: [0, 1, 0, 2] }); }
  }
  flush();
  return out;
}

function summaryBox(s: ContractSnapshot, t: (k: Key, p?: Record<string, string | number>) => string, lang: Lang): Node {
  const d = fmtDate(s.event.date, lang, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const rows: [string, string][] = [
    [t('ct.pdf.event'), s.event.title],
    [t('ct.pdf.date'), d],
    [t('ct.pdf.times'), s.event.sets.map((x) => `${x.start}–${x.end}`).join(', ')],
    [t('ct.pdf.venue'), [s.event.venueName, s.event.venueAddress].filter(Boolean).join(', ') || '—'],
    [t('ct.pdf.price'), euro(s.price.total, lang)],
    [t('ct.pdf.deposit'), `${euro(s.price.depositAmount, lang)} (${s.price.depositPct}%)`],
  ];
  const cancelNr = s.clauses.find((c) => c.key === 'A1')?.nr;
  if (cancelNr) rows.push([t('ct.pdf.cancellation'), t('ct.pdf.seeArticle', { nr: cancelNr })]);
  return {
    margin: [0, 12, 0, 6],
    table: { widths: ['*'], body: [[{
      stack: [label(t('ct.pdf.summary')), { table: { widths: [90, '*'], body: rows.map(([k, v]) => [{ text: k, color: DIM }, { text: v, bold: k === t('ct.pdf.price') }]) }, layout: 'noBorders', fontSize: 9 }],
      margin: [10, 8, 10, 8],
    }]] },
    layout: { hLineWidth: () => 0.8, vLineWidth: (i: number) => (i === 0 ? 3 : 0.8), hLineColor: () => INK, vLineColor: (i: number) => (i === 0 ? ACCENT : INK) },
  };
}

function servicesTable(s: ContractSnapshot, t: (k: Key, p?: Record<string, string | number>) => string, lang: Lang): Node[] {
  const head = [t('pdf.description'), t('pdf.qty'), t('pdf.amount')].map((h, i) => ({ text: h.toUpperCase(), color: DIM, fontSize: 7, alignment: i === 0 ? 'left' : 'right' }));
  const rows = s.services.map((x) => [{ text: x.description }, { text: x.qty, alignment: 'right' }, { text: euro(x.amount, lang), alignment: 'right', noWrap: true }]);
  const out: Node[] = [{
    table: { headerRows: 1, widths: ['*', 'auto', 'auto'], body: [head, ...rows, [{ text: t('pdf.total'), bold: true }, '', { text: euro(s.price.total, lang), bold: true, alignment: 'right' }]] },
    layout: { hLineWidth: (i: number, n: { table: { body: unknown[] } }) => (i === 1 || i === n.table.body.length - 1 ? 0.8 : 0.3), hLineColor: (i: number) => (i === 1 ? INK : RULE), vLineWidth: () => 0, paddingLeft: () => 0, paddingRight: (i: number) => (i === 2 ? 0 : 12), paddingTop: () => 4, paddingBottom: () => 4 },
    fontSize: 8.5,
  }];
  if (s.extras.length) {
    out.push({ text: t('ct.pdf.extras'), fontSize: 8, color: DIM, margin: [0, 8, 0, 2] });
    out.push({ table: { widths: ['*', 'auto'], body: s.extras.map((x) => [{ text: `[ ] ${x.description}` }, { text: `+ ${euro(x.amount, lang)}`, alignment: 'right' }]) }, layout: 'noBorders', fontSize: 8.5 });
  }
  out.push({ text: s.price.vatNote, fontSize: 7.5, color: DIM, margin: [0, 4, 0, 0] });
  return out;
}

function signatureBlock(s: ContractSnapshot, sigs: ContractSignature[], t: (k: Key, p?: Record<string, string | number>) => string, lang: Lang): Node {
  const col = (title: string, sig: ContractSignature | undefined, fallbackName: string): Node => ({
    stack: [
      label(title),
      sig?.imageDataUrl ? { image: sig.imageDataUrl, fit: [150, 50], margin: [0, 2, 0, 2] } : sig ? { text: sig.method === 'reply_akkoord' ? t('ct.pdf.acceptedBy', { via: t(`ct.channel.${sig.channel ?? 'other'}`) }) : t('ct.pdf.signedElectronically'), italics: true, fontSize: 8, margin: [0, 18, 0, 4] } : { text: ' ', margin: [0, 26, 0, 0] },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 220, y2: 0, lineWidth: 0.5, lineColor: INK }] },
      { text: sig?.name ?? fallbackName, fontSize: 8.5, margin: [0, 3, 0, 0] },
      sig?.role ? { text: sig.role, fontSize: 7.5, color: DIM } : '',
      { text: sig ? `${t('ct.pdf.signedOn')} ${new Date(sig.signedAt).toLocaleString(lang === 'nl' ? 'nl-NL' : 'en-GB', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Amsterdam' })}${sig.place ? `, ${sig.place}` : ''}` : `${t('ct.pdf.placeDate')} ____________________`, fontSize: 7.5, color: DIM },
    ].filter(Boolean),
  });
  const client = sigs.find((x) => x.party === 'client');
  const us = sigs.find((x) => x.party === 'funqtion');
  return { columns: [col(t('ct.pdf.forClient'), client, s.client.attention || s.client.name), col(t('ct.pdf.forFunqtion'), us, s.funqtion.legalNames || s.funqtion.name)], columnGap: 30, margin: [0, 18, 0, 0], unbreakable: true };
}

function certificate(inp: ContractDocInput, t: (k: Key, p?: Record<string, string | number>) => string, lang: Lang): Node[] {
  const s = inp.snapshot;
  const sigs = inp.signatures ?? [];
  const when = (iso: string) => new Date(iso).toLocaleString(lang === 'nl' ? 'nl-NL' : 'en-GB', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Europe/Amsterdam' });
  const out: Node[] = [
    { text: t('ct.pdf.certificate').toUpperCase(), font: 'Display', fontSize: 16, pageBreak: 'before', margin: [0, 0, 0, 6] },
    { text: t('ct.pdf.certificateIntro'), fontSize: 8, color: DIM, margin: [0, 0, 0, 10] },
    { table: { widths: [120, '*'], body: [
      [{ text: t('ct.pdf.document'), color: DIM }, `${s.number} · ${inp.version.label}`],
      [{ text: t('ct.pdf.issuedOn'), color: DIM }, fmtDate(s.issuedOn, lang, { day: 'numeric', month: 'long', year: 'numeric' })],
      [{ text: 'SHA-256', color: DIM }, { text: inp.version.contentHash ?? '—', fontSize: 7 }],
      ...(inp.version.prevHash ? [[{ text: t('ct.pdf.amends'), color: DIM }, { text: `${s.addendum?.parentLabel ?? ''} · ${inp.version.prevHash}`, fontSize: 7 }]] : []),
      [{ text: t('ct.pdf.terms'), color: DIM }, { text: `${s.terms.version} · ${s.terms.sha256}`, fontSize: 7 }],
    ] }, layout: 'noBorders', fontSize: 8.5 },
  ];
  for (const sig of sigs) {
    out.push({ text: (sig.party === 'client' ? t('ct.pdf.forClient') : t('ct.pdf.forFunqtion')).toUpperCase(), fontSize: 7, color: ACCENT, characterSpacing: 1, margin: [0, 12, 0, 3] });
    const rows: [string, string][] = [
      [t('ct.sig.name'), [sig.name, sig.role].filter(Boolean).join(' – ')],
      [t('ct.sig.method'), `${t(`ct.method.${sig.method}`)}${sig.channel ? ` (${t(`ct.channel.${sig.channel}`)})` : ''} · ${t('ct.pdf.levelSes')}`],
      [t('ct.sig.signedAt'), `${when(sig.signedAt)} (Europe/Amsterdam)`],
      [t('ct.sig.hashMatch'), `${sig.contentHash === inp.version.contentHash ? t('ct.sig.hashOk') : t('ct.sig.hashBad')} (${shortHash(sig.contentHash)})`],
    ];
    if (sig.email) rows.push([t('common.email'), sig.email]);
    if (sig.party === 'client') {
      rows.push([t('ct.sig.consents'), [t('ct.sig.consentContract'), t('ct.sig.consentTerms', { version: sig.consents.terms })].join(' · ')]);
      rows.push([t('ct.sig.photo'), sig.consents.photoOptOut ? t('ct.sig.photoNo') : t('ct.sig.photoYes')]);
      const chosen = s.extras.filter((x) => sig.selectedExtras?.includes(x.id));
      if (s.extras.length) rows.push([t('ct.sig.extras'), chosen.length ? chosen.map((x) => `${x.description} (+${euro(x.amount, lang)})`).join(', ') : t('ct.sig.noExtras')]);
    }
    if (sig.device) rows.push([t('ct.sig.device'), sig.device]);
    if (sig.place) rows.push([t('ct.sig.place'), sig.place]);
    if (sig.note) rows.push([t('common.notes'), sig.note]);
    out.push({ table: { widths: [120, '*'], body: rows.map(([k, v]) => [{ text: k, color: DIM }, v]) }, layout: 'noBorders', fontSize: 8 });
    if (sig.evidenceDataUrl) out.push({ image: sig.evidenceDataUrl, fit: [220, 220], margin: [120, 4, 0, 0] });
  }
  if (inp.events?.length) {
    out.push({ text: t('ct.timeline').toUpperCase(), fontSize: 7, color: DIM, characterSpacing: 1, margin: [0, 14, 0, 3] });
    out.push({ table: { widths: [120, '*'], body: inp.events.map((e) => [{ text: when(e.at), color: DIM }, `${t(`ct.event.${e.type}`)}${e.note ? ` – ${e.note}` : ''}`]) }, layout: 'noBorders', fontSize: 7.5 });
  }
  return out;
}

export function contractDefinition(inp: ContractDocInput): Node {
  const s = inp.snapshot;
  const lang = s.language;
  const t = (k: Key, p?: Record<string, string | number>) => translate(lang, k, p);
  const isAdd = inp.version.kind === 'addendum';
  const sigs = inp.signatures ?? [];
  const title = isAdd ? t('ct.pdf.addendum') : t('ct.pdf.title');
  const content: Node[] = [
    {
      columns: [
        inp.logoSvg ? { svg: inp.logoSvg, width: 54, height: 54 } : { text: '', width: 54 },
        { width: '*', stack: [{ text: title.toUpperCase(), font: 'Display', fontSize: 22, margin: [14, 6, 0, 0] }, { text: inp.businessName, margin: [14, 2, 0, 0], color: DIM, fontSize: 8 }] },
        { width: 170, alignment: 'right', fontSize: 8.5, stack: [
          label(t('ct.pdf.number')), { text: s.number, bold: true }, { text: inp.version.label, color: DIM },
          inp.version.status === 'draft' ? { text: t('pdf.draft').toUpperCase(), color: ACCENT, bold: true, margin: [0, 4, 0, 0] } : '',
        ] },
      ],
    },
    { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1.5, lineColor: ACCENT }], margin: [0, 14, 0, 12] },
    { columns: [party(t('ct.pdf.funqtion'), s.funqtion, lang), party(t('ct.pdf.client'), s.client, lang)], columnGap: 30 },
    summaryBox(s, t, lang),
  ];
  if (isAdd && s.addendum) {
    content.push({ text: t('ct.pdf.addendumIntro', { parent: s.addendum.parentLabel, hash: shortHash(s.addendum.parentHash) }), margin: [0, 8, 0, 6] });
    if (s.addendum.reason) content.push({ text: [{ text: `${t('ct.addendum.reason')}: `, color: DIM }, s.addendum.reason], fontSize: 8.5, margin: [0, 0, 0, 6] });
    content.push({
      table: { headerRows: 1, widths: [90, '*', '*'], body: [
        [t('ct.diff.field'), t('ct.diff.old'), t('ct.diff.new')].map((h) => ({ text: h.toUpperCase(), color: DIM, fontSize: 7 })),
        ...s.addendum.changes.map((c) => [{ text: t(`ct.diff.${c.field}` as Key), bold: true }, { text: c.old || '—', color: DIM }, { text: c.new || '—' }]),
      ] },
      layout: { hLineWidth: (i: number) => (i === 1 ? 0.8 : 0.3), hLineColor: (i: number) => (i === 1 ? INK : RULE), vLineWidth: () => 0, paddingLeft: () => 0, paddingTop: () => 4, paddingBottom: () => 4 },
      fontSize: 8.5,
    });
    if (s.specialTerms) content.push({ stack: [{ text: t('ct.special'), bold: true, margin: [0, 10, 0, 2] }, ...body(s.specialTerms)] });
    content.push({ text: t('ct.pdf.restUnchanged', { parent: s.addendum.parentLabel }), margin: [0, 10, 0, 0] });
  } else {
    if (s.intro) content.push({ text: s.intro, margin: [0, 6, 0, 6] });
    content.push({ text: t('ct.pdf.whatWeAgree').toUpperCase(), fontSize: 7, color: DIM, characterSpacing: 1, margin: [0, 8, 0, 4] });
    content.push(...servicesTable(s, t, lang));
    if (s.specialTerms) content.push({ stack: [{ text: t('ct.special'), bold: true, fontSize: 10, margin: [0, 12, 0, 2] }, ...body(s.specialTerms)] });
    content.push({ text: t('ct.pdf.articles').toUpperCase(), fontSize: 7, color: DIM, characterSpacing: 1, margin: [0, 14, 0, 2] });
    for (const c of s.clauses) {
      content.push({ stack: [{ text: [{ text: `${c.nr}  `, color: ACCENT }, c.title], bold: true, fontSize: 9.5, margin: [0, 8, 0, 2] }, ...body(c.body)], unbreakable: c.body.length < 900 });
    }
  }
  content.push(signatureBlock(s, sigs, t, lang));
  if (!isAdd && s.rider) {
    content.push({ text: t('ct.pdf.annex1').toUpperCase(), font: 'Display', fontSize: 14, pageBreak: 'before', margin: [0, 0, 0, 2] });
    content.push({ text: `${s.rider.name} · v${s.rider.version}`, fontSize: 8, color: DIM, margin: [0, 0, 0, 8] });
    content.push({ text: t('ct.rider.technical'), bold: true, margin: [0, 4, 0, 2] }, { ul: s.rider.technical, fontSize: 8.5, markerColor: ACCENT });
    content.push({ text: t('ct.rider.hospitality'), bold: true, margin: [0, 10, 0, 2] }, { ul: s.rider.hospitality, fontSize: 8.5, markerColor: ACCENT });
    if (s.rider.venueNotes.length) content.push({ text: t('ct.rider.venueNotes'), bold: true, margin: [0, 10, 0, 2] }, { ul: s.rider.venueNotes, fontSize: 8.5, markerColor: ACCENT });
  }
  if (!isAdd && s.terms.text) {
    content.push({ text: t('ct.pdf.annex2').toUpperCase(), font: 'Display', fontSize: 14, pageBreak: 'before', margin: [0, 0, 0, 2] });
    content.push({ text: `${t('ct.pdf.termsVersion', { version: s.terms.version })} · SHA-256 ${shortHash(s.terms.sha256)}`, fontSize: 7, color: DIM, margin: [0, 0, 0, 8] });
    content.push({ text: s.terms.text, fontSize: 6.8, lineHeight: 1.2 });
  }
  if (sigs.length) content.push(...certificate(inp, t, lang));
  const foot = `${s.number} · ${inp.version.label}${inp.version.contentHash ? ` · sha256 ${shortHash(inp.version.contentHash)}` : ''}`;
  return {
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 56],
    defaultStyle: { font: 'Mono', fontSize: 9, color: INK, lineHeight: 1.3 },
    info: { title: `${title} ${s.number}`, author: inp.businessName, creator: 'Funqtion Hub' },
    footer: (page: number, pages: number) => ({
      margin: [40, 18, 40, 0],
      columns: [{ text: foot, fontSize: 6.5, color: DIM }, { text: `FEEL THE MUSIQ   ${page}/${pages}`, fontSize: 6.5, color: ACCENT, alignment: 'right', width: 'auto' }],
    }),
    content,
  };
}
