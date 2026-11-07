import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../core/db';
import { useI18n } from '../../core/i18n';
import { useSession } from '../../core/session';
import { Empty, Modal } from '../../core/ui';
import { fmtDate } from '../../core/format';
import type { DayTask, Gig, GigDay, GigLog, MemberId, Person, TimelineStep, Venue } from '../../core/types';
import { whatsAppLink } from '../bookings/domain/messaging';
import { ensureGigDay, toggleTask, useDayTasks, useGigDay, useGigLogs, useSteps } from './data';
import { phaseOf, sortSteps } from './domain/timeline';

// ---- time helpers ------------------------------------------------------------

/** Re-render every `ms` (clock and countdowns). */
export function useNow(ms = 15000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const id = setInterval(() => setNow(new Date()), ms); return () => clearInterval(id); }, [ms]);
  return now;
}

export const hhmm = (iso?: string) => (iso ? new Date(iso).toTimeString().slice(0, 5) : '–');

/** "0:22" / "-0:05" countdown to a moment. */
export function countdown(iso: string, now: Date) {
  const m = Math.round((Date.parse(iso) - now.getTime()) / 60000);
  const a = Math.abs(m);
  if (a >= 24 * 60) return `${m < 0 ? '−' : ''}${Math.round(a / 1440)} d`;
  return `${m < 0 ? '−' : ''}${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`;
}

/** ISO for a HH:mm on the same day as `ref` (or the next day when it's far before). */
export function isoAt(ref: string, hm: string) {
  const d = new Date(ref);
  const [h, m] = hm.split(':').map(Number);
  const x = new Date(d); x.setHours(h, m, 0, 0);
  if (x.getTime() < d.getTime() - 12 * 3600e3) x.setDate(x.getDate() + 1);
  if (x.getTime() > d.getTime() + 12 * 3600e3) x.setDate(x.getDate() - 1);
  return x.toISOString();
}

// ---- gig context -------------------------------------------------------------

export interface GigCtx {
  gig: Gig;
  day: GigDay;
  venue?: Venue;
  steps: TimelineStep[];
  tasks: DayTask[];
  logs: GigLog[];
  persons: Person[];
  me: MemberId;
}
const Ctx = createContext<GigCtx | null>(null);
export const useGigCtx = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('GigLayout missing');
  return c;
};

/** Loads a gig with its gig day (created on first open) and shows the gig's sub-navigation. */
export function GigLayout({ bare }: { bare?: boolean }) {
  const { gigId } = useParams();
  const { t, lang } = useI18n();
  const { me } = useSession();
  const gig = useLiveQuery(() => (gigId ? db.gigs.get(gigId) : undefined), [gigId]);
  const day = useGigDay(gigId);
  const venue = useLiveQuery(() => (gig?.venueId ? db.venues.get(gig.venueId) : undefined), [gig?.venueId]);
  const persons = useLiveQuery(() => db.persons.toArray(), []) ?? [];
  const steps = sortSteps(useSteps(gigId));
  const tasks = useDayTasks(gigId);
  const logs = useGigLogs(gigId);
  useEffect(() => { if (gigId) void ensureGigDay(gigId, lang); }, [gigId, lang]);
  if (gig === undefined || !day?.status) return <p className="muted">…</p>;
  if (!gig || gig.deletedAt) return <Empty>{t('gd.notFound')}</Empty>;
  const value: GigCtx = { gig, day, venue, steps, tasks, logs, persons, me: me?.id ?? 'gijs' };
  if (bare) return <Ctx.Provider value={value}><Outlet /></Ctx.Provider>;
  const phase = phaseOf(steps, new Date(), gig.date);
  const tabs: [string, string][] = [['', t('gd.tab.today')], ['prep', t('gd.tab.prep')], ['timeline', t('gd.tab.timeline')], ['venue', t('gd.tab.venue')], ['music', t('gd.tab.music')], ['log', t('gd.tab.log')], ['wrapup', t('gd.tab.wrapup')]];
  return (
    <Ctx.Provider value={value}>
      <div className="gd-head">
        <div className="tiny muted">{fmtDate(gig.date, lang)}{venue ? ` · ${venue.name}` : ''}</div>
        <div className="row between" style={{ alignItems: 'baseline' }}>
          <h1 className="gd-title">{gig.title}</h1>
          <span className={`gd-phase ${phase}`}>{t(`gd.phase.${phase}` as never)}</span>
        </div>
        <nav className="tabs gd-tabs" aria-label={gig.title}>
          {tabs.map(([to, label]) => <NavLink key={to} to={to ? `/gigday/${gig.id}/${to}` : `/gigday/${gig.id}`} end>{label}</NavLink>)}
        </nav>
      </div>
      <Outlet />
    </Ctx.Provider>
  );
}

