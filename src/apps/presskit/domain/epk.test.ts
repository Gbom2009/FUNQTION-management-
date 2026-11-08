import { describe, expect, it } from 'vitest';
import type { Epk, Gig, MediaAsset, Review, Venue } from '../../../core/types';
import { defaultEpk, esc, pastGigs, planPublish, publishable, renderPage, sitemap, slugFile, HTML_BUDGET } from './epk';

const base = { createdAt: '', createdBy: 'gijs' as const, updatedAt: '', updatedBy: 'gijs' as const };
const epk = (p: Partial<Epk> = {}): Epk => ({ ...base, id: 'epk', ...defaultEpk(), ...p });
const gig = (p: Partial<Gig>): Gig => ({ ...base, id: 'g' + Math.random(), reference: '', title: 'Dorpsfeest Aarle-Rixtel', eventType: 'village_festival', date: '2026-06-01', startTime: '20:00', endTime: '01:00', setupRequired: true, stage: 'played', stageChangedAt: '', ownerId: 'gijs', performers: [], setSlots: [], contacts: [], musicWishes: [], ...p } as Gig);
const venue: Venue = { ...base, id: 'v1', name: 'Tent', city: 'Aarle-Rixtel' } as Venue;
const photo = (p: Partial<MediaAsset> = {}): MediaAsset => ({ ...base, id: 'm' + Math.random(), kind: 'photo', title: 'Knip Gala 2K25!', mime: 'image/jpeg', blob: new Blob(['x']), tags: [], people: 'none', usage: 'press_ok', width: 1600, height: 1067, ...p });
const review = (p: Partial<Review>): Review => ({ ...base, id: 'r' + Math.random(), gigId: 'g1', text: 'Top avond!', rating: 5, mayPublish: true, approvedAt: '2026-06-02', ...p });

describe('press kit generator', () => {
  it('escapes HTML and makes safe file names', () => {
    expect(esc('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
    expect(slugFile(photo(), 0)).toBe('01-knip-gala-2k25.jpg');
  });
  it('lists public played gigs and only counts private parties', () => {
    const gigs = [gig({ id: 'a', date: '2026-05-01' }), gig({ id: 'b', date: '2026-07-01', venueId: 'v1' }), gig({ id: 'c', eventType: 'wedding', title: 'Bruiloft Lisa' }), gig({ id: 'd', stage: 'confirmed' }), gig({ id: 'e' })];
    const r = pastGigs(gigs, [venue], ['e']);
    expect(r.list.map((g) => g.date)).toEqual(['2026-07-01', '2026-05-01']);
    expect(r.list[0].city).toBe('Aarle-Rixtel');
    expect(r.privateCount).toBe(1);
  });
  it('shows only approved reviews with permission', () => {
    expect(publishable(review({}))).toBe(true);
    expect(publishable(review({ mayPublish: false }))).toBe(false);
    expect(publishable(review({ approvedAt: undefined }))).toBe(false);
  });
  it('renders NL and EN pages with SEO basics and relative paths', () => {
    const p = photo();
    const r = review({ displayName: 'Lisa & Tom', mayUseName: true });
    const input = { epk: epk({ photoIds: [p.id], reviewIds: [r.id] }), media: [p], reviews: [r], gigs: [gig({ id: 'g1', eventType: 'wedding' })], venues: [] };
    const nl = renderPage(input, 'nl', { photos: [{ file: '01-x.jpg', m: p }], pdf: 'funqtion-presskit-{lang}.pdf' });
    expect(nl).toContain('<html lang="nl">');
    expect(nl).toContain('<link rel="canonical" href="https://gbom2009.github.io/funqtion-site/presskit/">');
    expect(nl).toContain('hreflang="en" href="https://gbom2009.github.io/funqtion-site/en/presskit/"');
    expect(nl).toContain('"@type":"MusicGroup"');
    expect(nl).toContain('href="../css/site.css"');
    expect(nl).toContain('src="media/01-x.jpg"');
    expect(nl).toContain('Lisa &amp; Tom');
    expect(nl).toContain('funqtion-presskit-nl.pdf');
    expect(nl).not.toContain('Bruiloft Lisa');
    const en = renderPage(input, 'en', { photos: [{ file: '01-x.jpg', m: p }] });
    expect(en).toContain('<html lang="en">');
    expect(en).toContain('href="../../css/site.css"');
    expect(en).toContain('src="../../presskit/media/01-x.jpg"');
    expect(en).toContain('What clients say');
  });
  it('hides the name unless the client allowed it', () => {
    const r = review({ displayName: 'Lisa & Tom', mayUseName: false });
    const html = renderPage({ epk: epk({ reviewIds: [r.id] }), media: [], reviews: [r], gigs: [gig({ id: 'g1', eventType: 'wedding' })], venues: [] }, 'nl', { photos: [] });
    expect(html).not.toContain('Lisa');
    expect(html).toContain('— Bruiloft');
  });
  it('plans the files, checks the budget and warns about unchecked photos', () => {
    const ok = photo();
    const face = photo({ title: 'Dansvloer', people: 'recognisable', usage: 'promo_ok' });
    const plan = planPublish({ epk: epk({ photoIds: [ok.id, face.id], en: { ...defaultEpk().en, bioLong: '' } }), media: [ok, face], reviews: [], gigs: [], venues: [] });
    expect(Object.keys(plan.pages)).toEqual(['presskit/index.html', 'en/presskit/index.html']);
    expect(plan.photos.map((p) => p.file)).toEqual(['01-knip-gala-2k25.jpg', '02-dansvloer.jpg']);
    expect(plan.warnings).toEqual(expect.arrayContaining(['usage:Dansvloer', 'consent:Dansvloer', 'en:bioLong']));
    expect(plan.htmlBytes).toBeLessThan(HTML_BUDGET);
    expect(plan.overBudget).toBe(false);
  });
  it('writes a sitemap with every page', () => {
    const s = sitemap('https://gbom2009.github.io/funqtion-site', '2026-11-08');
    expect(s).toContain('<loc>https://gbom2009.github.io/funqtion-site/</loc>');
    expect(s).toContain('<loc>https://gbom2009.github.io/funqtion-site/en/presskit/</loc>');
    expect(s.match(/<url>/g)).toHaveLength(8);
  });
});

describe('press kit PDF', () => {
  it('builds an A4 definition with bio, gigs and contact', async () => {
    const { epkPdf } = await import('./pdf');
    const d = epkPdf({ epk: epk(), media: [], reviews: [], gigs: [gig({}), gig({ eventType: 'wedding' })], venues: [] }, 'nl');
    const text = JSON.stringify(d.content);
    expect(d.pageSize).toBe('A4');
    expect(text).toContain('Team Funqtion');
    expect(text).toContain('Dorpsfeest Aarle-Rixtel');
    expect(text).toContain('+ 1 privéfeest');
    expect(text).toContain('Booking@funqtion.nl');
  });
});
