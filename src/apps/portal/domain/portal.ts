import { addDays, at, toDateStr } from '../../../core/dates';
import type { Answer } from '../../../core/share';
import { answerCode } from '../../../core/share';
import type { EventType, Gig, Lang, MusicWish, Portal, PortalSection, Stage, TimelineStep, Venue, WishKind } from '../../../core/types';

// App 13 – Client Portal, local mode (plan §0.1, §6). The client's page is a
// link with a snapshot of *only* what the client must see. No prices, no
// internal notes, no other clients. Answers come back as an FQ1 code.

export interface DocLine { k: 'quote' | 'contract' | 'deposit' | 'invoice' | 'final'; no?: string; st: string; amt?: number; due?: string }
export interface Snapshot {
  v: 1;
  g: string;                 // gig id
  l: Lang;
  n?: string;                // client's first name
  e: string;                 // event title
  d: string;                 // yyyy-mm-dd
  s: string; f: string;      // start, end HH:mm
  st: Stage;
  et: EventType;
  ven?: { n: string; a?: string; c?: string };
  w?: string;                // welcome text
  sec: PortalSection[];
  tl?: [string, string][];   // [HH:mm, label]
  us?: [string, string][];   // [name, phone]
  co?: [string, string, string?][]; // [name, role, phone]
  wi?: [WishKind, string, string?][]; // existing wishes: [kind, text, at]
  lock?: string;             // wishes locked from this date
  docs?: DocLine[];
  pl?: string[];             // played list (after the gig)
  ph?: string;               // photo album link
  sp?: string;               // playlist link
  wa?: string; m?: string;   // where answers go
  at: string;                // snapshot time
}

/** Steps a client cares about; our travel/pick-up steps stay internal. */
const CLIENT_STEPS = new Set(['arrive', 'setup', 'soundcheck', 'doors', 'set_start', 'set_end', 'moment', 'curfew', 'breakdown']);

const hm = (iso: string) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

export function lockDate(gig: Pick<Gig, 'date'>, lockDays: number) {
  return toDateStr(addDays(at(gig.date, '12:00'), -lockDays));
}

export interface SnapshotInput {
  gig: Gig; portal: Portal; lang: Lang; clientFirstName?: string; venue?: Venue;
  steps: TimelineStep[]; members: { name: string; phone?: string }[]; contacts: { name: string; role: string; phone?: string }[];
  docs: DocLine[]; answerWa?: string; answerMail?: string; now?: Date;
}

export function buildSnapshot(i: SnapshotInput): Snapshot {
  const { gig, portal } = i;
  const on = (s: PortalSection) => portal.sections.includes(s);
  const played = (portal.playedList ?? '').split('\n').map((x) => x.trim()).filter(Boolean);
  const after = on('after') && ['played', 'invoiced', 'paid'].includes(gig.stage);
  return {
    v: 1, g: gig.id, l: i.lang, n: i.clientFirstName, e: gig.title, d: gig.date, s: gig.startTime, f: gig.endTime, st: gig.stage, et: gig.eventType,
    ven: i.venue ? { n: i.venue.name, a: [i.venue.street, i.venue.postcode].filter(Boolean).join(', ') || undefined, c: i.venue.city } : undefined,
    w: portal.welcome?.trim() || undefined,
    sec: portal.sections,
    tl: on('timeline') ? i.steps.filter((s) => !s.deletedAt && CLIENT_STEPS.has(s.kind)).sort((a, b) => a.plannedAt.localeCompare(b.plannedAt)).map((s) => [hm(s.plannedAt), s.label] as [string, string]) : undefined,
    us: on('contacts') ? i.members.filter((m) => m.phone).map((m) => [m.name, m.phone!] as [string, string]) : undefined,
    co: on('contacts') ? i.contacts.map((c) => [c.name, c.role, c.phone] as [string, string, string?]) : undefined,
    wi: on('wishes') ? gig.musicWishes.map((w) => [w.kind, w.track || w.text, w.at] as [WishKind, string, string?]) : undefined,
    lock: on('wishes') ? lockDate(gig, portal.lockDays) : undefined,
    docs: on('documents') ? i.docs : undefined,
    pl: after && portal.showPlayed !== 'none' ? (portal.showPlayed === 'top20' ? played.slice(0, 20) : played) : undefined,
    ph: after ? portal.photosUrl || undefined : undefined,
    sp: after ? portal.playlistUrl || undefined : undefined,
    wa: i.answerWa, m: i.answerMail,
    at: (i.now ?? new Date()).toISOString(),
  };
}

// ---- The client's answer --------------------------------------------------

