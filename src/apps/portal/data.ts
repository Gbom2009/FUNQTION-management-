import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../core/db';
import { alive, nowIso, patch, save, uid } from '../../core/repo';
import { publicLink, readAnswers } from '../../core/share';
import { PORTAL_SECTIONS, type Consent, type Gig, type GigContact, type Person, type Portal, type Settings, type Task } from '../../core/types';
import { mailtoLink, toWhatsAppNumber, whatsAppLink } from '../bookings/domain/messaging';
import { logInteraction } from '../bookings/data';
import { invoiceState, invoiceTotals, quoteTotals } from '../invoicing/domain/money';
import { feedbackLink, importFeedback, type ImportResult } from '../feedback/data';
import { afterLock, buildSnapshot, cleanWishes, lockDate, mergeWishes, type DocLine, type Snapshot } from './domain/portal';

export const usePortals = () => alive(useLiveQuery(() => db.portals.toArray(), []) ?? []) as Portal[];
export const usePortal = (gigId?: string) => useLiveQuery(() => (gigId ? db.portals.where('gigId').equals(gigId).first() : undefined), [gigId]);

async function settings(): Promise<Partial<Settings>> { return (await db.settings.get('settings')) ?? {}; }

const creating = new Map<string, Promise<Portal>>();
/** Get or create the portal settings of a gig (one per gig; parallel callers share one create). */
export function ensurePortal(gigId: string): Promise<Portal> {
  const pending = creating.get(gigId);
  if (pending) return pending;
  const job = (async () => {
    const p = await db.portals.where('gigId').equals(gigId).first();
    if (p) return p.deletedAt ? patch<Portal>('portals', p.id, { deletedAt: null }) as Promise<Portal> : p;
    return save<Portal>('portals', { gigId, sections: [...PORTAL_SECTIONS], lockDays: 7, showPlayed: 'top20' });
  })().finally(() => creating.delete(gigId));
  creating.set(gigId, job);
  return job;
}
export const updatePortal = (p: Portal, c: Partial<Portal>) => patch<Portal>('portals', p.id, c);

const ROLE_NL: Record<GigContact['role'], string> = { booker: 'opdrachtgever', day_contact: 'aanspreekpunt op de dag', venue_manager: 'locatie', technician: 'techniek', planner: 'weddingplanner', other: 'contact' };

/** Documents with status only: prices of the accepted quote and open amounts, never internal notes. */
async function docsFor(gig: Gig): Promise<DocLine[]> {
  const out: DocLine[] = [];
  const quotes = alive(await db.quotes.where('gigId').equals(gig.id).toArray()).filter((q) => q.status !== 'draft' && q.status !== 'superseded');
  for (const q of quotes) out.push({ k: 'quote', no: q.number, st: q.status, amt: quoteTotals(q).total });
  const contracts = alive(await db.contracts.where('gigId').equals(gig.id).toArray()).filter((c) => c.status !== 'draft');
  for (const c of contracts) out.push({ k: 'contract', no: c.number, st: c.status });
  const payments = alive(await db.payments.toArray());
  const invoices = alive(await db.invoices.where('gigId').equals(gig.id).toArray()).filter((i) => i.status !== 'draft');
  for (const i of invoices) {
    const k = i.kind === 'deposit' ? 'deposit' : i.kind === 'final' ? 'final' : 'invoice';
    out.push({ k, no: i.number, st: invoiceState(i, payments), amt: invoiceTotals(i).total, due: i.dueDate });
  }
  return out;
}

export async function snapshotFor(gig: Gig): Promise<Snapshot> {
  const s = await settings();
  const portal = await ensurePortal(gig.id);
  const client = gig.clientPersonId ? await db.persons.get(gig.clientPersonId) : undefined;
  const venue = gig.venueId ? await db.venues.get(gig.venueId) : undefined;
  const steps = alive(await db.timelineSteps.where('gigId').equals(gig.id).toArray());
  const members = (await db.members.toArray()).filter((m) => gig.performers.includes(m.id)).map((m) => ({ name: m.name, phone: m.phone }));
  const contacts: { name: string; role: string; phone?: string }[] = [];
  for (const c of gig.contacts) {
    if (c.personId === gig.clientPersonId) continue;
    const p = await db.persons.get(c.personId);
    if (p && !p.deletedAt) contacts.push({ name: `${p.firstName} ${p.lastName}`.trim(), role: ROLE_NL[c.role], phone: p.phone });
  }
  const wa = s.answerWhatsApp || s.bizPhone;
  const snap = buildSnapshot({
    gig, portal, lang: client?.language ?? s.language ?? 'nl', clientFirstName: client?.firstName, venue, steps, members, contacts,
    docs: await docsFor(gig), answerWa: wa ? toWhatsAppNumber(wa) : undefined, answerMail: s.bizEmail || 'Booking@funqtion.nl',
  });
  if (snap.pl || snap.ph || snap.sp) (snap as Snapshot & { fl?: string }).fl = (await feedbackLink(gig)).link;
  return snap;
}

