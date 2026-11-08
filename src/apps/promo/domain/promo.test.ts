import { describe, expect, it } from 'vitest';
import type { Consent, Gig, MediaAsset, Post, Venue } from '../../../core/types';
import { blockers, draftCaption, engagement, fullCaption, parseTags, plannedFor, postState, renderTemplate, suggestionsFor, videoBrief } from './promo';

const base = { createdAt: '', createdBy: 'gijs' as const, updatedAt: '', updatedBy: 'gijs' as const };
const gig = (p: Partial<Gig> = {}): Gig => ({
  ...base, id: 'g1', reference: 'FQ-2026-001', title: 'Dorpsfeest Aarle-Rixtel', eventType: 'village_festival', date: '2026-12-12', startTime: '20:00', endTime: '01:00',
  setupRequired: true, stage: 'confirmed', stageChangedAt: '', ownerId: 'gijs', performers: ['gijs', 'coen'], setSlots: [], contacts: [], musicWishes: [], ...p,
} as Gig);
const venue: Venue = { ...base, id: 'v1', name: 'Feesttent', city: 'Aarle-Rixtel' } as Venue;
const media = (p: Partial<MediaAsset> = {}): MediaAsset => ({ ...base, id: 'm' + Math.random(), kind: 'photo', title: 'x', mime: 'image/jpeg', tags: [], people: 'none', usage: 'promo_ok', ...p });
const post = (p: Partial<Post> = {}): Post => ({ ...base, id: 'p1', kind: 'thank_you', format: 'feed', status: 'ready', captionNl: 'Bedankt!', hashtags: [], mediaIds: [], ...p });
const consent = (p: Partial<Consent>): Consent => ({ ...base, id: 'c' + Math.random(), purpose: 'photo_promo', subjectName: 'Lisa', given: true, source: 'portal', at: '', ...p });

describe('captions', () => {
  it('fills placeholders and tidies spaces', () => {
    expect(renderTemplate('Hoi {name} , {missing}!', { name: 'Lisa' })).toBe('Hoi Lisa,!');
  });
  it('names the venue for public events', () => {
    const c = draftCaption({ gig: gig(), venue, kind: 'announcement' });
    expect(c).toContain('Dorpsfeest Aarle-Rixtel');
    expect(c).toContain('Feesttent, Aarle-Rixtel');
    expect(c).toContain('FEEL THE MUSIQ');
  });
  it('never names the client or venue for private parties', () => {
    const c = draftCaption({ gig: gig({ eventType: 'wedding', title: 'Bruiloft Lisa & Tom' }), venue, kind: 'thank_you' });
    expect(c).not.toContain('Lisa');
    expect(c).not.toContain('Feesttent');
    expect(c).toContain('PRIVÉFEEST');
  });
  it('writes English too', () => {
    expect(draftCaption({ gig: gig(), venue, kind: 'tonight', lang: 'en' })).toMatch(/^TONIGHT .* at Feesttent/);
  });
  it('normalises hashtags', () => {
    expect(parseTags('#TeamFunqtion, dj  #dj ##Brabant')).toEqual(['teamfunqtion', 'dj', 'brabant']);
    expect(fullCaption(post({ hashtags: ['dj', 'brabant'] }))).toBe('Bedankt!\n\n#dj #brabant');
  });
});

describe('suggestions and timing', () => {
  it('suggests three posts for a public confirmed gig, only the thank-you for a private one', () => {
    expect(suggestionsFor(gig(), [], [])).toEqual(['announcement', 'tonight', 'thank_you']);
    expect(suggestionsFor(gig({ eventType: 'wedding' }), [], [])).toEqual(['thank_you']);
    expect(suggestionsFor(gig({ eventType: 'wedding' }), [], [consent({ purpose: 'event_promo', gigId: 'g1' })])).toHaveLength(3);
    expect(suggestionsFor(gig({ stage: 'quote_sent' }), [], [])).toEqual([]);
    expect(suggestionsFor(gig(), [post({ gigId: 'g1', kind: 'tonight' })], [])).toEqual(['announcement', 'thank_you']);
  });
  it('plans tonight on the day and thank-you the next morning', () => {
    const t = new Date(plannedFor('tonight', gig(), { promoTonightAt: '17:00' }));
    expect([t.getDate(), t.getHours()]).toEqual([12, 17]);
    const th = new Date(plannedFor('thank_you', gig(), {}));
    expect([th.getDate(), th.getHours()]).toEqual([13, 11]);
  });
  it('is due only when ready and the reminder time has passed', () => {
    const now = new Date('2026-12-12T18:00:00');
    expect(postState(post({ plannedAt: '2026-12-12T17:00:00' }), now)).toBe('due');
    expect(postState(post({ plannedAt: '2026-12-12T19:00:00' }), now)).toBe('ready');
    expect(postState(post({ status: 'draft', plannedAt: '2026-12-12T17:00:00' }), now)).toBe('draft');
  });
});

