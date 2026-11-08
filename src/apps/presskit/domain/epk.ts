import { EPK_SECTIONS, type Epk, type EpkLangText, type Gig, type Lang, type MediaAsset, type Review, type Venue } from '../../../core/types';
import { isPrivateEvent } from '../../promo/domain/promo';

// App 12 – Press Kit. Pure generator: data in, static HTML files out, in the
// look of funqtion-site (its own CSS classes and header/footer), so the pages
// drop into that repo as presskit/ and en/presskit/. No JavaScript is needed
// beyond the site's own menu/background scripts; embeds load only on click.

export const EPK_ID = 'epk';
export const HTML_BUDGET = 150 * 1024;   // funqtion/BUDGET.md: first load excl. images

// Default copy is the site's own text (over.html), used verbatim. The English
// version is a translation to check before publishing.
export function defaultEpk(): Omit<Epk, 'id' | 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'> {
  return {
    nl: {
      seoTitle: 'Perskit - Team Funqtion',
      bioShort: 'Team Funqtion is Gijs van Doren en Coen Peels, een DJ duo uit Aarle-Rixtel. FEEL THE MUSIQ.',
      bioLong: "Wij zijn Team Funqtion – twee gepassioneerde DJ's met één missie: elk feest onvergetelijk maken. Onze sets zijn energiek, creatief en afgestemd op het publiek. Samen vormen we een dynamisch duo dat perfect op elkaar is ingespeeld, zowel op het podium als daarbuiten.",
      riderSummary: 'Wij nemen geluid, licht en laser mee. Nodig: een vlakke plek van ongeveer 3 × 2 meter, twee gewone stopcontacten (230 V, aparte groepen) en een parkeerplek voor auto met aanhanger dicht bij de ingang.',
    },
    en: {
      seoTitle: 'Press kit - Team Funqtion',
      bioShort: 'Team Funqtion is Gijs van Doren and Coen Peels, a DJ duo from Aarle-Rixtel, the Netherlands. FEEL THE MUSIQ.',
      bioLong: 'We are Team Funqtion – two passionate DJs with one mission: making every party unforgettable. Our sets are energetic, creative and tuned to the crowd. Together we are a dynamic duo that works perfectly together, on stage and off.',
      riderSummary: 'We bring sound, light and laser. Needed: a flat area of about 3 × 2 metres, two normal sockets (230 V, separate circuits) and parking for a car with trailer close to the entrance.',
    },
    sections: [...EPK_SECTIONS],
    photoIds: [], logoIds: [], mixIds: [], videoIds: [], reviewIds: [], hiddenGigIds: [],
    siteBase: 'https://gbom2009.github.io/funqtion-site/',
    bookingEmail: 'Booking@funqtion.nl',
    instagram: 'https://www.instagram.com/funqtion1/',
    version: 0,
  };
}

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const para = (s: string) => s.split(/\n{2,}/).map((p) => `<p class="fq-prose">${esc(p.trim()).replace(/\n/g, '<br>')}</p>`).join('\n');

export function slugFile(m: MediaAsset, i: number): string {
  const ext = (m.mime.split('/')[1] ?? 'bin').replace('jpeg', 'jpg').replace('svg+xml', 'svg').replace(/[^a-z0-9]/g, '');
  const name = m.title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'media';
  return `${String(i + 1).padStart(2, '0')}-${name}.${ext}`;
}

export interface PastGig { id: string; date: string; title: string; city?: string }
/** Played public gigs, newest first; private parties only as a count. */
export function pastGigs(gigs: Gig[], venues: Venue[], hidden: string[]): { list: PastGig[]; privateCount: number } {
  const played = gigs.filter((g) => !g.deletedAt && ['played', 'invoiced', 'paid'].includes(g.stage));
  const vmap = new Map(venues.map((v) => [v.id, v]));
  const list = played.filter((g) => !isPrivateEvent(g.eventType) && !hidden.includes(g.id))
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((g) => ({ id: g.id, date: g.date, title: g.title, city: g.venueId ? vmap.get(g.venueId)?.city : undefined }));
  return { list, privateCount: played.filter((g) => isPrivateEvent(g.eventType)).length };
}

