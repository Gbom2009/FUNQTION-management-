import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../core/db';
import { alive, nowIso, patch, save } from '../../core/repo';
import { DEFAULT_LIGHT, type PackList, type LightCue, type LightFixture, type LightLog, type LightSettings, type LightShow, type MemberId, type Settings } from '../../core/types';
import { laserGate, midiBytes, type LaserState } from './domain/live';
import { sendMidi } from './midi';

const EMPTY: never[] = [];
export const useFixtures = () => alive(useLiveQuery(() => db.lightFixtures.toArray(), []) ?? EMPTY) as LightFixture[];
export const useCues = () => (alive(useLiveQuery(() => db.lightCues.toArray(), []) ?? EMPTY) as LightCue[]).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
export const useShows = () => (alive(useLiveQuery(() => db.lightShows.toArray(), []) ?? EMPTY) as LightShow[]).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
export const useShowLog = (showId?: string) => (alive(useLiveQuery(() => (showId ? db.lightLogs.where('showId').equals(showId).toArray() : []), [showId]) ?? EMPTY) as LightLog[]).sort((a, b) => b.at.localeCompare(a.at));

export const lightSettings = (s?: Partial<Settings>): LightSettings => ({ ...DEFAULT_LIGHT, ...(s?.light ?? {}) });

type NewCue = Omit<LightCue, 'id' | 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>;
const note = (channel: number, number: number) => ({ type: 'note' as const, channel, number, value: 127 });

/**
 * Starting set. Notes are suggestions: map the same notes in SoundSwitch
 * (channel 1: all lights) and Daslight (channel 2: laser only) with their MIDI learn.
 */
export const DEFAULT_CUES: NewCue[] = [
  { label: 'Blackout', kind: 'blackout', controller: 'soundswitch', midi: note(1, 36), eventTypes: [], sections: [], order: 0 },
  { label: 'DROP', kind: 'moment', moment: 'drop', controller: 'soundswitch', midi: note(1, 37), hold: true, eventTypes: [], sections: [], order: 1, colour: '#f68712' },
  { label: 'Strobe', kind: 'moment', moment: 'strobe', controller: 'soundswitch', midi: note(1, 38), hold: true, strobe: true, eventTypes: [], sections: [], order: 2, colour: '#f0f0f0' },
  { label: 'Eerste dans', kind: 'moment', moment: 'first_dance', controller: 'soundswitch', midi: note(1, 39), eventTypes: ['wedding'], sections: [], order: 3, colour: '#e8b84a' },
  { label: 'Binnenkomst', kind: 'moment', moment: 'entrance', controller: 'soundswitch', midi: note(1, 40), eventTypes: [], sections: [], order: 4, colour: '#c09cff' },
  { label: 'Countdown', kind: 'moment', moment: 'countdown', controller: 'soundswitch', midi: note(1, 41), eventTypes: [], sections: [], order: 5, colour: '#ff7a7a' },
  { label: 'Laatste nummer', kind: 'moment', moment: 'last_song', controller: 'soundswitch', midi: note(1, 42), eventTypes: [], sections: [], order: 6, colour: '#6cb2ff' },
  { label: 'Warm-up', kind: 'scene', controller: 'soundswitch', midi: note(1, 48), eventTypes: [], sections: ['warmup'], order: 10, colour: '#e8b84a' },
  { label: 'Opbouw', kind: 'scene', controller: 'soundswitch', midi: note(1, 49), eventTypes: [], sections: ['build'], order: 11, colour: '#f68712' },
  { label: 'Piek', kind: 'scene', controller: 'soundswitch', midi: note(1, 50), eventTypes: [], sections: ['peak'], order: 12, colour: '#ff7a7a' },
  { label: 'Rustig', kind: 'scene', controller: 'soundswitch', midi: note(1, 51), eventTypes: [], sections: ['cooldown'], order: 13, colour: '#6cb2ff' },
  { label: 'Funqtion oranje', kind: 'scene', controller: 'soundswitch', midi: note(1, 52), eventTypes: [], sections: [], order: 14, colour: '#f68712' },
  { label: 'Carnaval', kind: 'scene', controller: 'soundswitch', midi: note(1, 53), eventTypes: ['carnival'], sections: [], order: 15, colour: '#4fd17a' },
  { label: 'Laser aan (boven hoofden)', kind: 'laser', laserRole: 'on', controller: 'daslight', midi: note(2, 60), eventTypes: [], sections: [], order: 20 },
  { label: 'Laser uit', kind: 'laser', laserRole: 'off', controller: 'daslight', midi: note(2, 61), eventTypes: [], sections: [], order: 21 },
];

