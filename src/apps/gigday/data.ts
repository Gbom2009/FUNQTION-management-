import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../core/db';
import { alive, nowIso, patch, save, uid } from '../../core/repo';
import { translate, type Key } from '../../core/i18n';
import { todayStr } from '../../core/dates';
import { importMerge, type BackupFile } from '../../core/backup';
import {
  DEFAULT_GIGDAY, type DayTask, type Gig, type GigDay, type GigDayDefaults, type GigDaySetup, type GigLog, type Invoice, type Lang,
  type MemberId, type MusicWish, type Quote, type Review, type Settings, type StepKind, type TaskTemplate, type TimelineStep, type Venue, type VenueNote, type VenuePhoto,
} from '../../core/types';
import { changeStage } from '../bookings/data';
import { saveTripForGig } from '../money/data';
import { createInvoiceFromQuote } from '../invoicing/data';
import { gigDayId } from '../maps/features/shared/mapping';
import { estimateTravel, generateTimeline, mergeTimeline, shiftSteps, LATE_KINDS, type ExistingStep, type TimelineInput } from './domain/timeline';
import { overtime, overtimeLine } from './domain/overtime';
import { DEFAULT_TASK_TEMPLATES, itemsFor } from './domain/prep';

const EMPTY: never[] = [];

// ---- hooks ------------------------------------------------------------------

export const useGigDay = (gigId?: string) => useLiveQuery(() => (gigId ? db.gigDays.get(gigDayId(gigId)) : undefined), [gigId]);
export const useAllGigDays = () => alive(useLiveQuery(() => db.gigDays.toArray(), []) ?? EMPTY) as GigDay[];
export const useSteps = (gigId?: string) => alive(useLiveQuery(() => (gigId ? db.timelineSteps.where('gigId').equals(gigId).toArray() : EMPTY), [gigId]) ?? EMPTY) as TimelineStep[];
export const useDayTasks = (gigId?: string) =>
  (alive(useLiveQuery(() => (gigId ? db.dayTasks.where('gigId').equals(gigId).toArray() : EMPTY), [gigId]) ?? EMPTY) as DayTask[]).sort((a, b) => a.sort - b.sort);
export const useGigLogs = (gigId?: string) =>
  (alive(useLiveQuery(() => (gigId ? db.gigLogs.where('gigId').equals(gigId).toArray() : EMPTY), [gigId]) ?? EMPTY) as GigLog[]).sort((a, b) => b.at.localeCompare(a.at));
export const useVenueNotes = (venueId?: string) =>
  (alive(useLiveQuery(() => (venueId ? db.venueNotes.where('venueId').equals(venueId).toArray() : EMPTY), [venueId]) ?? EMPTY) as VenueNote[]).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
export const useTemplates = () => (alive(useLiveQuery(() => db.taskTemplates.toArray(), []) ?? EMPTY) as TaskTemplate[]).sort((a, b) => a.name.localeCompare(b.name));

export const defaultsOf = (s?: Settings): GigDayDefaults => ({
  ...DEFAULT_GIGDAY, ...(s?.gigDay ?? {}),
  soundcheckBeforeDoors: { ...DEFAULT_GIGDAY.soundcheckBeforeDoors, ...(s?.gigDay?.soundcheckBeforeDoors ?? {}) },
  setupMinutes: { ...DEFAULT_GIGDAY.setupMinutes, ...(s?.gigDay?.setupMinutes ?? {}) },
  breakdownMinutes: { ...DEFAULT_GIGDAY.breakdownMinutes, ...(s?.gigDay?.breakdownMinutes ?? {}) },
});

async function settings(): Promise<Settings | undefined> { return db.settings.get('settings'); }

// ---- set-up -------------------------------------------------------------------

/** Seed the default task templates once (by key, so two devices agree). */
export async function ensureTemplates() {
  for (const tp of DEFAULT_TASK_TEMPLATES) {
    if (!(await db.taskTemplates.where('key').equals(tp.key).first())) await save<TaskTemplate>('taskTemplates', { ...tp, id: `tt-${tp.key}` }, { actor: 'system' });
  }
}

async function setupFor(gig: Gig): Promise<GigDaySetup> {
  const list = await db.packLists.where('gigId').equals(gig.id).first();
  if (list && !list.deletedAt) return list.setup === 'standard' ? 'standard' : 'dj_only';
  return gig.setupRequired ? 'standard' : 'dj_only';
}