export function testimonialName(r: Review, lang: Lang, eventLabel?: string) {
  if (r.mayUseName && r.displayName) return r.displayName;
  return eventLabel ?? (lang === 'nl' ? 'Opdrachtgever' : 'Client');
}

/** Reviews that may be shown: explicit permission, approved by us, not withdrawn. */
export const publishable = (r: Review) => !r.deletedAt && !!r.mayPublish && !!r.text?.trim() && !!r.approvedAt;

export interface EpkInput {
  epk: Epk;
  media: MediaAsset[];
  reviews: Review[];
  gigs: Gig[];
  venues: Venue[];
  year?: number;
}

const L = {
  nl: {
    label: 'Perskit', members: 'Bezetting', photos: "Foto's", mixes: 'Mixes', videos: "Video's", testimonials: 'Zij gingen je voor', gigs: 'Feesten',
    rider: 'Wat wij nodig hebben', downloads: 'Downloads', booking: 'Boeken', book: 'Boek ons', mail: 'Mail ons', logos: "Logo's",
    pdf: 'Perskit (PDF)', photoDl: 'download', privateParties: (n: number) => `+ ${n} privéfeest${n === 1 ? '' : 'en'}`, open: 'Openen',
    skip: 'Naar de inhoud', other: 'English', otherHref: 'en/presskit/', credit: 'Foto', role: { gijs: 'Creatieve kracht', coen: 'Energie en drive' },
    style: { gijs: 'Hardstyle / Hardcore', coen: 'Alle genres' }, roleK: 'Rol', styleK: 'Stijl', rights: 'Alle rechten voorbehouden.',
    nav: [['index.html', 'Home'], ['over.html', 'Over ons'], ['feesten.html', 'Feesten'], ['boeken.html', 'Boeken'], ['bieden.html', 'Wat wij bieden'], ['tip.html', 'Muziek aanrader']],
  },
  en: {
    label: 'Press kit', members: 'Line-up', photos: 'Photos', mixes: 'Mixes', videos: 'Videos', testimonials: 'What clients say', gigs: 'Parties',
    rider: 'What we need', downloads: 'Downloads', booking: 'Booking', book: 'Book us', mail: 'E-mail us', logos: 'Logos',
    pdf: 'Press kit (PDF)', photoDl: 'download', privateParties: (n: number) => `+ ${n} private part${n === 1 ? 'y' : 'ies'}`, open: 'Open',
    skip: 'Skip to content', other: 'Nederlands', otherHref: 'presskit/', credit: 'Photo', role: { gijs: 'Creative force', coen: 'Energy and drive' },
    style: { gijs: 'Hardstyle / Hardcore', coen: 'All genres' }, roleK: 'Role', styleK: 'Style', rights: 'All rights reserved.',
    nav: [['index.html', 'Home'], ['over.html', 'About'], ['feesten.html', 'Parties'], ['boeken.html', 'Booking'], ['bieden.html', 'What we offer'], ['tip.html', 'Music tip']],
  },
};

