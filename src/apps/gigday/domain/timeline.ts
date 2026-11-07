import type { GigDayDefaults, GigDaySetup, MemberId, SetSlot, StepKind } from '../../../core/types';
import { addMinutes, at } from '../../../core/dates';

// The gig-day timeline: generated backwards and forwards from what Bookings
// knows (set slots, set-up time), the defaults per set-up and the travel time.
// Pure: no database, no i18n (labels come in as a function).

export interface StepDraft {
  key: string;            // stable identity across regenerations
  kind: StepKind;
  label: string;
  plannedAt: string;      // ISO
  memberId?: MemberId;
  sourceRef?: string;
}

export interface TimelineInput {
  date: string;
  startTime: string;
  endTime: string;
  setupTime?: string;
  setSlots: SetSlot[];
  setup: GigDaySetup;
  doorsAt?: string;
  curfew?: string;
  /** travel minutes per driver (without buffer) */
  travel: Partial<Record<MemberId, number>>;
  pickup?: { by: MemberId; minutes: number };
  moments: { id: string; title: string; at?: string }[];
  defaults: GigDayDefaults;
}

export type Labeler = (kind: StepKind, p?: Record<string, string>) => string;

/** A clock time on the gig's night: times far before the start belong to the next day. */
export function timeOnGig(date: string, startTime: string, hhmm: string): Date {
  const start = at(date, startTime || '20:00');
  let d = at(date, hhmm);
  if (d.getTime() < start.getTime() - 12 * 3600e3) d = addMinutes(d, 24 * 60);
  else if (d.getTime() > start.getTime() + 12 * 3600e3) d = addMinutes(d, -24 * 60);
  return d;
}

const roundUp5 = (m: number) => Math.ceil(m / 5) * 5;

/** Travel estimate from the one-way distance: km ÷ speed (slower with the trailer), rounded up to 5 min. */
export function estimateTravel(km: number | undefined, trailer: boolean, d: Pick<GigDayDefaults, 'avgSpeedKmh' | 'avgSpeedTrailerKmh'>): number | undefined {
  if (!km || km <= 0) return undefined;
  return roundUp5((km / (trailer ? d.avgSpeedTrailerKmh : d.avgSpeedKmh)) * 60);
}