export async function seedCues() {
  if ((await db.lightCues.filter((c) => !c.deletedAt).count()) > 0) return 0;
  for (const c of DEFAULT_CUES) await save<LightCue>('lightCues', c);
  return DEFAULT_CUES.length;
}

async function settings(): Promise<Partial<Settings>> { return (await db.settings.get('settings')) ?? {}; }

export async function log(show: LightShow | undefined, event: LightLog['event'], detail?: string) {
  if (!show) return;
  await save<LightLog>('lightLogs', { showId: show.id, gigId: show.gigId, at: nowIso(), event, detail });
}

export async function startShow(gigId: string | undefined, me: MemberId): Promise<LightShow> {
  let checks: Record<string, boolean> = {};
  let crowdScan = false, crowdPermission: string | undefined;
  if (gigId) {
    const list = await db.packLists.where('gigId').equals(gigId).first();
    if (list?.laser) { checks = { ...list.laser.checks }; crowdScan = list.laser.crowdScan; crowdPermission = list.laser.permissionBy; }
  }
  const show = await save<LightShow>('lightShows', { gigId, startedAt: nowIso(), operator: me, checks, crowdScan, crowdPermission });
  await log(show, 'show_start');
  return show;
}

export async function endShow(show: LightShow) {
  await stopLaser(show, 'show_end');
  await log(show, 'show_end');
  return patch<LightShow>('lightShows', show.id, { endedAt: nowIso() });
}

/** The laser checklist lives on the gig's packing list (app 5) as well; keep both in step. */
export async function setShowLaser(show: LightShow, c: Partial<Pick<LightShow, 'checks' | 'crowdScan' | 'crowdPermission' | 'crowdMeasured' | 'operatorAtKey'>>) {
  const next = await patch<LightShow>('lightShows', show.id, c);
  if (show.gigId && (c.checks || c.crowdScan !== undefined || c.crowdPermission !== undefined)) {
    const list = await db.packLists.where('gigId').equals(show.gigId).first();
    if (list) await patch<PackList>('packLists', list.id, { laser: { checks: next?.checks ?? {}, crowdScan: !!next?.crowdScan, permissionBy: next?.crowdPermission, at: nowIso() } });
  }
  return next;
}

export function laserStateOf(show: LightShow | undefined, s: LightSettings): LaserState {
  return { checks: show?.checks ?? {}, remoteEstop: s.remoteEstop, operatorAtKey: !!show?.operatorAtKey, crowdScan: !!show?.crowdScan, crowdPermission: show?.crowdPermission, crowdMeasured: show?.crowdMeasured };
}

export type FireResult = 'sent' | 'no_midi' | 'no_mapping' | 'laser_blocked';

/** Send a cue. Laser cues and scenes that use the laser go through the laser gate. */
export async function fire(cue: LightCue, show: LightShow | undefined, phase: 'press' | 'release' = 'press'): Promise<FireResult> {
  const s = lightSettings(await settings());
  const turnsLaserOn = (cue.kind === 'laser' && cue.laserRole === 'on') || cue.usesLaser;
  if (phase === 'press' && turnsLaserOn && !laserGate(laserStateOf(show, s)).allowed) return 'laser_blocked';
  if (!cue.midi) return 'no_mapping';
  const ok = sendMidi(s.midiOutput, midiBytes(cue.midi, phase));
  if (phase === 'release') return ok ? 'sent' : 'no_midi';
  if (!ok) { await log(show, 'midi_error', cue.label); return 'no_midi'; }
  const ev = cue.kind === 'laser' ? (cue.laserRole === 'on' ? 'laser_on' : 'laser_off') : cue.kind === 'blackout' ? 'blackout' : cue.kind === 'moment' ? 'moment' : 'cue';
  await log(show, ev, cue.label);
  if (cue.usesLaser) await log(show, 'laser_on', cue.label);
  return 'sent';
}

/** LASER STOP: every "laser off" cue, logged. The hardware key/e-stop stays the real stop. */
export async function stopLaser(show: LightShow | undefined, event: 'estop' | 'show_end' = 'estop'): Promise<{ sent: number; mapped: number }> {
  const s = lightSettings(await settings());
  const offs = alive(await db.lightCues.toArray()).filter((c) => c.kind === 'laser' && c.laserRole === 'off' && c.midi);
  let sent = 0;
  for (const c of offs) if (sendMidi(s.midiOutput, midiBytes(c.midi!))) sent++;
  if (event === 'estop') await log(show, 'estop', `${sent}/${offs.length}`);
  return { sent, mapped: offs.length };
}

export async function markTested(cue: LightCue) { return patch<LightCue>('lightCues', cue.id, { testedAt: nowIso() }); }