/** The gig day for a gig, created with its timeline and tasks on first open. */
export async function ensureGigDay(gigId: string, lang: Lang): Promise<GigDay | undefined> {
  const gig = await db.gigs.get(gigId);
  if (!gig) return undefined;
  const id = gigDayId(gigId);
  let day = await db.gigDays.get(id);
  if (!day?.status) {
    const venue = gig.venueId ? await db.venues.get(gig.venueId) : undefined;
    day = await save<GigDay>('gigDays', {
      ...(day ?? { id, gigId }),
      status: 'draft',
      setup: day?.setup ?? (await setupFor(gig)),
      doorsAt: day?.doorsAt ?? venue?.defaultDoors,
      curfew: day?.curfew ?? venue?.curfew,
      noiseLimitDb: day?.noiseLimitDb ?? venue?.soundLimitDb,
      drivers: day?.drivers ?? [gig.ownerId],
    } as GigDay);
    await regenerate(gigId, lang);
    await createTasks(gigId);
  }
  await syncFromMaps(gigId);
  return db.gigDays.get(id);
}

/** Timeline input from Bookings + gig day + venue + settings. */
export async function timelineInput(gigId: string): Promise<TimelineInput | undefined> {
  const gig = await db.gigs.get(gigId);
  const day = await db.gigDays.get(gigDayId(gigId));
  if (!gig || !day) return undefined;
  const venue = gig.venueId ? await db.venues.get(gig.venueId) : undefined;
  const d = defaultsOf(await settings());
  const setup = day.setup ?? 'standard';
  const travel: Partial<Record<MemberId, number>> = {};
  // Maps' drive time (with its traffic margin) beats an estimate from the distance.
  const nav = day.route ? Math.ceil((day.route.seconds / 60) * (1 + (day.trafficMarginPct ?? 15) / 100) / 5) * 5 : undefined;
  for (const m of day.drivers ?? [gig.ownerId]) {
    travel[m] = day.travelByMember?.[m] ?? nav ?? estimateTravel(venue?.distanceKm?.[m], setup === 'standard', d) ?? 30;
  }
  return {
    date: gig.date, startTime: gig.startTime, endTime: gig.endTime, setupTime: gig.setupTime, setSlots: gig.setSlots ?? [],
    setup, doorsAt: day.doorsAt, curfew: day.curfew, travel, pickup: day.pickup,
    moments: (gig.musicWishes ?? []).filter((w) => w.kind === 'special_moment').map((w) => ({ id: w.id, title: w.text, at: w.at })),
    defaults: d,
  };
}

export const stepKey = (s: Pick<TimelineStep, 'kind' | 'sourceRef' | 'memberId' | 'id'>) =>
  s.kind === 'custom' ? `custom:${s.id}` : s.sourceRef ? `${s.kind}:${s.sourceRef}` : s.memberId ? `${s.kind}:${s.memberId}` : s.kind;

const labeler = (lang: Lang) => (kind: StepKind, p: Record<string, string> = {}) => {
  if (kind === 'set_end' && p.last) return translate(lang, 'gd.step.last_record', p);
  if (kind === 'set_start' && !p.who) return translate(lang, 'gd.step.set_start_solo', p);
  return translate(lang, `gd.step.${kind}` as Key, p);
};

/** Rebuild the timeline; done and hand-set steps keep their times. */
export async function regenerate(gigId: string, lang: Lang) {
  const input = await timelineInput(gigId);
  if (!input) return;
  const fresh = generateTimeline(input, labeler(lang));
  const existing = alive(await db.timelineSteps.where('gigId').equals(gigId).toArray()) as TimelineStep[];
  const m = mergeTimeline(fresh, existing.map((e) => ({ ...e, key: stepKey(e) }) as ExistingStep & TimelineStep));
  for (const a of m.add) { const { key: _k, ...rest } = a; await save<TimelineStep>('timelineSteps', { ...rest, gigId }); }
  for (const u of m.update) { const { key: _k, ...rest } = u as ExistingStep & TimelineStep; await save<TimelineStep>('timelineSteps', rest); }
  for (const r of m.remove) await patch<TimelineStep>('timelineSteps', r.id, { deletedAt: nowIso() });
}