const fmt = (d: string, lang: Lang) => new Date(d + 'T12:00:00').toLocaleDateString(lang === 'nl' ? 'nl-NL' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

function jsonLd(epk: Epk, lang: Lang, url: string, photoUrls: string[]) {
  const t = epk[lang];
  const data = {
    '@context': 'https://schema.org',
    '@type': 'MusicGroup',
    name: 'Team Funqtion',
    alternateName: 'Funqtion',
    slogan: 'FEEL THE MUSIQ',
    description: t.bioShort,
    url,
    email: epk.bookingEmail,
    genre: ['Hardstyle', 'Hardcore', 'Dance'],
    foundingLocation: { '@type': 'Place', name: 'Aarle-Rixtel, Noord-Brabant, NL' },
    member: [{ '@type': 'Person', name: 'Gijs van Doren' }, { '@type': 'Person', name: 'Coen Peels' }],
    image: photoUrls.slice(0, 3),
    sameAs: [epk.instagram].filter(Boolean),
  };
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

/** One press kit page. `root` is the relative path back to the site root. */
export function renderPage(input: EpkInput, lang: Lang, files: { photos: { file: string; m: MediaAsset }[]; logoZip?: string; pdf?: string }): string {
  const { epk } = input;
  const t = epk[lang];
  const l = L[lang];
  const root = lang === 'nl' ? '../' : '../../';
  const media = lang === 'nl' ? 'media/' : '../../presskit/media/';
  const dl = lang === 'nl' ? '' : '../../presskit/';
  const base = epk.siteBase.replace(/\/?$/, '/');
  const url = base + (lang === 'nl' ? 'presskit/' : 'en/presskit/');
  const byId = new Map(input.media.map((m) => [m.id, m]));
  const show = (s: (typeof EPK_SECTIONS)[number]) => epk.sections.includes(s);
  const section = (label: string, body: string, id: string) => `
  <section class="fq-section fq-grid fq-grid--padded" id="${id}">
    <div class="fq-cell" style="--col-span:3; --col-span-m:12"><h2 class="fq-label">${esc(label)}</h2></div>
    <div class="fq-cell" style="--col-start:5; --col-span:8; --col-start-m:auto; --col-span-m:12">
${body}
    </div>
  </section>`;

  const parts: string[] = [];
  for (const s of epk.sections) {
    if (s === 'bio') continue;
    if (s === 'members') {
      const member = (img: string, w: number, h: number, name: string, key: 'gijs' | 'coen') => `      <article class="fq-member">
        <img class="fq-member__portrait" src="${root}img/${img}" width="${w}" height="${h}" loading="lazy" decoding="async" alt="${esc(name)}">
        <div>
          <div class="fq-member__head"><h3 class="fq-h3" style="margin:0">${esc(name)}</h3></div>
          <dl class="fq-datasheet fq-inventory">
            <div class="fq-datasheet__row"><span class="fq-datasheet__cell" style="--col-span:3"><dt class="fq-datasheet__key">${l.roleK}</dt></span><span class="fq-datasheet__cell" style="--col-span:5"><dd class="fq-datasheet__value">${esc(l.role[key])}</dd></span></div>
            <div class="fq-datasheet__row"><span class="fq-datasheet__cell" style="--col-span:3"><dt class="fq-datasheet__key">${l.styleK}</dt></span><span class="fq-datasheet__cell" style="--col-span:5"><dd class="fq-datasheet__value">${esc(l.style[key])}</dd></span></div>
          </dl>
        </div>
      </article>`;
      parts.push(section(l.members, member('gijs.jpg', 1400, 1297, 'Gijs van Doren', 'gijs') + '\n' + member('coen.jpg', 1400, 1185, 'Coen Peels', 'coen'), 'members'));
    }
    if (s === 'photos' && files.photos.length) {
      parts.push(section(l.photos, `      <div class="fq-epk-photos" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px">
${files.photos.map(({ file, m }) => `        <figure style="margin:0"><a href="${media}${file}" download><img src="${media}${file}" ${m.width ? `width="${m.width}" height="${m.height}"` : ''} loading="lazy" decoding="async" alt="${esc(m.title)}" style="width:100%;height:auto;display:block"></a>${m.photographer ? `<figcaption class="fq-label" style="margin-top:4px">${l.credit}: ${esc(m.photographer)}</figcaption>` : ''}</figure>`).join('\n')}
      </div>`, 'photos'));
    }
    const links = (ids: string[]) => ids.map((id) => byId.get(id)).filter((m): m is MediaAsset => !!m?.externalUrl);
    if (s === 'mixes' && links(epk.mixIds).length) {
      parts.push(section(l.mixes, `      <ul class="fq-prose" style="list-style:none;padding:0">
${links(epk.mixIds).map((m) => `        <li><a class="fq-button fq-bracket" href="${esc(m.externalUrl!)}" target="_blank" rel="noopener">${esc(m.title)} &#8599;</a></li>`).join('\n')}
      </ul>`, 'mixes'));
    }
    if (s === 'videos' && links(epk.videoIds).length) {
      parts.push(section(l.videos, `      <ul class="fq-prose" style="list-style:none;padding:0">
${links(epk.videoIds).map((m) => `        <li><a class="fq-button fq-bracket" href="${esc(m.externalUrl!)}" target="_blank" rel="noopener">${esc(m.title)} &#8599;</a></li>`).join('\n')}
      </ul>`, 'videos'));
    }
    if (s === 'testimonials') {
      const revs = epk.reviewIds.map((id) => input.reviews.find((r) => r.id === id)).filter((r): r is Review => !!r && publishable(r));
      if (revs.length) {
        const gigOf = new Map(input.gigs.map((g) => [g.id, g]));
        parts.push(section(l.testimonials, revs.map((r) => {
          const g = gigOf.get(r.gigId);
          return `      <blockquote class="fq-prose fq-prose--strong" style="margin:0 0 24px">&ldquo;${esc(r.text!.trim())}&rdquo;<footer class="fq-label" style="margin-top:6px">— ${esc(testimonialName(r, lang, g ? (lang === 'nl' ? eventNl(g.eventType) : eventEn(g.eventType)) : undefined))}${r.rating ? ` · ${'★'.repeat(Math.round(r.rating))}` : ''}</footer></blockquote>`;
        }).join('\n'), 'testimonials'));
      }
    }
    if (s === 'gigs') {
      const { list, privateCount } = pastGigs(input.gigs, input.venues, epk.hiddenGigIds);
      if (list.length || privateCount) {
        parts.push(section(l.gigs, `      <dl class="fq-datasheet">
${list.slice(0, 20).map((g) => `        <div class="fq-datasheet__row"><span class="fq-datasheet__cell" style="--col-span:3"><dt class="fq-datasheet__key">${esc(fmt(g.date, lang))}</dt></span><span class="fq-datasheet__cell" style="--col-span:5"><dd class="fq-datasheet__value">${esc(g.title)}${g.city ? `, ${esc(g.city)}` : ''}</dd></span></div>`).join('\n')}
      </dl>${privateCount ? `\n      <p class="fq-label">${esc(l.privateParties(privateCount))}</p>` : ''}`, 'gigs'));
      }
    }
    if (s === 'rider' && t.riderSummary.trim()) parts.push(section(l.rider, para(t.riderSummary), 'rider'));
    if (s === 'downloads' && (files.logoZip || files.pdf)) {
      parts.push(section(l.downloads, `      <div class="fq-contact" style="display:flex;gap:12px;flex-wrap:wrap">
${files.logoZip ? `        <a class="fq-button fq-bracket" href="${dl}${files.logoZip}" download>${l.logos} (ZIP)</a>` : ''}
${files.pdf ? `        <a class="fq-button fq-bracket" href="${dl}${files.pdf.replace('{lang}', lang)}" download>${l.pdf}</a>` : ''}
      </div>`, 'downloads'));
    }
    if (s === 'booking') {
      parts.push(section(l.booking, `      <div class="fq-contact" style="display:flex;gap:12px;flex-wrap:wrap">
        <a class="fq-button fq-bracket" href="${root}boeken.html">${l.book}</a>
        <a class="fq-button fq-bracket" href="mailto:${esc(epk.bookingEmail)}?subject=${encodeURIComponent(lang === 'nl' ? 'Boekingsaanvraag via de perskit' : 'Booking enquiry via the press kit')}">${l.mail}</a>
      </div>`, 'booking'));
    }
  }

  const photoUrls = files.photos.map((p) => base + 'presskit/media/' + p.file);
  const year = input.year ?? new Date().getFullYear();
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(t.seoTitle)}</title>
<meta name="description" content="${esc(t.bioShort.slice(0, 155))}">
<link rel="canonical" href="${url}">
<link rel="alternate" hreflang="nl" href="${base}presskit/">
<link rel="alternate" hreflang="en" href="${base}en/presskit/">
<link rel="alternate" hreflang="x-default" href="${base}presskit/">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(t.seoTitle)}">
<meta property="og:description" content="${esc(t.bioShort.slice(0, 200))}">
<meta property="og:url" content="${url}">
${photoUrls[0] ? `<meta property="og:image" content="${photoUrls[0]}">\n<meta name="twitter:card" content="summary_large_image">` : '<meta name="twitter:card" content="summary">'}
<link rel="icon" href="${root}img/logo.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400&family=Archivo+Black&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${root}css/tokens.css">
<link rel="stylesheet" href="${root}css/primitives.css">
<link rel="stylesheet" href="${root}css/site.css">
${jsonLd(epk, lang, url, photoUrls)}
</head>
<body>

<a class="fq-skip" href="#main">${l.skip}</a>

<header class="fq-topbar">
  <a class="fq-topbar__brand" href="${root}index.html">
    <img class="fq-topbar__logo" src="${root}img/logo.svg" width="32" height="32" alt="Logo Team Funqtion">
    <span class="fq-topbar__wordmark">Team Funqtion</span>
  </a>
  <nav class="fq-topnav" aria-label="${lang === 'nl' ? 'Hoofdnavigatie' : 'Main navigation'}">
${l.nav.map(([href, label]) => `    <a class="fq-topnav__link" href="${root}${href}"><span class="fq-topnav__swap"><span class="fq-topnav__t">${label}</span><span class="fq-topnav__t" aria-hidden="true">${label}</span></span></a>`).join('\n')}
    <a class="fq-topnav__link" href="${root}${l.otherHref}" hreflang="${lang === 'nl' ? 'en' : 'nl'}"><span class="fq-topnav__swap"><span class="fq-topnav__t">${l.other}</span><span class="fq-topnav__t" aria-hidden="true">${l.other}</span></span></a>
  </nav>
</header>

<main id="main">

  <section class="fq-section fq-section--first fq-grid fq-grid--padded">
    <div class="fq-cell" style="--col-span:3; --col-span-m:12"><p class="fq-label">${l.label}</p></div>
    <div class="fq-cell" style="--col-start:5; --col-span:8; --col-start-m:auto; --col-span-m:12">
      <h1 class="fq-h1">Team Funqtion</h1>
      <p class="fq-prose fq-prose--strong">${esc(t.bioShort)}</p>
${show('bio') ? para(t.bioLong) : ''}
${t.quote ? `      <p class="fq-prose fq-prose--strong">&ldquo;${esc(t.quote)}&rdquo;</p>` : ''}
    </div>
  </section>
${parts.join('\n')}

</main>

<footer class="fq-footer">
  <div class="fq-grid fq-grid--padded fq-footer__grid">
    <div class="fq-cell fq-footer__col" style="--col-span:6; --col-span-m:12">
      <p class="fq-label">Contact</p>
      <a class="fq-footer__link" href="mailto:${esc(epk.bookingEmail)}">${esc(epk.bookingEmail)}</a>
      ${epk.instagram ? `<a class="fq-footer__link" href="${esc(epk.instagram)}" target="_blank" rel="noopener">Instagram &#8599;</a>` : ''}
    </div>
    <div class="fq-cell fq-footer__col" style="--col-start:10; --col-span:3; --col-start-m:auto; --col-span-m:12">
      <p class="fq-label">${lang === 'nl' ? 'Basis' : 'Base'}</p>
      <p class="fq-footer__value">Aarle-Rixtel, NL</p>
      <p class="fq-footer__value">${lang === 'nl' ? 'Geluid &#183; Licht &#183; Laser' : 'Sound &#183; Light &#183; Laser'}</p>
    </div>
  </div>
  <div class="fq-grid fq-grid--padded fq-footer__mark">
    <div class="fq-cell" style="--col-span:12">
      <p class="fq-footer__tagline">FEEL THE MUSIQ</p>
      <p class="fq-footer__legal">&copy; ${year} FEEL THE MUSIQ - Team Funqtion. ${l.rights}</p>
    </div>
  </div>
</footer>

<div class="fq-bg-host" id="fq-bg" aria-hidden="true"></div>
<div class="fq-grain-host" id="fq-grain" aria-hidden="true"></div>
<script src="${root}js/bg.js"></script>
<script src="${root}js/grain.js"></script>
</body>
</html>
`;
}

const EVENT_NL: Record<string, string> = { wedding: 'Bruiloft', village_festival: 'Dorpsfeest', carnival: 'Carnaval', club: 'Club', private_party: 'Privéfeest', company: 'Bedrijfsfeest', festival: 'Festival', other: 'Feest' };
const EVENT_EN: Record<string, string> = { wedding: 'Wedding', village_festival: 'Village festival', carnival: 'Carnival', club: 'Club', private_party: 'Private party', company: 'Company party', festival: 'Festival', other: 'Party' };
const eventNl = (t: string) => EVENT_NL[t] ?? 'Feest';
const eventEn = (t: string) => EVENT_EN[t] ?? 'Party';
export const eventLabel = (t: string, lang: Lang) => (lang === 'nl' ? eventNl(t) : eventEn(t));

export const SITE_PAGES = ['index.html', 'over.html', 'feesten.html', 'boeken.html', 'bieden.html', 'tip.html'];

export function sitemap(base: string, lastmod: string): string {
  const b = base.replace(/\/?$/, '/');
  const urls = [...SITE_PAGES.map((p) => b + (p === 'index.html' ? '' : p)), b + 'presskit/', b + 'en/presskit/'];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u}</loc><lastmod>${lastmod}</lastmod></url>`).join('\n')}
</urlset>
`;
}

export interface Plan { pages: Record<string, string>; photos: { file: string; m: MediaAsset }[]; logos: { file: string; m: MediaAsset }[]; htmlBytes: number; overBudget: boolean; warnings: string[] }

/** Everything that will be written, plus checks (budget, missing English, unchecked photos). */
export function planPublish(input: EpkInput, opts: { logoZip?: string; pdf?: string } = {}): Plan {
  const { epk } = input;
  const byId = new Map(input.media.map((m) => [m.id, m]));
  const warnings: string[] = [];
  const photos = epk.photoIds.map((id) => byId.get(id)).filter((m): m is MediaAsset => !!m && !m.deletedAt && !!m.blob)
    .map((m, i) => ({ file: slugFile(m, i), m }));
  for (const p of photos) {
    if (p.m.usage !== 'press_ok') warnings.push(`usage:${p.m.title}`);
    if (p.m.people === 'recognisable' && !(p.m.consentIds?.length)) warnings.push(`consent:${p.m.title}`);
  }
  const logos = epk.logoIds.map((id) => byId.get(id)).filter((m): m is MediaAsset => !!m && !m.deletedAt && !!m.blob).map((m, i) => ({ file: slugFile(m, i), m }));
  const files = { photos, logoZip: logos.length ? opts.logoZip : undefined, pdf: opts.pdf };
  const pages = {
    'presskit/index.html': renderPage(input, 'nl', files),
    'en/presskit/index.html': renderPage(input, 'en', files),
  };
  for (const k of ['bioShort', 'bioLong'] as (keyof EpkLangText)[]) if (!epk.en[k]?.trim()) warnings.push(`en:${k}`);
  if (epk.nl.bioShort.length > 300) warnings.push('bioShort:long');
  const htmlBytes = Math.max(...Object.values(pages).map((p) => new TextEncoder().encode(p).length));
  return { pages, photos, logos, htmlBytes, overBudget: htmlBytes > HTML_BUDGET, warnings };
}
