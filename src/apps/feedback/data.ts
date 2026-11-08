import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../core/db';
import { alive, nowIso, patch, save } from '../../core/repo';
import { publicLink, readAnswers } from '../../core/share';
import type { Consent, Gig, Review, Settings, Task } from '../../core/types';
import { DEFAULT_BRAND } from '../../core/types';
import { mailtoLink, toWhatsAppNumber, whatsAppLink } from '../bookings/domain/messaging';
import { logInteraction } from '../bookings/data';
import { applyAnswer, cleanAnswer, type FeedbackRequest } from './domain/feedback';

const EMPTY: never[] = [];
export const useReviews = () => alive(useLiveQuery(() => db.reviews.toArray(), []) ?? EMPTY) as Review[];

async function settings(): Promise<Partial<Settings>> { return (await db.settings.get('settings')) ?? {}; }

export function instagramUrl(s: Partial<Settings>) {
  return `https://www.instagram.com/${(s.brand?.instagram ?? DEFAULT_BRAND.instagram).replace(/^@/, '')}/`;
}

/** The link for one gig's feedback form (everything the page needs is inside it). */
export async function feedbackLink(gig: Gig): Promise<{ link: string; req: FeedbackRequest }> {
  const s = await settings();
  const client = gig.clientPersonId ? await db.persons.get(gig.clientPersonId) : undefined;
  const wa = s.answerWhatsApp || s.bizPhone;
  const req: FeedbackRequest = {
    v: 1, g: gig.id, n: client?.firstName, e: gig.title, d: gig.date, l: client?.language ?? s.language ?? 'nl',
    wa: wa ? toWhatsAppNumber(wa) : undefined, m: s.bizEmail || 'Booking@funqtion.nl', ig: instagramUrl(s), gr: s.reviewLink || undefined,
  };
  return { link: publicLink(s.publicAppUrl, 'f', req), req };
}

/** Message to the client with the link; marks the request as sent. */
export async function requestFeedback(gig: Gig, sender: string): Promise<{ text: string; whatsapp: string; mail: string; link: string }> {
  const { link, req } = await feedbackLink(gig);
  const client = gig.clientPersonId ? await db.persons.get(gig.clientPersonId) : undefined;
  const nl = req.l === 'nl';
  const text = nl
    ? `Hoi ${req.n ?? ''},\n\nBedankt dat we ${gig.title} mochten draaien! Wil je ons in een minuutje laten weten hoe je het vond? Dat helpt ons echt:\n${link}\n\nGroet,\n${sender} – Team Funqtion\nFEEL THE MUSIQ`
    : `Hi ${req.n ?? ''},\n\nThanks for having us at ${gig.title}! Would you tell us in a minute how you liked it? It really helps us:\n${link}\n\nCheers,\n${sender} – Team Funqtion\nFEEL THE MUSIQ`;
  const existing = (await db.reviews.where('gigId').equals(gig.id).toArray()).filter((r) => !r.deletedAt);
  const open = existing.find((r) => !r.receivedAt);
  if (open) await patch<Review>('reviews', open.id, { requestedAt: open.requestedAt ?? nowIso() });
  else if (!existing.length) await save<Review>('reviews', { gigId: gig.id, requestedAt: nowIso() });
  return {
    text, link,
    whatsapp: whatsAppLink(client?.whatsapp || client?.phone, text),
    mail: mailtoLink(client?.email, nl ? `Hoe was ${gig.title}?` : `How was ${gig.title}?`, text),
  };
}

export interface ImportResult { imported: number; updated: number; unknownGig: number; lowScores: string[] }

/** "Plak antwoord": read FQ1 feedback codes from pasted text. */
export async function importFeedback(text: string, me: 'gijs' | 'coen'): Promise<ImportResult> {
  const res: ImportResult = { imported: 0, updated: 0, unknownGig: 0, lowScores: [] };
  for (const raw of readAnswers(text)) {
    const a = cleanAnswer(raw);
    if (!a) continue;
    const gig = await db.gigs.get(a.g);
    if (!gig || gig.deletedAt) { res.unknownGig++; continue; }
    const client = gig.clientPersonId ? await db.persons.get(gig.clientPersonId) : undefined;
    const applied = applyAnswer(a, gig, client?.language ?? 'nl', client?.id);
    const rows = (await db.reviews.where('gigId').equals(gig.id).toArray()).filter((r) => !r.deletedAt);
    const same = rows.find((r) => r.receivedAt === a.at);
    if (same) continue; // pasted twice
    const target = rows.find((r) => !r.receivedAt);
    if (target) { await patch<Review>('reviews', target.id, applied.review); res.updated++; }
    else { await save<Review>('reviews', { ...applied.review, gigId: gig.id } as Review); res.imported++; }
    for (const c of applied.consents) await save<Consent>('consents', c);
    await logInteraction({ at: a.at, channel: 'note', direction: 'in', gigId: gig.id, personId: client?.id, summary: `Feedback ${a.r}/5${a.t ? `: ${a.t.slice(0, 120)}` : ''}` });
    if (applied.lowScore) {
      res.lowScores.push(gig.title);
      await save<Task>('tasks', { title: `Bel even na: feedback ${a.r}/5 voor ${gig.title}`, kind: 'custom', dueAt: nowIso(), assignedTo: me, gigId: gig.id, personId: client?.id, status: 'open' });
    }
  }
  return res;
}

/** Add a review that arrived elsewhere (Google, Instagram DM, in person). */
export async function addManualReview(r: Partial<Review> & { gigId: string }) {
  return save<Review>('reviews', { source: 'manual', receivedAt: nowIso(), ...r } as Review);
}