/** Day tasks from the templates that apply (only once per gig). */
export async function createTasks(gigId: string) {
  if (alive(await db.dayTasks.where('gigId').equals(gigId).toArray()).length) return;
  await ensureTemplates();
  const gig = (await db.gigs.get(gigId))!;
  const day = await db.gigDays.get(gigDayId(gigId));
  const list = await db.packLists.where('gigId').equals(gigId).first();
  const laserIds = new Set((await db.gearItems.toArray()).filter((i) => i.category === 'lasers').map((i) => i.id));
  const laser = !!list?.lines.some((l) => laserIds.has(l.itemId) && !l.skip);
  const templates = alive(await db.taskTemplates.toArray()) as TaskTemplate[];
  const items = itemsFor(templates, { setup: day?.setup ?? 'standard', eventType: gig.eventType, laser, outdoor: gig.setting === 'outdoor' || gig.setting === 'both' });
  let sort = 0;
  for (const it of items) await save<DayTask>('dayTasks', { gigId, phase: it.phase, title: it.title, owner: it.owner, sort: sort++ });
}

/** Maps reported an arrival for this gig: tick the arrive step. */
export async function syncFromMaps(gigId: string) {
  const day = await db.gigDays.get(gigDayId(gigId));
  if (!day?.arrivedAt) return;
  const steps = alive(await db.timelineSteps.where('gigId').equals(gigId).toArray()) as TimelineStep[];
  const arrive = steps.find((s) => s.kind === 'arrive');
  if (arrive && !arrive.actualAt) {
    await save<TimelineStep>('timelineSteps', { ...arrive, actualAt: day.arrivedAt });
    const gig = await db.gigs.get(gigId);
    await addLog(gigId, 'arrive', { at: day.arrivedAt, text: 'Maps' }, gig?.ownerId ?? 'gijs');
  }
}

export async function updateGigDay(gigId: string, p: Partial<GigDay>, lang?: Lang) {
  await patch<GigDay>('gigDays', gigDayId(gigId), p);
  if (lang) await regenerate(gigId, lang);
}

// ---- on the day -------------------------------------------------------------

const LOG_FOR: Partial<Record<StepKind, GigLog['type']>> = {
  leave_home: 'leave', arrive: 'arrive', setup: 'setup_start', soundcheck: 'soundcheck_done', doors: 'doors',
  set_start: 'set_start', set_end: 'set_end', moment: 'moment_done', leave_venue: 'left_venue', home: 'home',
};

export async function addLog(gigId: string, type: GigLog['type'], p: Partial<GigLog>, by: MemberId) {
  return save<GigLog>('gigLogs', { gigId, at: nowIso(), type, ...p, by });
}

/** Tick a step: actual time now (or given), plus a log entry. Going live on the first tick. */
export async function doneStep(step: TimelineStep, me: MemberId, when = nowIso()) {
  await save<TimelineStep>('timelineSteps', { ...step, actualAt: when });
  const type = LOG_FOR[step.kind];
  if (type) await addLog(step.gigId, type, { at: when, stepId: step.id, text: step.label }, me);
  if (step.kind === 'moment' && step.sourceRef) await setWish(step.gigId, step.sourceRef, { done: true, doneAt: when });
  const day = await db.gigDays.get(gigDayId(step.gigId));
  if (day && (day.status === 'draft' || day.status === 'planned')) await patch<GigDay>('gigDays', day.id, { status: 'live', liveAt: when });
  if (step.kind === 'home' && day) await patch<GigDay>('gigDays', day.id, { status: 'wrapping_up' });
}

export async function undoStep(step: TimelineStep) {
  await save<TimelineStep>('timelineSteps', { ...step, actualAt: undefined });
}

/** Set a planned time by hand (locks the step); optionally move everything after it along. */
export async function setPlanned(step: TimelineStep, iso: string, moveRest: boolean) {
  const minutes = Math.round((Date.parse(iso) - Date.parse(step.plannedAt)) / 60000);
  if (moveRest && minutes) {
    const all = alive(await db.timelineSteps.where('gigId').equals(step.gigId).toArray()) as TimelineStep[];
    for (const s of shiftSteps(all, step.id, minutes)) if (s.id !== step.id) await save<TimelineStep>('timelineSteps', s);
  }
  await save<TimelineStep>('timelineSteps', { ...step, plannedAt: iso, locked: true });
}