export async function portalLink(gig: Gig): Promise<string> {
  const s = await settings();
  return publicLink(s.publicAppUrl, 'c', await snapshotFor(gig));
}

/** Message with the client's page; marks it as sent. */
export async function sendPortal(gig: Gig, sender: string) {
  const link = await portalLink(gig);
  const client = gig.clientPersonId ? await db.persons.get(gig.clientPersonId) : undefined;
  const nl = (client?.language ?? 'nl') === 'nl';
  const text = nl
    ? `Hoi ${client?.firstName ?? ''},\n\nHier is jullie eigen pagina voor ${gig.title}: de tijden, onze contactgegevens, de stand van offerte/contract/facturen en een plek voor jullie muziekwensen.\n${link}\n\nTip: bewaar dit bericht, de link is jullie pagina. Na een wijziging sturen we een nieuwe.\n\nGroet,\n${sender} – Team Funqtion`
    : `Hi ${client?.firstName ?? ''},\n\nHere is your own page for ${gig.title}: the times, our contact details, the status of quote/contract/invoices and a place for your music wishes.\n${link}\n\nTip: keep this message, the link is your page. We send a new one after changes.\n\nCheers,\n${sender} – Team Funqtion`;
  const portal = await ensurePortal(gig.id);
  await updatePortal(portal, { sentAt: nowIso() });
  return { link, text, whatsapp: whatsAppLink(client?.whatsapp || client?.phone, text), mail: mailtoLink(client?.email, nl ? `Jullie pagina: ${gig.title}` : `Your page: ${gig.title}`, text) };
}

export interface WishImport { gigs: number; wishes: number; contacts: number; late: string[] }

/** Wishes, contacts and consents from the client's portal message. */
export async function importWishes(text: string, me: 'gijs' | 'coen'): Promise<WishImport> {
  const res: WishImport = { gigs: 0, wishes: 0, contacts: 0, late: [] };
  for (const raw of readAnswers(text)) {
    const a = cleanWishes(raw);
    if (!a) continue;
    const gig = await db.gigs.get(a.g);
    if (!gig || gig.deletedAt) continue;
    const portal = await ensurePortal(gig.id);
    if (portal.lastAnswerAt && portal.lastAnswerAt >= a.at) continue; // already read
    const merged = mergeWishes(gig.musicWishes ?? [], a.w, uid, a.at);
    const contacts = [...gig.contacts];
    for (const [name, role, phone] of a.c ?? []) {
      const [firstName, ...rest] = name.split(' ');
      const exists = (await db.persons.toArray()).find((p) => !p.deletedAt && `${p.firstName} ${p.lastName}`.trim().toLowerCase() === name.toLowerCase());
      const person = exists ?? await save<Person>('persons', { firstName, lastName: rest.join(' '), phone, language: 'nl', tags: ['portal'], notes: role ? `Rol: ${role}` : undefined });
      if (!contacts.some((c) => c.personId === person.id)) { contacts.push({ personId: person.id, role: /plan/i.test(role) ? 'planner' : /locatie|venue/i.test(role) ? 'venue_manager' : 'day_contact' }); res.contacts++; }
    }
    await patch<Gig>('gigs', gig.id, { musicWishes: merged.wishes, contacts });
    const client = gig.clientPersonId ? await db.persons.get(gig.clientPersonId) : undefined;
    const base = { gigId: gig.id, personId: client?.id, subjectName: client ? `${client.firstName} ${client.lastName}`.trim() : gig.title, source: 'portal' as const, at: a.at, evidence: `Klantpagina ${a.at}` };
    if (a.ok?.photo !== undefined) await save<Consent>('consents', { ...base, purpose: 'photo_promo', given: a.ok.photo, scope: 'Instagram + website' });
    if (a.ok?.event !== undefined) await save<Consent>('consents', { ...base, purpose: 'event_promo', given: a.ok.event, scope: 'Instagram' });
    await logInteraction({ at: a.at, channel: 'note', direction: 'in', gigId: gig.id, personId: client?.id, summary: `Klantpagina: ${merged.added} wensen${a.c?.length ? `, ${a.c.length} contacten` : ''}${a.note ? ` – ${a.note.slice(0, 100)}` : ''}` });
    const lock = lockDate(gig, portal.lockDays);
    if (afterLock(a.at, lock) && merged.added) {
      res.late.push(gig.title);
      await save<Task>('tasks', { title: `Wensen na de sluitdatum: ${gig.title}`, kind: 'custom', dueAt: nowIso(), assignedTo: me, gigId: gig.id, status: 'open' });
    }
    await updatePortal(portal, { lastAnswerAt: a.at });
    res.gigs++; res.wishes += merged.added;
  }
  return res;
}

/** One paste box for everything clients send back (feedback and wishes). */
export async function importAll(text: string, me: 'gijs' | 'coen'): Promise<{ feedback: ImportResult; wishes: WishImport }> {
  return { feedback: await importFeedback(text, me), wishes: await importWishes(text, me) };
}
