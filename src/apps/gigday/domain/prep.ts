import type { DayPhase, EventType, GigDaySetup, MemberId, TaskTemplate, TaskTemplateItem, TimelineStep } from '../../../core/types';
import { pad } from '../../../core/dates';

// Day-before readiness, default task templates and the calendar export with
// alarms (the MVP's reminders: they work offline, on the lock screen and watch).

export type ReadyKey = 'contract' | 'deposit' | 'contact' | 'venue' | 'entrance' | 'wishes' | 'gear' | 'drivers';
export interface ReadyItem { key: ReadyKey; ok: boolean; na?: boolean }

export function readiness(p: {
  contract: 'signed' | 'open' | 'none';
  deposit: 'paid' | 'open' | 'none';
  dayContactPhone?: string;
  venueAddress: boolean;
  loadingEntrance: boolean;
  wishes: number;
  packList?: 'draft' | 'confirmed' | 'loading' | 'out' | 'done';
  drivers: number;
}): ReadyItem[] {
  return [
    { key: 'contract', ok: p.contract === 'signed', na: p.contract === 'none' },
    { key: 'deposit', ok: p.deposit === 'paid', na: p.deposit === 'none' },
    { key: 'contact', ok: !!p.dayContactPhone },
    { key: 'venue', ok: p.venueAddress },
    { key: 'entrance', ok: p.loadingEntrance },
    { key: 'wishes', ok: p.wishes > 0 },
    { key: 'gear', ok: !!p.packList && p.packList !== 'draft' },
    { key: 'drivers', ok: p.drivers > 0 },
  ];
}

const t = (phase: DayPhase, title: string, owner: MemberId | 'both' = 'both', extra: Partial<TaskTemplateItem> = {}): TaskTemplateItem => ({ phase, title, owner, ...extra });

/** Seeded templates (editable in Gig Day → Instellingen). Owners are a starting point: change per gig. */
export const DEFAULT_TASK_TEMPLATES: Pick<TaskTemplate, 'key' | 'name' | 'setup' | 'eventTypes' | 'items' | 'active'>[] = [
  {
    key: 'standard', name: 'Opbouw standaard set', setup: 'standard', eventTypes: [], active: true, items: [
      t('prep', 'Timeline en contactpersoon checken', 'gijs'),
      t('prep', 'Muziekwensen en speciale momenten doornemen', 'coen'),
      t('prep', 'Paklijst bevestigen (Gear)', 'gijs'),
      t('departure', 'Aanhanger: koppelslot, verlichting, banden', 'gijs'),
      t('departure', 'Laptop, controller, USB-sticks en koptelefoons in de auto', 'coen'),
      t('setup', 'Speakers en sub plaatsen, kabels tapen', 'gijs'),
      t('setup', 'DJ-booth en controller opbouwen', 'coen'),
      t('setup', 'Lichtbar en rack aansluiten', 'gijs'),
      t('setup', 'Lasercheck (klasse 4): stralen boven hoofden, noodstop, veiligheidskabel', 'gijs', { laserOnly: true }),
      t('setup', 'Soundcheck op het geluidsniveau van de zaal', 'coen'),
      t('breakdown', 'Afbouwen en inladen (scannen in Gear)', 'both'),
      t('breakdown', 'Rondje zaal: stroomkabels, statieven, USB in de speler?', 'coen'),
      t('wrapup', 'Afronden: gespeeld, factuur, ritten, bedankje', 'gijs'),
    ],
  },
  {
    key: 'dj_only', name: 'DJ only', setup: 'dj_only', eventTypes: [], active: true, items: [
      t('prep', 'Timeline en contactpersoon checken', 'gijs'),
      t('prep', 'Muziekwensen doornemen', 'coen'),
      t('departure', 'Laptop, controller, USB-sticks en koptelefoons mee', 'coen'),
      t('setup', 'Controller aansluiten op de installatie van de zaal', 'coen'),
      t('setup', 'Soundcheck met de techniek van de zaal', 'gijs'),
      t('breakdown', 'Rondje booth: USB, kabels, koptelefoons', 'coen'),
      t('wrapup', 'Afronden: gespeeld, factuur, ritten, bedankje', 'gijs'),
    ],
  },
  {
    key: 'wedding', name: "Bruiloft extra's", setup: 'any', eventTypes: ['wedding'], active: true, items: [
      t('prep', 'Openingsdans: nummer en moment bevestigen', 'coen'),
      t('playing', 'Speeches aankondigen', 'gijs'),
      t('playing', 'Openingsdans starten', 'coen'),
      t('playing', 'Taart: muziek klaar', 'coen'),
    ],
  },
  {
    key: 'outdoor', name: 'Buiten', setup: 'any', eventTypes: [], active: true, items: [
      t('departure', 'Regenhoezen, gewichten en spanbanden mee', 'gijs', { outdoorOnly: true }),
      t('setup', 'Tent/overkapping en stroomkabels droog leggen', 'both', { outdoorOnly: true }),
    ],
  },
];