/** "We zijn later": the run-up to the doors moves, sets and curfew stay. */
export async function runningLate(gigId: string, minutes: number, me: MemberId) {
  const all = alive(await db.timelineSteps.where('gigId').equals(gigId).toArray()) as TimelineStep[];
  const first = all.filter((s) => !s.actualAt && LATE_KINDS.includes(s.kind)).sort((a, b) => a.plannedAt.localeCompare(b.plannedAt))[0];
  if (first) for (const s of shiftSteps(all, first.id, minutes, LATE_KINDS)) await save<TimelineStep>('timelineSteps', { ...s, locked: true });
  await addLog(gigId, 'late', { minutes }, me);
}

export async function addCustomStep(gigId: string, label: string, iso: string) {
  await save<TimelineStep>('timelineSteps', { gigId, kind: 'custom', label, plannedAt: iso, locked: true });
}

export async function toggleTask(task: DayTask, me: MemberId) {
  await save<DayTask>('dayTasks', task.done ? { ...task, done: false, doneAt: undefined, doneBy: undefined } : { ...task, done: true, doneAt: nowIso(), doneBy: me });
}

export async function addTask(gigId: string, phase: DayTask['phase'], title: string, owner: DayTask['owner']) {
  const n = (await db.dayTasks.where('gigId').equals(gigId).count());
  await save<DayTask>('dayTasks', { gigId, phase, title, owner, sort: n });
}

/** Change one music wish / special moment on the gig (App 1 data). */
export async function setWish(gigId: string, wishId: string, p: Partial<MusicWish>) {
  const gig = await db.gigs.get(gigId);
  if (!gig) return;
  await save<Gig>('gigs', { ...gig, musicWishes: gig.musicWishes.map((w) => (w.id === wishId ? { ...w, ...p } : w)) });
}

export async function addWish(gigId: string, w: Omit<MusicWish, 'id'>) {
  const gig = await db.gigs.get(gigId);
  if (!gig) return;
  await save<Gig>('gigs', { ...gig, musicWishes: [...(gig.musicWishes ?? []), { ...w, id: uid() }] });
}

export async function addVenueNote(venueId: string, gigId: string | undefined, kind: VenueNote['kind'], text: string) {
  await save<VenueNote>('venueNotes', { venueId, gigId, kind, text });
}

export async function addVenuePhoto(venueId: string, gigId: string | undefined, file: Blob, kind: 'entrance' | 'parking' | 'power' | 'stage' | 'booth' | 'other') {
  await save<VenuePhoto>('venuePhotos', { venueId, gigId, blob: file, mime: file.type || 'image/jpeg', kind });
}

// ---- wrap-up ----------------------------------------------------------------

async function markWrap(gigId: string, key: string) {
  const day = await db.gigDays.get(gigDayId(gigId));
  if (day) await patch<GigDay>('gigDays', day.id, { wrapUp: { ...(day.wrapUp ?? {}), [key]: nowIso() } });
}

export async function wrapPlayed(gig: Gig) {
  if (gig.date <= todayStr() && gig.stage === 'confirmed') {
    const steps = alive(await db.timelineSteps.where('gigId').equals(gig.id).toArray()) as TimelineStep[];
    await changeStage(gig, { to: 'played', extra: realTimes(gig, steps) });
  }
  await markWrap(gig.id, 'played');
}

/** The real start/end times from the log, kept on the gig (App 1). */
function realTimes(gig: Gig, steps: TimelineStep[]): Partial<Gig> {
  const hm = (iso?: string) => (iso ? new Date(iso).toTimeString().slice(0, 5) : undefined);
  const starts = steps.filter((s) => s.kind === 'set_start' && s.actualAt).sort((a, b) => a.actualAt!.localeCompare(b.actualAt!));
  const ends = steps.filter((s) => s.kind === 'set_end' && s.actualAt).sort((a, b) => a.actualAt!.localeCompare(b.actualAt!));
  const note = starts.length && ends.length ? `Gespeeld ${hm(starts[0].actualAt)}–${hm(ends[ends.length - 1].actualAt)}` : '';
  return note ? { notesInternal: [gig.notesInternal, note].filter(Boolean).join('\n') } : {};
}

