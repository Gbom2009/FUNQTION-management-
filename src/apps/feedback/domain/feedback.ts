import { answerCode, type Answer } from '../../../core/share';
import type { Consent, EventType, Gig, Lang, Review } from '../../../core/types';

// App 14 – Feedback. Pure rules for the request link, the client's answer and
// the overview. Local mode: the form is a public page of the hub; the answer
// returns as a WhatsApp/e-mail message with an FQ1 code.

/** What the client's link carries (kept small: it lives in the URL). */
export interface FeedbackRequest {
  v: 1;
  g: string;           // gig id
  n?: string;          // first name
  e: string;           // event title
  d: string;           // yyyy-mm-dd
  l: Lang;
  wa?: string;         // our WhatsApp number (digits)
  m?: string;          // our e-mail
  ig?: string;         // Instagram URL
  gr?: string;         // Google review link (only when we have one)
}

export const HIGHLIGHTS = ['full_floor', 'music_choice', 'moments', 'light_laser', 'vibe', 'contact', 'on_time', 'requests'] as const;
export type Highlight = (typeof HIGHLIGHTS)[number];
export type ScoreKey = 'music' | 'vibe' | 'communication' | 'value';
export const SCORE_KEYS: ScoreKey[] = ['music', 'vibe', 'communication', 'value'];

export interface FeedbackAnswer extends Answer {
  k: 'fb';
  r: number;                               // overall 1–5
  s: Partial<Record<ScoreKey, number>>;    // 1–5
  rec?: number;                            // 0–10 would recommend
  h: Highlight[];
  t?: string;
  pub: 'name' | 'anon' | 'no';
  name?: string;
}

export const clamp = (n: unknown, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(Number(n) || 0)));

/** Validate and tidy an answer read from a pasted message. */
export function cleanAnswer(a: Answer): FeedbackAnswer | null {
  if (a.k !== 'fb' || !a.g) return null;
  const x = a as Partial<FeedbackAnswer>;
  const s: FeedbackAnswer['s'] = {};
  for (const k of SCORE_KEYS) if (x.s?.[k]) s[k] = clamp(x.s[k], 1, 5);
  return {
    k: 'fb', g: String(a.g), at: typeof a.at === 'string' ? a.at : new Date().toISOString(), r: clamp(x.r, 1, 5), s,
    rec: x.rec == null ? undefined : clamp(x.rec, 0, 10),
    h: (Array.isArray(x.h) ? x.h : []).filter((h): h is Highlight => (HIGHLIGHTS as readonly string[]).includes(h)),
    t: typeof x.t === 'string' ? x.t.slice(0, 2000).trim() || undefined : undefined,
    pub: x.pub === 'name' || x.pub === 'anon' ? x.pub : 'no',
    name: typeof x.name === 'string' ? x.name.slice(0, 80).trim() || undefined : undefined,
  };
}

const TXT = {
  nl: { head: 'Feedback voor Team Funqtion', overall: 'Cijfer', rec: 'Aanraden', pub: { name: 'Mag gedeeld worden, met naam', anon: 'Mag gedeeld worden, zonder naam', no: 'Niet delen' }, code: 'Code voor de app (niet aanpassen):' },
  en: { head: 'Feedback for Team Funqtion', overall: 'Rating', rec: 'Recommend', pub: { name: 'May be shared, with name', anon: 'May be shared, without name', no: 'Do not share' }, code: 'Code for the app (do not edit):' },
};

/** The message the client sends: readable for us, plus the code for the hub. */
export function answerMessage(req: FeedbackRequest, a: FeedbackAnswer): string {
  const t = TXT[req.l];
  const lines = [
    `${t.head} – ${req.e}`,
    `${t.overall}: ${'★'.repeat(a.r)}${'☆'.repeat(5 - a.r)}${a.rec != null ? ` · ${t.rec}: ${a.rec}/10` : ''}`,
    a.t ? `"${a.t}"` : null,
    a.name ? `– ${a.name}` : null,
    t.pub[a.pub],
    '',
    t.code,
    answerCode(a),
  ];
  return lines.filter((x) => x !== null).join('\n');
}

export interface Applied { review: Partial<Review>; consents: Omit<Consent, 'id' | 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>[]; lowScore: boolean }

/** Turn an answer into review fields and consent records (proof of permission). */
export function applyAnswer(a: FeedbackAnswer, gig: Pick<Gig, 'id' | 'title'>, lang: Lang, personId?: string): Applied {
  const review: Partial<Review> = {
    gigId: gig.id, platform: 'website', source: 'feedback_form', receivedAt: a.at, rating: a.r, text: a.t,
    scores: { ...a.s, recommend: a.rec }, highlights: a.h, language: lang,
    mayPublish: a.pub !== 'no', mayUseName: a.pub === 'name', displayName: a.name,
  };
  const base = { gigId: gig.id, personId, subjectName: a.name || gig.title, source: 'feedback_form' as const, at: a.at, evidence: `Feedbackformulier ${a.at}` };
  const consents: Applied['consents'] = [{ ...base, purpose: 'testimonial_public', given: a.pub !== 'no', scope: 'website + perskit + Instagram' }];
  if (a.pub !== 'no') consents.push({ ...base, purpose: 'testimonial_name', given: a.pub === 'name' });
  return { review, consents, lowScore: a.r <= 3 || (a.rec != null && a.rec <= 6) };
}

/** A request is waiting when it was sent and nothing came back. */
export const waiting = (r: Review) => !!r.requestedAt && !r.receivedAt && !r.deletedAt;
export function reminderDue(r: Review, now = new Date(), days = 5) {
  return waiting(r) && new Date(r.requestedAt!).getTime() + days * 86400_000 <= now.getTime();
}

export interface Summary { count: number; avg: number; nps?: number; byType: { type: EventType; count: number; avg: number }[]; scoreAvg: Partial<Record<ScoreKey, number>>; topHighlights: { h: string; n: number }[] }

const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : 0);

export function summary(reviews: Review[], gigs: Gig[]): Summary {
  const rated = reviews.filter((r) => !r.deletedAt && r.rating);
  const gigType = new Map(gigs.map((g) => [g.id, g.eventType]));
  const types = new Map<EventType, number[]>();
  for (const r of rated) { const t = gigType.get(r.gigId); if (t) types.set(t, [...(types.get(t) ?? []), r.rating!]); }
  const recs = rated.map((r) => r.scores?.recommend).filter((x): x is number => x != null);
  const nps = recs.length ? Math.round(((recs.filter((x) => x >= 9).length - recs.filter((x) => x <= 6).length) / recs.length) * 100) : undefined;
  const scoreAvg: Summary['scoreAvg'] = {};
  for (const k of SCORE_KEYS) { const xs = rated.map((r) => r.scores?.[k]).filter((x): x is number => !!x); if (xs.length) scoreAvg[k] = avg(xs); }
  const hl = new Map<string, number>();
  for (const r of rated) for (const h of r.highlights ?? []) hl.set(h, (hl.get(h) ?? 0) + 1);
  return {
    count: rated.length, avg: avg(rated.map((r) => r.rating!)), nps,
    byType: [...types].map(([type, xs]) => ({ type, count: xs.length, avg: avg(xs) })).sort((a, b) => b.count - a.count),
    scoreAvg, topHighlights: [...hl].map(([h, n]) => ({ h, n })).sort((a, b) => b.n - a.n).slice(0, 5),
  };
}