export function generateTimeline(i: TimelineInput, label: Labeler): StepDraft[] {
  const t = (hhmm: string) => timeOnGig(i.date, i.startTime, hhmm);
  const iso = (d: Date) => d.toISOString();
  const out: StepDraft[] = [];
  const add = (s: Omit<StepDraft, 'plannedAt'> & { at: Date }) => { const { at: d, ...rest } = s; out.push({ ...rest, plannedAt: iso(d) }); };

  // Sets (or the whole gig as one set)
  const slots = i.setSlots.length
    ? [...i.setSlots].map((s) => ({ ...s, s: t(s.start), e: t(s.end) })).map((s) => ({ ...s, e: s.e <= s.s ? addMinutes(s.e, 24 * 60) : s.e })).sort((a, b) => a.s.getTime() - b.s.getTime())
    : [{ id: 'gig', start: i.startTime, end: i.endTime, label: '', performers: [] as MemberId[], s: t(i.startTime || '20:00'), e: t(i.endTime || '23:59') }].map((s) => ({ ...s, e: s.e <= s.s ? addMinutes(s.e, 24 * 60) : s.e }));
  const n = slots.length;
  slots.forEach((s, k) => {
    const who = s.performers.map((p) => (p === 'gijs' ? 'Gijs' : 'Coen')).join(' + ');
    const name = s.label || (n > 1 ? `Set ${k + 1}` : 'Set');
    add({ key: `set_start:${s.id}`, kind: 'set_start', label: label('set_start', { name, who }), at: s.s, sourceRef: s.id });
    add({ key: `set_end:${s.id}`, kind: 'set_end', label: label('set_end', { name, last: k === n - 1 ? '1' : '' }), at: s.e, sourceRef: s.id });
  });
  const firstSet = slots[0].s;
  const lastEnd = slots[n - 1].e;

  // Before the first set, backwards
  const d = i.defaults;
  const doors = i.doorsAt ? t(i.doorsAt) : addMinutes(firstSet, -d.doorsBeforeFirstSet);
  add({ key: 'doors', kind: 'doors', label: label('doors'), at: doors });
  const soundcheck = addMinutes(doors, -d.soundcheckBeforeDoors[i.setup]);
  add({ key: 'soundcheck', kind: 'soundcheck', label: label('soundcheck'), at: soundcheck });
  const setup = i.setupTime ? t(i.setupTime) : addMinutes(soundcheck, -d.setupMinutes[i.setup]);
  add({ key: 'setup', kind: 'setup', label: label('setup'), at: setup });
  const arrive = addMinutes(setup, -d.arriveBeforeSetup);
  add({ key: 'arrive', kind: 'arrive', label: label('arrive'), at: arrive });

  const drivers = (Object.keys(i.travel) as MemberId[]).filter((m) => i.travel[m] != null);
  let longest = 0;
  for (const m of drivers) {
    const travel = i.travel[m]!;
    longest = Math.max(longest, travel);
    const detour = i.pickup?.by === m ? i.pickup.minutes : 0;
    const leave = addMinutes(arrive, -(travel + d.leaveBuffer + detour));
    const name = m === 'gijs' ? 'Gijs' : 'Coen';
    add({ key: `leave_home:${m}`, kind: 'leave_home', label: label('leave_home', { who: name }), at: leave, memberId: m });
    if (detour) {
      const other = m === 'gijs' ? 'Coen' : 'Gijs';
      add({ key: `pickup:${m}`, kind: 'pickup', label: label('pickup', { who: name, at: other }), at: addMinutes(leave, Math.round(detour / 2)), memberId: m });
    }
  }

  // Special moments: at their time, or right after the first set (one long set: at its start)
  for (const mo of i.moments) {
    const when = mo.at ? t(mo.at) : n > 1 ? slots[0].e : slots[0].s;
    add({ key: `moment:${mo.id}`, kind: 'moment', label: mo.title, at: when, sourceRef: mo.id });
  }
  if (i.curfew) add({ key: 'curfew', kind: 'curfew', label: label('curfew'), at: t(i.curfew) });

  // After the last set
  add({ key: 'breakdown', kind: 'breakdown', label: label('breakdown'), at: lastEnd });
  const leaveVenue = addMinutes(lastEnd, d.breakdownMinutes[i.setup]);
  add({ key: 'leave_venue', kind: 'leave_venue', label: label('leave_venue'), at: leaveVenue });
  add({ key: 'home', kind: 'home', label: label('home'), at: addMinutes(leaveVenue, longest || 30) });

  return sortSteps(out);
}