export interface WishesAnswer extends Answer {
  k: 'wishes';
  w: [WishKind, string, string?][];          // new wishes: kind, text (artist – title), time
  c?: [string, string, string?][];          // extra contacts: name, role, phone
  ok?: { photo?: boolean; event?: boolean }; // consents ticked in the portal
  note?: string;
}

const KINDS: WishKind[] = ['genre', 'must_play', 'do_not_play', 'special_moment'];

export function cleanWishes(a: Answer): WishesAnswer | null {
  if (a.k !== 'wishes' || !a.g) return null;
  const x = a as Partial<WishesAnswer>;
  const w = (Array.isArray(x.w) ? x.w : []).filter((r) => Array.isArray(r) && KINDS.includes(r[0]) && typeof r[1] === 'string' && r[1].trim())
    .slice(0, 100).map((r) => {
      const text = r[1].trim().slice(0, 200);
      return (typeof r[2] === 'string' && /^\d{1,2}:\d{2}$/.test(r[2]) ? [r[0], text, r[2]] : [r[0], text]) as [WishKind, string, string?];
    });
  const c = (Array.isArray(x.c) ? x.c : []).filter((r) => Array.isArray(r) && typeof r[0] === 'string' && r[0].trim()).slice(0, 10)
    .map((r) => [r[0].trim().slice(0, 80), String(r[1] ?? '').slice(0, 60), typeof r[2] === 'string' ? r[2].slice(0, 30) : undefined] as [string, string, string?]);
  return {
    k: 'wishes', g: String(a.g), at: typeof a.at === 'string' ? a.at : new Date().toISOString(), w, c,
    ok: x.ok ? { photo: x.ok.photo === true ? true : x.ok.photo === false ? false : undefined, event: x.ok.event === true ? true : x.ok.event === false ? false : undefined } : undefined,
    note: typeof x.note === 'string' ? x.note.slice(0, 1000).trim() || undefined : undefined,
  };
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();

/** Add the client's wishes to the gig: no duplicates, marked as from the client. */
export function mergeWishes(existing: MusicWish[], incoming: WishesAnswer['w'], id: () => string, at: string): { wishes: MusicWish[]; added: number } {
  const seen = new Set(existing.map((w) => `${w.kind}|${norm(w.track || w.text)}`));
  const out = [...existing];
  let added = 0;
  for (const [kind, text, time] of incoming) {
    const key = `${kind}|${norm(text)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const isTrack = kind === 'must_play' || kind === 'do_not_play' || kind === 'special_moment';
    out.push({ id: id(), kind, text, track: isTrack && text.includes('–') ? text : undefined, at: time, by: 'client', addedAt: at });
    added++;
  }
  return { wishes: out, added };
}

/** Wishes that arrive after the lock date still count, but we want to know. */
export const afterLock = (answerAt: string, lock?: string) => !!lock && answerAt.slice(0, 10) > lock;

const TXT = {
  nl: { head: 'Wensen voor Team Funqtion', wishes: (n: number) => `${n} nieuwe muziekwens${n === 1 ? '' : 'en'}`, contacts: (n: number) => `${n} contactperso${n === 1 ? 'on' : 'nen'}`, code: 'Code voor de app (niet aanpassen):' },
  en: { head: 'Wishes for Team Funqtion', wishes: (n: number) => `${n} new music wish${n === 1 ? '' : 'es'}`, contacts: (n: number) => `${n} contact${n === 1 ? '' : 's'}`, code: 'Code for the app (do not edit):' },
};
const LABEL: Record<Lang, Record<WishKind, string>> = {
  nl: { genre: 'Genre', must_play: 'Moet', do_not_play: 'Liever niet', special_moment: 'Moment' },
  en: { genre: 'Genre', must_play: 'Must play', do_not_play: 'Do not play', special_moment: 'Moment' },
};

export function wishesMessage(snap: Pick<Snapshot, 'e' | 'l'>, a: WishesAnswer): string {
  const t = TXT[snap.l];
  return [
    `${t.head} – ${snap.e}`,
    a.w.length ? t.wishes(a.w.length) + ':' : null,
    ...a.w.map(([k, x, time]) => `• ${LABEL[snap.l][k]}: ${x}${time ? ` (${time})` : ''}`),
    a.c?.length ? t.contacts(a.c.length) + ': ' + a.c.map((c) => `${c[0]} (${c[1]}${c[2] ? `, ${c[2]}` : ''})`).join(', ') : null,
    a.note ? `"${a.note}"` : null,
    '',
    t.code,
    answerCode(a),
  ].filter((x) => x !== null).join('\n');
}