// ---- contacts -----------------------------------------------------------------

const ROLE_ORDER = ['day_contact', 'venue_manager', 'technician', 'planner', 'booker', 'other'];

export function contactList(gig: Gig, persons: Person[], venue?: Venue) {
  const byId = new Map(persons.map((p) => [p.id, p]));
  const list = [...(gig.contacts ?? [])]
    .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role))
    .map((c) => ({ role: c.role as string, person: byId.get(c.personId) }))
    .filter((c) => c.person) as { role: string; person: Person }[];
  const client = gig.clientPersonId ? byId.get(gig.clientPersonId) : undefined;
  if (client && !list.some((c) => c.person.id === client.id)) list.push({ role: 'client', person: client });
  const extra = venue?.contactName ? [{ role: 'venue', name: venue.contactName, phone: venue.contactPhone }] : [];
  return { people: list, extra };
}

/** The day contact (or the client) with a phone number. */
export function dayContact(gig: Gig, persons: Person[]) {
  const { people } = contactList(gig, persons);
  return people.find((c) => c.role === 'day_contact' && (c.person.phone || c.person.whatsapp)) ?? people.find((c) => c.person.phone || c.person.whatsapp);
}

export function ContactsSheet({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const { gig, persons, venue } = useGigCtx();
  const { people, extra } = contactList(gig, persons, venue);
  const row = (key: string, name: string, role: string, phone?: string, wa?: string) => (
    <div key={key} className="gd-contact">
      <div className="grow"><div className="strong">{name}</div><div className="tiny muted">{role}</div></div>
      {phone && <a className="btn small" href={`tel:${phone.replace(/\s/g, '')}`}>{t('gd.call')}</a>}
      {(wa || phone) && <a className="btn small" href={whatsAppLink(wa || phone, '')} target="_blank" rel="noreferrer">WhatsApp</a>}
      {phone && <a className="btn small ghost" href={`sms:${phone.replace(/\s/g, '')}`}>SMS</a>}
    </div>
  );
  return (
    <Modal title={t('gd.contacts')} onClose={onClose}>
      {people.map((c) => row(c.person.id, `${c.person.firstName} ${c.person.lastName}`, t(`gd.role.${c.role}` as never), c.person.phone, c.person.whatsapp))}
      {extra.map((c) => row('venue', c.name, t('gd.role.venue'), c.phone))}
      {!people.length && !extra.length && <p className="muted">{t('gd.noContacts')}</p>}
    </Modal>
  );
}

// ---- tasks --------------------------------------------------------------------

export function TaskTicks({ tasks, me }: { tasks: DayTask[]; me: MemberId }) {
  return (
    <div className="stack" style={{ gap: 'var(--s2)' }}>
      {tasks.map((task) => (
        <button key={task.id} className={`gd-task ${task.done ? 'done' : ''}`} onClick={() => void toggleTask(task, me)} aria-pressed={!!task.done}>
          <span className="gd-box">{task.done ? '✓' : ''}</span>
          <span className="grow">{task.title}</span>
          {task.owner !== me && <span className={`member ${task.owner === 'both' ? '' : task.owner}`}>{task.owner === 'both' ? '2' : task.owner[0].toUpperCase()}</span>}
        </button>
      ))}
    </div>
  );
}

export function Bar({ done, total, label }: { done: number; total: number; label: ReactNode }) {
  return (
    <div className="gd-bar" aria-label={`${done}/${total}`}>
      <div className="row between tiny"><span>{label}</span><span className="mono-num">{done}/{total}</span></div>
      <div className="gd-bar-track"><div className="gd-bar-fill" style={{ width: `${total ? (done / total) * 100 : 0}%` }} /></div>
    </div>
  );
}

/** Download a text file (calendar, plan). */
export function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
