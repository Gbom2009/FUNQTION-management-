import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../core/db';
import { alive, nowIso, save, uid } from '../../core/repo';
import { addDays, toDateStr } from '../../core/dates';
import type {
  AvailabilityBlock, Enquiry, Gig, Interaction, MemberId, Organisation, Person, Quote, Stage, StatusChange, Task, Venue,
} from '../../core/types';
import { nextReference, stageStamps } from './domain/pipeline';
import { runTaskSync } from './domain/taskSync';

const EMPTY: never[] = [];

export const useGigs = () => alive(useLiveQuery(() => db.gigs.toArray(), []) ?? EMPTY) as Gig[];
export const usePersons = () => alive(useLiveQuery(() => db.persons.toArray(), []) ?? EMPTY) as Person[];
export const useOrgs = () => alive(useLiveQuery(() => db.organisations.toArray(), []) ?? EMPTY) as Organisation[];
export const useVenues = () => alive(useLiveQuery(() => db.venues.toArray(), []) ?? EMPTY) as Venue[];
export const useEnquiries = () => alive(useLiveQuery(() => db.enquiries.toArray(), []) ?? EMPTY) as Enquiry[];
export const useBlocks = () => alive(useLiveQuery(() => db.availability.toArray(), []) ?? EMPTY) as AvailabilityBlock[];
export const useTasks = () => alive(useLiveQuery(() => db.tasks.toArray(), []) ?? EMPTY) as Task[];
export const useQuotes = (gigId?: string) =>
  alive(useLiveQuery(() => (gigId ? db.quotes.where('gigId').equals(gigId).toArray() : db.quotes.toArray()), [gigId]) ?? EMPTY) as Quote[];

export function byId<T extends { id: string }>(rows: T[]) {
  return new Map(rows.map((r) => [r.id, r]));
}

export function blankGig(owner: MemberId, p: Partial<Gig> = {}): Omit<Gig, 'id' | 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'> & { id?: string } {
  return {
    reference: '', title: '', eventType: 'wedding', date: '', startTime: '20:00', endTime: '00:00', setupRequired: true,
    stage: 'enquiry', stageChangedAt: nowIso(), ownerId: owner, performers: ['gijs', 'coen'], setSlots: [], contacts: [],
    musicWishes: [], setting: '', ...p,
  };
}

/** Create a gig with a fresh FQ-YYYY-NNN reference and an initial status entry. */
export async function createGig(g: ReturnType<typeof blankGig>): Promise<Gig> {
  const all = await db.gigs.toArray();
  const year = g.date ? Number(g.date.slice(0, 4)) : new Date().getFullYear();
  const saved = await save<Gig>('gigs', { ...g, reference: g.reference || nextReference(all, year) });
  await save<StatusChange>('statusChanges', { gigId: saved.id, from: null, to: saved.stage });
  runTaskSync();
  return saved;
}

export interface StageChangeInput {
  to: Stage;
  reason?: string;
  note?: string;
  extra?: Partial<Gig>;
}

export async function changeStage(gig: Gig, input: StageChangeInput) {
  const now = nowIso();
  const extra: Partial<Gig> = { ...stageStamps(input.to, now), ...input.extra };
  if (input.to === 'lost') { extra.lostReason = input.reason as Gig['lostReason']; extra.lostNote = input.note; }
  if (input.to === 'option' && !gig.optionExpiresAt && !extra.optionExpiresAt) {
    const s = await db.settings.get('settings');
    extra.optionExpiresAt = toDateStr(addDays(new Date(), s?.optionDays ?? 14));
  }
  await save<Gig>('gigs', { ...gig, ...extra, stage: input.to, stageChangedAt: now });
  await save<StatusChange>('statusChanges', { gigId: gig.id, from: gig.stage, to: input.to, reason: input.reason, note: input.note });
  // Keep quotes in step with the pipeline.
  if (input.to === 'confirmed') {
    const qs = await db.quotes.where('gigId').equals(gig.id).toArray();
    const latest = qs.filter((q) => !q.deletedAt).sort((a, b) => b.version - a.version)[0];
    if (latest && latest.status === 'sent') await save<Quote>('quotes', { ...latest, status: 'accepted', acceptedAt: now });
  }
  if (input.to === 'lost') {
    const qs = await db.quotes.where('gigId').equals(gig.id).toArray();
    for (const q of qs) if (q.status === 'sent') await save<Quote>('quotes', { ...q, status: 'declined' });
  }
  runTaskSync();
}

export async function logInteraction(i: Omit<Interaction, 'id' | 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>) {
  return save<Interaction>('interactions', { ...i, id: uid() });
}

export function personLabel(p?: Person) {
  if (!p) return '';
  return p.anonymisedAt ? '—' : `${p.firstName} ${p.lastName}`.trim();
}

export function venueLine(v?: Venue) {
  if (!v) return '';
  return [v.name, v.city].filter(Boolean).join(', ');
}

export function mapsLink(v?: Venue) {
  if (!v) return '';
  if (v.lat != null && v.lng != null) return `https://www.google.com/maps/dir/?api=1&destination=${v.lat},${v.lng}`;
  const q = [v.street, v.postcode, v.city, v.country].filter(Boolean).join(', ') || v.name;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}`;
}