/** Stable sort: by planned time, then by the natural order of kinds. */
const ORDER: StepKind[] = ['leave_home', 'pickup', 'arrive', 'setup', 'soundcheck', 'doors', 'set_start', 'moment', 'set_end', 'curfew', 'breakdown', 'leave_venue', 'home', 'custom'];
export function sortSteps<T extends { plannedAt: string; kind: StepKind }>(steps: T[]): T[] {
  return [...steps].sort((a, b) => a.plannedAt.localeCompare(b.plannedAt) || ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
}

export interface ExistingStep extends StepDraft { id: string; actualAt?: string; locked?: boolean }

/**
 * Regenerate against what's stored: done or hand-set (locked) steps keep their
 * times; steps that no longer exist are dropped unless done, locked or custom.
 */
export function mergeTimeline(fresh: StepDraft[], existing: ExistingStep[]): { keep: ExistingStep[]; add: StepDraft[]; update: ExistingStep[]; remove: ExistingStep[] } {
  const byKey = new Map(existing.map((e) => [e.key, e]));
  const keep: ExistingStep[] = [], add: StepDraft[] = [], update: ExistingStep[] = [], remove: ExistingStep[] = [];
  const seen = new Set<string>();
  for (const f of fresh) {
    const e = byKey.get(f.key);
    seen.add(f.key);
    if (!e) { add.push(f); continue; }
    if (e.actualAt || e.locked) { keep.push(e); continue; }
    if (e.plannedAt !== f.plannedAt || e.label !== f.label) update.push({ ...e, plannedAt: f.plannedAt, label: f.label });
    else keep.push(e);
  }
  for (const e of existing) {
    if (seen.has(e.key)) continue;
    if (e.actualAt || e.locked || e.kind === 'custom') keep.push(e); else remove.push(e);
  }
  return { keep, add, update, remove };
}

/** Steps that move when you're running late: the run-up to the doors, never the sets or the curfew. */
export const LATE_KINDS: StepKind[] = ['leave_home', 'pickup', 'arrive', 'setup', 'soundcheck'];

/**
 * Move a step and everything after it (not yet done) by `minutes`. With
 * `only`, just those kinds move (e.g. "we're late" leaves the sets alone).
 * The curfew never moves: it's a permit, not a plan.
 */
export function shiftSteps<T extends { id: string; plannedAt: string; actualAt?: string; kind: StepKind }>(steps: T[], fromId: string, minutes: number, only?: StepKind[]): T[] {
  const from = steps.find((s) => s.id === fromId);
  if (!from) return [];
  return steps
    .filter((s) => !s.actualAt && s.kind !== 'curfew' && s.plannedAt >= from.plannedAt && (!only || only.includes(s.kind)))
    .map((s) => ({ ...s, plannedAt: addMinutes(new Date(s.plannedAt), minutes).toISOString() }));
}

export type StepState = 'done' | 'on_time' | 'behind' | 'late';

/** On schedule (green), behind (amber, > 5 min) or late (red, > 15 min). */
export function stepState(s: { plannedAt: string; actualAt?: string }, now: Date): StepState {
  if (s.actualAt) return 'done';
  const over = (now.getTime() - Date.parse(s.plannedAt)) / 60000;
  return over > 15 ? 'late' : over > 5 ? 'behind' : 'on_time';
}

/** Actual vs planned in minutes (+ = later than planned). */
export const delay = (s: { plannedAt: string; actualAt?: string }) =>
  s.actualAt ? Math.round((Date.parse(s.actualAt) - Date.parse(s.plannedAt)) / 60000) : 0;

/**
 * What to do now and next for one person: the first open step (not someone
 * else's leave/pick-up), and the one after it.
 */
export function nowNext<T extends { plannedAt: string; actualAt?: string; memberId?: MemberId; kind: StepKind }>(steps: T[], me?: MemberId): { now?: T; next?: T } {
  const mine = sortSteps(steps).filter((s) => !s.actualAt && (!s.memberId || !me || s.memberId === me) && s.kind !== 'curfew');
  return { now: mine[0], next: mine[1] };
}

export type Phase = 'prep' | 'departure' | 'setup' | 'playing' | 'breakdown' | 'home' | 'done';

/** Where the day is, from the steps already done. */
export function phaseOf(steps: { kind: StepKind; actualAt?: string }[], now: Date, date: string): Phase {
  const done = (k: StepKind) => steps.some((s) => s.kind === k && s.actualAt);
  const allSetsDone = steps.filter((s) => s.kind === 'set_end').every((s) => s.actualAt) && steps.some((s) => s.kind === 'set_end');
  if (done('home')) return 'done';
  if (done('leave_venue')) return 'home';
  if (allSetsDone) return 'breakdown';
  if (done('set_start')) return 'playing';
  if (done('arrive') || done('setup')) return 'setup';
  if (done('leave_home') || at(date, '00:00').getTime() <= now.getTime()) return 'departure';
  return 'prep';
}

/** The step after which the next set is playing: who plays now and until when. */
export function nowPlaying<T extends { kind: StepKind; plannedAt: string; actualAt?: string; label: string; sourceRef?: string }>(steps: T[], slots: SetSlot[]): { slot?: SetSlot; until?: string } {
  const starts = sortSteps(steps).filter((s) => s.kind === 'set_start' && s.actualAt);
  const last = starts[starts.length - 1];
  if (!last) return {};
  const end = steps.find((s) => s.kind === 'set_end' && s.sourceRef === last.sourceRef);
  if (end?.actualAt) return {};
  return { slot: slots.find((s) => s.id === last.sourceRef), until: end?.plannedAt };
}
