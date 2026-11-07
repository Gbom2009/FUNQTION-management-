import type { Gig, GigDay, GigLog, Invoice, MemberId, Review, Trip, Venue } from '../../../core/types';

// What the next-morning wrap-up proposes, per app. Pure: the page turns each
// proposal into a one-tap action.

export type WrapKey = 'played' | 'trips' | 'invoice' | 'thanks' | 'gear' | 'venue' | 'summary';

export interface WrapItem {
  key: WrapKey;
  state: 'todo' | 'done' | 'na';
  /** for trips: km per driver (one way, round trip) */
  trips?: { driver: MemberId; km: number; roundTrip: boolean; source: 'nav' | 'venue' | 'manual' }[];
  detail?: string;
}

export interface WrapInput {
  gig: Gig;
  day?: GigDay;
  venue?: Venue;
  trips: Trip[];
  invoices: Invoice[];
  reviews: Review[];
  logs: GigLog[];
  openGearIssues: number;
  venueNotesToday: number;
  hasAcceptedQuote: boolean;
  today: string;
}

const PLAYED: Gig['stage'][] = ['played', 'invoiced', 'paid'];

export function wrapUpItems(i: WrapInput): WrapItem[] {
  const items: WrapItem[] = [];
  const done = (k: WrapKey) => !!i.day?.wrapUp?.[k];

  // App 1: played (only on/after the date)
  items.push({ key: 'played', state: PLAYED.includes(i.gig.stage) || done('played') ? 'done' : i.gig.date <= i.today ? 'todo' : 'na' });

  // App 3: trips. Nav trips (Maps) count as done; otherwise propose the venue distance per driver, round trip.
  const mine = i.trips.filter((t) => !t.deletedAt && t.gigId === i.gig.id);
  const drivers = i.day?.drivers?.length ? i.day.drivers : [i.gig.ownerId];
  if (mine.length || done('trips')) items.push({ key: 'trips', state: 'done', detail: `${mine.reduce((s, t) => s + t.km * (t.roundTrip ? 2 : 1), 0)} km` });
  else {
    const proposals = drivers.map((d) => ({ driver: d, km: i.venue?.distanceKm?.[d] ?? 0, roundTrip: true, source: (i.venue?.distanceKm?.[d] ? 'venue' : 'manual') as 'venue' | 'manual' }));
    items.push({ key: 'trips', state: 'todo', trips: proposals });
  }

  // App 2: final invoice (+ overtime line)
  const final = i.invoices.find((v) => !v.deletedAt && v.gigId === i.gig.id && (v.kind === 'final' || v.kind === 'standard') && v.status !== 'credited');
  items.push({ key: 'invoice', state: final || done('invoice') ? 'done' : i.hasAcceptedQuote ? 'todo' : 'na' });

  // Client: thank-you + review request
  const asked = i.reviews.some((r) => !r.deletedAt && r.gigId === i.gig.id && r.requestedAt);
  items.push({ key: 'thanks', state: asked || done('thanks') ? 'done' : 'todo' });

  // App 5: open issues from this gig
  items.push({ key: 'gear', state: i.openGearIssues ? 'todo' : 'done', detail: String(i.openGearIssues) });

  // Venue: confirm what was added on the day
  items.push({ key: 'venue', state: i.venueNotesToday ? (done('venue') ? 'done' : 'todo') : 'na', detail: String(i.venueNotesToday) });

  // The log summary is always there to read
  items.push({ key: 'summary', state: done('summary') ? 'done' : 'todo', detail: String(i.logs.length) });
  return items;
}

export const openCount = (items: WrapItem[]) => items.filter((x) => x.state === 'todo').length;