/** The template items that apply to this gig. */
export function itemsFor(templates: Pick<TaskTemplate, 'setup' | 'eventTypes' | 'items' | 'active'>[], g: { setup: GigDaySetup; eventType: EventType; laser: boolean; outdoor: boolean }): TaskTemplateItem[] {
  return templates
    .filter((tp) => tp.active && (tp.setup === 'any' || tp.setup === g.setup) && (!tp.eventTypes.length || tp.eventTypes.includes(g.eventType)))
    .flatMap((tp) => tp.items)
    .filter((it) => (!it.laserOnly || g.laser) && (!it.outdoorOnly || g.outdoor));
}

const stamp = (d: Date) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');

/**
 * Calendar file for one person: the day-before check, their leave time with
 * two alarms (−30 min and at the time), the gig itself and the wrap-up next
 * morning. At most three alarms per gig plus the wrap-up (plan §5).
 */
export function gigDayIcs(p: {
  gigId: string; title: string; date: string; me: MemberId; steps: Pick<TimelineStep, 'kind' | 'plannedAt' | 'memberId' | 'label'>[];
  location?: string; dayBeforeAt: string; wrapUpAt: string; routeUrl?: string;
  labels: { dayBefore: string; wrapUp: string };
}, now = new Date()): string {
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Team Funqtion//Gig Day//NL', 'CALSCALE:GREGORIAN'];
  const ev = (uid: string, start: Date, minutes: number, summary: string, alarms: number[], desc = '') => {
    L.push('BEGIN:VEVENT', `UID:${uid}@funqtion-gigday`, `DTSTAMP:${stamp(now)}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(new Date(start.getTime() + minutes * 60000))}`, `SUMMARY:${esc(summary)}`);
    if (p.location) L.push(`LOCATION:${esc(p.location)}`);
    if (desc) L.push(`DESCRIPTION:${esc(desc)}`);
    for (const a of alarms) L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(summary)}`, `TRIGGER:${a === 0 ? 'PT0M' : `-PT${a}M`}`, 'END:VALARM');
    L.push('END:VEVENT');
  };
  const [y, m, d] = p.date.split('-').map(Number);
  const local = (day: Date, hhmm: string) => { const [h, mi] = hhmm.split(':').map(Number); const x = new Date(day); x.setHours(h, mi, 0, 0); return x; };
  const gigDay = new Date(y, m - 1, d);
  ev(`${p.gigId}-daybefore-${p.me}`, local(new Date(y, m - 1, d - 1), p.dayBeforeAt), 15, `${p.labels.dayBefore}: ${p.title}`, [0]);
  const leave = p.steps.find((s) => s.kind === 'leave_home' && s.memberId === p.me);
  if (leave) ev(`${p.gigId}-leave-${p.me}`, new Date(leave.plannedAt), 15, `${leave.label} · ${p.title}`, [30, 0], p.routeUrl ?? '');
  const first = p.steps.filter((s) => s.kind === 'set_start').sort((a, b) => a.plannedAt.localeCompare(b.plannedAt))[0];
  const last = p.steps.filter((s) => s.kind === 'set_end').sort((a, b) => b.plannedAt.localeCompare(a.plannedAt))[0];
  if (first && last) ev(`${p.gigId}-gig-${p.me}`, new Date(first.plannedAt), Math.max(30, (Date.parse(last.plannedAt) - Date.parse(first.plannedAt)) / 60000), p.title, []);
  ev(`${p.gigId}-wrapup-${p.me}`, local(new Date(gigDay.getTime() + 86400000), p.wrapUpAt), 15, `${p.labels.wrapUp}: ${p.title}`, [0]);
  L.push('END:VCALENDAR');
  return L.join('\r\n');
}
