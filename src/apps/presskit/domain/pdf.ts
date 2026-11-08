import type { Lang } from '../../../core/types';
import { eventLabel, pastGigs, publishable, testimonialName, type EpkInput } from './epk';

// pdfmake definition for the one-page press kit (A4). Pure, testable in Node.
// Same paper look as quotes and contracts: white, near-black, one orange accent.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Node = any;
const INK = '#141414';
const DIM = '#6b6b6b';
const ACCENT = '#f68712';

const T = {
  nl: { kit: 'PERSKIT', members: 'BEZETTING', gigs: 'FEESTEN', quotes: 'ZIJ GINGEN JE VOOR', rider: 'WAT WIJ NODIG HEBBEN', contact: 'BOEKEN', priv: (n: number) => `+ ${n} privéfeest${n === 1 ? '' : 'en'}` },
  en: { kit: 'PRESS KIT', members: 'LINE-UP', gigs: 'PARTIES', quotes: 'WHAT CLIENTS SAY', rider: 'WHAT WE NEED', contact: 'BOOKING', priv: (n: number) => `+ ${n} private part${n === 1 ? 'y' : 'ies'}` },
};

export function epkPdf(input: EpkInput, lang: Lang, opts: { logoSvg?: string; photos?: string[] } = {}): Node {
  const { epk } = input;
  const t = epk[lang];
  const l = T[lang];
  const head = (s: string): Node => ({ text: s, color: DIM, fontSize: 7, characterSpacing: 1.2, margin: [0, 12, 0, 4] });
  const { list, privateCount } = pastGigs(input.gigs, input.venues, epk.hiddenGigIds);
  const gigOf = new Map(input.gigs.map((g) => [g.id, g]));
  const reviews = epk.reviewIds.map((id) => input.reviews.find((r) => r.id === id)).filter((r) => !!r && publishable(r)).slice(0, 3);
  const photos = (opts.photos ?? []).slice(0, 2);
  return {
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 50],
    defaultStyle: { font: 'Mono', fontSize: 9, color: INK, lineHeight: 1.25 },
    info: { title: t.seoTitle, author: 'Team Funqtion' },
    footer: (current: number, count: number) => ({
      columns: [{ text: 'FEEL THE MUSIQ', color: ACCENT, characterSpacing: 1.5, fontSize: 7 }, { text: `${epk.bookingEmail} · ${current}/${count}`, alignment: 'right', color: DIM, fontSize: 7 }],
      margin: [40, 16, 40, 0],
    }),
    content: [
      {
        columns: [
          opts.logoSvg ? { svg: opts.logoSvg, width: 56, height: 56 } : { text: '', width: 56 },
          { stack: [{ text: l.kit, color: DIM, fontSize: 7, characterSpacing: 1.5 }, { text: 'Team Funqtion', font: 'Display', fontSize: 26 }, { text: 'FEEL THE MUSIQ', color: ACCENT, characterSpacing: 2, fontSize: 8 }], margin: [12, 4, 0, 0] },
        ],
      },
      { text: t.bioShort, bold: true, margin: [0, 14, 0, 6], fontSize: 10 },
      { text: t.bioLong },
      photos.length ? { columns: photos.map((p) => ({ image: p, width: 250, margin: [0, 12, 0, 0] })), columnGap: 15 } : '',
      head(l.members),
      { columns: [{ text: [{ text: 'Gijs van Doren', bold: true }, '\nHardstyle / Hardcore'] }, { text: [{ text: 'Coen Peels', bold: true }, lang === 'nl' ? '\nAlle genres' : '\nAll genres'] }] },
      list.length || privateCount ? head(l.gigs) : '',
      list.length ? { ul: list.slice(0, 8).map((g) => `${g.date.slice(0, 4)} · ${g.title}${g.city ? `, ${g.city}` : ''}`), markerColor: ACCENT } : '',
      privateCount ? { text: l.priv(privateCount), color: DIM, margin: [0, 2, 0, 0] } : '',
      reviews.length ? head(l.quotes) : '',
      ...reviews.map((r) => {
        const g = gigOf.get(r!.gigId);
        return { text: [{ text: `“${r!.text!.trim()}”` }, { text: `  — ${testimonialName(r!, lang, g ? eventLabel(g.eventType, lang) : undefined)}`, color: DIM }], margin: [0, 0, 0, 6] };
      }),
      t.riderSummary ? head(l.rider) : '',
      t.riderSummary ? { text: t.riderSummary } : '',
      head(l.contact),
      { text: [{ text: epk.bookingEmail, color: ACCENT }, `  ·  ${epk.siteBase.replace(/\/?$/, '/')}${lang === 'nl' ? 'presskit/' : 'en/presskit/'}`] },
    ].filter(Boolean),
  };
}