describe('blockers', () => {
  const ok = media();
  it('passes a clean post', () => {
    expect(blockers({ post: post({ mediaIds: [ok.id] }), gig: gig(), media: [ok], consents: [] })).toEqual([]);
  });
  it('needs media and a caption', () => {
    expect(blockers({ post: post({ captionNl: ' ' }), media: [], consents: [] })).toEqual(['no_media', 'caption_empty']);
  });
  it('checks Instagram limits', () => {
    const many = Array.from({ length: 11 }, () => media());
    const b = blockers({ post: post({ format: 'carousel', mediaIds: many.map((m) => m.id), hashtags: Array.from({ length: 31 }, (_, i) => 't' + i), captionNl: 'x'.repeat(2300) }), media: many, consents: [] });
    expect(b).toEqual(expect.arrayContaining(['carousel_size', 'too_many_tags', 'caption_too_long']));
    expect(blockers({ post: post({ format: 'reel', mediaIds: [ok.id] }), media: [ok], consents: [] })).toContain('reel_needs_video');
  });
  it('blocks announcements of private parties without consent', () => {
    const g = gig({ eventType: 'private_party' });
    expect(blockers({ post: post({ kind: 'announcement', mediaIds: [ok.id] }), gig: g, media: [ok], consents: [] })).toContain('private_no_consent');
  });
  it('respects the photo opt-out from the contract and portrait rights', () => {
    const face = media({ gigId: 'g1', people: 'recognisable' });
    const crowd = media({ gigId: 'g1', people: 'crowd_unrecognisable' });
    expect(blockers({ post: post({ mediaIds: [crowd.id] }), gig: gig(), media: [crowd], consents: [], photoOptOut: true })).toContain('photo_opt_out');
    expect(blockers({ post: post({ mediaIds: [face.id] }), gig: gig(), media: [face], consents: [] })).toContain('recognisable_no_consent');
    expect(blockers({ post: post({ mediaIds: [face.id] }), gig: gig(), media: [face], consents: [consent({ gigId: 'g1' })] })).toEqual([]);
    expect(blockers({ post: post({ mediaIds: [face.id] }), gig: gig(), media: [face], consents: [consent({ gigId: 'g1', withdrawnAt: 'x' })] })).toContain('recognisable_no_consent');
    expect(blockers({ post: post({ mediaIds: [ok.id] }), media: [{ ...ok, usage: 'internal' }], consents: [] })).toContain('internal_media');
  });
});

describe('stats and briefs', () => {
  it('averages the latest stats and picks the best post', () => {
    const a = post({ id: 'a', status: 'published', stats: [{ at: '1', reach: 100, likes: 10 }, { at: '2', reach: 300, likes: 30 }] });
    const b = post({ id: 'b', status: 'published', stats: [{ at: '1', reach: 100, likes: 5, saves: 20 }] });
    const e = engagement([a, b, post()]);
    expect(e).toMatchObject({ posts: 2, avgReach: 200, avgLikes: 18 });
    expect(e.best?.id).toBe('b');
  });
  it('builds a video brief without private details', () => {
    const m = media({ photographer: 'Coen' });
    const b = videoBrief(post({ format: 'reel', mediaIds: [m.id] }), gig({ eventType: 'wedding', title: 'Bruiloft Lisa' }), venue, [m], {}, 'hyperframes', 'thank_you');
    expect(b.format).toMatchObject({ width: 1080, height: 1920 });
    expect(b.gig).toMatchObject({ title: 'privéfeest', private: true, venue: undefined });
    expect(b.media[0]).toMatchObject({ kind: 'photo', credit: 'Coen' });
    expect(b.instructions).toContain('#f68712');
  });
});