export async function wrapTrips(gig: Gig, trips: { driver: MemberId; km: number; roundTrip: boolean }[]) {
  const venue = gig.venueId ? await db.venues.get(gig.venueId) : undefined;
  for (const t of trips) if (t.km > 0) await saveTripForGig(gig, venue, t.driver, t.km, t.roundTrip, t.driver === 'gijs' ? 'Thuis Gijs' : 'Thuis Coen');
  await markWrap(gig.id, 'trips');
}

/** Overtime for the gig from the timeline and the log. */
export async function overtimeFor(gigId: string) {
  const s = await settings();
  const steps = alive(await db.timelineSteps.where('gigId').equals(gigId).toArray()) as TimelineStep[];
  const last = steps.filter((x) => x.kind === 'set_end').sort((a, b) => b.plannedAt.localeCompare(a.plannedAt))[0];
  const logs = alive(await db.gigLogs.where('gigId').equals(gigId).toArray()) as GigLog[];
  const contract = alive(await db.contracts.where('gigId').equals(gigId).toArray()).find((c) => c.status === 'signed');
  const version = contract?.signedVersionId ? await db.contractVersions.get(contract.signedVersionId) : undefined;
  const rate = version?.snapshot.price.overtimeRate ?? contract?.overtimeRate ?? s?.overtimeRateHalfHour ?? 0;
  return overtime(last?.plannedAt, last?.actualAt, logs.filter((l) => l.type === 'overtime_request').map((l) => ({ at: l.at, minutes: l.minutes, requestedBy: l.requestedBy })), rate);
}

/** Final invoice draft from the accepted quote, plus an overtime line when overtime was requested and played. */
export async function wrapInvoice(gig: Gig): Promise<Invoice | undefined> {
  const quotes = alive(await db.quotes.where('gigId').equals(gig.id).toArray()) as Quote[];
  const q = quotes.filter((x) => x.status === 'accepted').sort((a, b) => b.version - a.version)[0];
  if (!q) return undefined;
  const hasDeposit = alive(await db.invoices.where('gigId').equals(gig.id).toArray()).some((i) => i.kind === 'deposit');
  let inv = await createInvoiceFromQuote(q, hasDeposit ? 'final' : 'standard');
  const o = await overtimeFor(gig.id);
  if (o.halfHours) {
    const s = await settings();
    inv = await save<Invoice>('invoices', { ...inv, lines: [...inv.lines, overtimeLine(o, inv.language ?? 'nl', s?.defaultVatRate ?? 0, uid())] });
  }
  await markWrap(gig.id, 'invoice');
  return inv;
}

/** Thank-you sent: recorded as a review request (stops App 1's reminder). */
export async function wrapThanks(gig: Gig) {
  await save<Review>('reviews', { gigId: gig.id, requestedAt: nowIso() });
  await markWrap(gig.id, 'thanks');
}

export const wrapMark = markWrap;

export async function closeGigDay(gigId: string) {
  await patch<GigDay>('gigDays', gigDayId(gigId), { status: 'closed', closedAt: nowIso() });
}

// ---- share the plan with the other phone ------------------------------------

/** One gig day as a small backup file (the other phone imports it; newest change wins per record). */
export async function exportPlan(gigId: string): Promise<BackupFile> {
  const tables: Record<string, unknown[]> = {
    gigDays: alive([await db.gigDays.get(gigDayId(gigId))].filter(Boolean) as GigDay[]),
    timelineSteps: await db.timelineSteps.where('gigId').equals(gigId).toArray(),
    dayTasks: await db.dayTasks.where('gigId').equals(gigId).toArray(),
    gigLogs: await db.gigLogs.where('gigId').equals(gigId).toArray(),
  };
  const gig = await db.gigs.get(gigId);
  if (gig) tables.gigs = [gig];
  if (gig?.venueId) {
    const v = await db.venues.get(gig.venueId);
    if (v) tables.venues = [v];
    tables.venueNotes = await db.venueNotes.where('venueId').equals(gig.venueId).toArray();
  }
  return { app: 'funqtion', version: 2, exportedAt: nowIso(), tables };
}

export async function importPlan(text: string) {
  return importMerge(JSON.parse(text) as BackupFile);
}

export function venueAddress(v?: Venue) {
  return v ? [v.street, [v.postcode, v.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') : '';
}
