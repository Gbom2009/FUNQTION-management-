import { addDays, at, toDateStr } from '../../../core/dates';
import {
  DEFAULT_BRAND, type BrandKit, type Consent, type EventType, type Gig, type MediaAsset, type Post, type PostFormat, type PostKind, type Settings, type Venue,
} from '../../../core/types';

// App 11 – Promo. Pure rules: caption drafts, checks before posting, the
// reminder calendar. Nothing here ever publishes: a person confirms every post
// (docs/stage-and-clients/PLAN.md §0.4).

/** Event types where the client's party is private: no public announcement without their OK. */
export const PRIVATE_EVENTS: EventType[] = ['wedding', 'private_party', 'company'];
export const isPrivateEvent = (t: EventType) => PRIVATE_EVENTS.includes(t);

export const CAPTION_MAX = 2200;   // Instagram caption limit
export const HASHTAG_MAX = 30;     // Instagram hashtag limit
export const CAROUSEL_MAX = 10;

export function brandOf(s?: Partial<Settings>): BrandKit {
  return { ...DEFAULT_BRAND, ...(s?.brand ?? {}) };
}

export function normaliseTag(tag: string): string {
  return tag.trim().replace(/^#+/, '').replace(/\s+/g, '').toLowerCase();
}
export function parseTags(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[\s,]+/)) {
    const t = normaliseTag(raw);
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/** Fill {placeholders}; unknown or empty values disappear with their surrounding spaces tidied. */
export function renderTemplate(tpl: string, vars: Record<string, string | undefined>): string {
  return tpl
    .replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '')
    .replace(/[ \t]+([,.!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +\n/g, '\n')
    .trim();
}

const TEMPLATES: Record<Exclude<PostKind, 'other' | 'throwback' | 'mix_release'>, { nl: string; en: string; format: PostFormat }> = {
  announcement: {
    nl: '📣 {date}: wij staan op {eventName}{atVenue}! Zien we jou daar?\n\n{tagline}\n{footer}',
    en: '📣 {date}: we play {eventName}{atVenueEn}! See you there?\n\n{tagline}\n{footer}',
    format: 'feed',
  },
  tonight: {
    nl: 'TONIGHT 🔊 {eventName}{atVenue}. Vanaf {time} draaien wij. {tagline}',
    en: 'TONIGHT 🔊 {eventName}{atVenueEn}. We play from {time}. {tagline}',
    format: 'story',
  },
  thank_you: {
    nl: 'BEDANKT {eventNameUpper}! 🧡 Wat een avond{inCity}. Tot de volgende keer.\n\n{tagline}',
    en: 'THANK YOU {eventNameUpper}! 🧡 What a night{inCityEn}. See you next time.\n\n{tagline}',
    format: 'carousel',
  },
};

export interface DraftInput { gig: Gig; venue?: Venue; settings?: Partial<Settings>; kind: PostKind; lang?: 'nl' | 'en' }

export function captionVars(gig: Gig, venue: Venue | undefined, brand: BrandKit, lang: 'nl' | 'en') {
  const date = new Date(gig.date + 'T12:00:00').toLocaleDateString(lang === 'nl' ? 'nl-NL' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  // Private parties never show the venue or client name in public posts.
  const priv = isPrivateEvent(gig.eventType);
  const eventName = priv ? (lang === 'nl' ? 'een privéfeest' : 'a private party') : gig.title;
  const v = !priv && venue ? venue.name + (venue.city ? `, ${venue.city}` : '') : '';
  const city = venue?.city ?? '';
  return {
    date, time: gig.startTime, eventName, eventNameUpper: eventName.toUpperCase(),
    atVenue: v ? ` in ${v}` : '', atVenueEn: v ? ` at ${v}` : '',
    inCity: city ? ` in ${city}` : '', inCityEn: city ? ` in ${city}` : '',
    tagline: brand.tagline, city, venue: v, footer: lang === 'nl' ? brand.captionFooterNl : brand.captionFooterEn,
  };
}

export function draftCaption({ gig, venue, settings, kind, lang = 'nl' }: DraftInput): string {
  const brand = brandOf(settings);
  const tpl = TEMPLATES[kind as keyof typeof TEMPLATES];
  if (!tpl) return '';
  return renderTemplate(tpl[lang], captionVars(gig, venue, brand, lang));
}

export function defaultFormat(kind: PostKind): PostFormat {
  return TEMPLATES[kind as keyof typeof TEMPLATES]?.format ?? 'feed';
}

/** When the reminder for a generated post should appear. */
export function plannedFor(kind: PostKind, gig: Gig, settings?: Partial<Settings>, now = new Date()): string {
  if (kind === 'tonight') return at(gig.date, settings?.promoTonightAt || '12:00').toISOString();
  if (kind === 'thank_you') return at(toDateStr(addDays(at(gig.date, '12:00'), 1)), settings?.promoThanksAt || '11:00').toISOString();
  if (kind === 'announcement') {
    const twoWeeks = at(toDateStr(addDays(at(gig.date, '12:00'), -14)), '19:00');
    return (twoWeeks > now ? twoWeeks : new Date(now.getTime() + 3600_000)).toISOString();
  }
  return new Date(now.getTime() + 3600_000).toISOString();
}

export function hasConsent(consents: Consent[], purpose: Consent['purpose'], gigId?: string) {
  return consents.some((c) => !c.deletedAt && c.purpose === purpose && c.given && !c.withdrawnAt && (!gigId || c.gigId === gigId));
}

/** Which posts the calendar suggests for a confirmed gig. */
export function suggestionsFor(gig: Gig, existing: Post[], consents: Consent[]): PostKind[] {
  if (!['confirmed', 'played', 'invoiced', 'paid'].includes(gig.stage)) return [];
  const mine = existing.filter((p) => p.gigId === gig.id && !p.deletedAt);
  const has = (k: PostKind) => mine.some((p) => p.kind === k);
  const publicOk = !isPrivateEvent(gig.eventType) || hasConsent(consents, 'event_promo', gig.id);
  const out: PostKind[] = [];
  if (publicOk && !has('announcement')) out.push('announcement');
  if (publicOk && !has('tonight')) out.push('tonight');
  if (!has('thank_you')) out.push('thank_you');
  return out;
}

export type Blocker =
  | 'no_media' | 'caption_empty' | 'caption_too_long' | 'too_many_tags' | 'carousel_size' | 'reel_needs_video'
  | 'private_no_consent' | 'photo_opt_out' | 'recognisable_no_consent' | 'internal_media';

export interface CheckInput { post: Post; gig?: Gig; media: MediaAsset[]; consents: Consent[]; photoOptOut?: boolean }

/** Reasons the post may not go out yet. Shown before "Gepost" can be pressed. */
export function blockers({ post, gig, media, consents, photoOptOut }: CheckInput): Blocker[] {
  const out: Blocker[] = [];
  const items = post.mediaIds.map((id) => media.find((m) => m.id === id)).filter((m): m is MediaAsset => !!m && !m.deletedAt);
  if (!items.length) out.push('no_media');
  if (!post.captionNl.trim()) out.push('caption_empty');
  const full = fullCaption(post, 'nl');
  if (full.length > CAPTION_MAX) out.push('caption_too_long');
  if (post.hashtags.length > HASHTAG_MAX) out.push('too_many_tags');
  if (post.format === 'carousel' && (items.length < 2 || items.length > CAROUSEL_MAX)) out.push('carousel_size');
  if (post.format === 'reel' && !items.some((m) => m.kind === 'video')) out.push('reel_needs_video');
  if (gig && isPrivateEvent(gig.eventType) && (post.kind === 'announcement' || post.kind === 'tonight') && !hasConsent(consents, 'event_promo', gig.id)) out.push('private_no_consent');
  if (items.some((m) => m.usage === 'internal')) out.push('internal_media');
  // Photo opt-out at contract signing: no people from that gig, at all.
  const fromGig = (m: MediaAsset) => !!gig && m.gigId === gig.id;
  if (photoOptOut && items.some((m) => fromGig(m) && m.people !== 'none')) out.push('photo_opt_out');
  const recognisable = items.filter((m) => m.people === 'recognisable');
  const covered = (m: MediaAsset) => (m.consentIds ?? []).some((id) => consents.some((c) => c.id === id && c.given && !c.withdrawnAt && !c.deletedAt))
    || (!!m.gigId && hasConsent(consents, 'photo_promo', m.gigId));
  if (recognisable.some((m) => !covered(m))) out.push('recognisable_no_consent');
  return [...new Set(out)];
}

export function fullCaption(post: Pick<Post, 'captionNl' | 'captionEn' | 'hashtags'>, lang: 'nl' | 'en' | 'both' = 'nl'): string {
  const text = lang === 'en' ? post.captionEn || post.captionNl : lang === 'both' && post.captionEn ? `${post.captionNl}\n\n🇬🇧 ${post.captionEn}` : post.captionNl;
  const tags = post.hashtags.map((t) => `#${t}`).join(' ');
  return tags ? `${text.trim()}\n\n${tags}` : text.trim();
}

export type PostState = 'idea' | 'draft' | 'ready' | 'due' | 'published' | 'skipped';
/** "due" is derived: ready and the reminder time has passed. */
export function postState(p: Post, now = new Date()): PostState {
  if (p.status === 'ready' && p.plannedAt && new Date(p.plannedAt) <= now) return 'due';
  return p.status;
}

export interface Engagement { posts: number; avgReach: number; avgLikes: number; best?: Post }
export function engagement(posts: Post[]): Engagement {
  const pub = posts.filter((p) => p.status === 'published' && p.stats?.length);
  const last = (p: Post) => p.stats![p.stats!.length - 1];
  const sum = (f: (p: Post) => number) => pub.reduce((s, p) => s + f(p), 0);
  const score = (p: Post) => (last(p).likes ?? 0) + 2 * (last(p).comments ?? 0) + 3 * (last(p).saves ?? 0) + 3 * (last(p).shares ?? 0);
  return {
    posts: pub.length,
    avgReach: pub.length ? Math.round(sum((p) => last(p).reach ?? 0) / pub.length) : 0,
    avgLikes: pub.length ? Math.round(sum((p) => last(p).likes ?? 0) / pub.length) : 0,
    best: pub.slice().sort((a, b) => score(b) - score(a))[0],
  };
}

export interface VideoBrief {
  tool: 'hyperframes' | 'remotion';
  template: string;
  format: { name: PostFormat; width: number; height: number; fps: number; seconds: number };
  brand: BrandKit & { logoFile: string };
  gig?: { title: string; date: string; startTime: string; eventType: EventType; city?: string; venue?: string; private: boolean };
  caption: string;
  media: { file: string; kind: string; credit?: string }[];
  instructions: string;
}

const SIZES: Record<PostFormat, [number, number]> = { feed: [1080, 1350], carousel: [1080, 1350], reel: [1080, 1920], story: [1080, 1920] };

/** The brief you hand to Claude Code with the HyperFrames plugin or Remotion skills. */
export function videoBrief(post: Post, gig: Gig | undefined, venue: Venue | undefined, media: MediaAsset[], settings: Partial<Settings> | undefined, tool: VideoBrief['tool'], template: string): VideoBrief {
  const brand = brandOf(settings);
  const [width, height] = SIZES[post.format];
  const priv = gig ? isPrivateEvent(gig.eventType) : false;
  const items = post.mediaIds.map((id) => media.find((m) => m.id === id)).filter((m): m is MediaAsset => !!m);
  return {
    tool, template,
    format: { name: post.format, width, height, fps: 30, seconds: post.format === 'story' ? 10 : 15 },
    brand: { ...brand, logoFile: 'logo.png' },
    gig: gig && { title: priv ? 'privéfeest' : gig.title, date: gig.date, startTime: gig.startTime, eventType: gig.eventType, city: venue?.city, venue: priv ? undefined : venue?.name, private: priv },
    caption: fullCaption(post, 'nl'),
    media: items.map((m, i) => ({ file: `media/${String(i + 1).padStart(2, '0')}-${m.id.slice(0, 6)}.${(m.mime.split('/')[1] ?? 'bin').replace('jpeg', 'jpg')}`, kind: m.kind, credit: m.photographer })),
    instructions: [
      `Maak een ${post.format} van ${width}x${height} (${template}) in de Funqtion-stijl: zwarte achtergrond ${brand.colours[0]}, oranje accent ${brand.colours[1]}, fonts ${brand.fonts.join(' + ')}, geen afgeronde hoeken.`,
      `Eindig met het logo en "${brand.tagline}".`,
      priv ? 'Privéfeest: noem geen locatie of namen in beeld.' : '',
      'Gebruik alleen de meegeleverde media. Geen muziek van derden in de export, tenzij die van ons is of gelicenseerd.',
    ].filter(Boolean).join(' '),
  };
}
