import type { EventType } from '../../../core/types';

// MIDI to Daslight / SoundSwitch, tap tempo, the laser gate and what the live
// screen shows. Pure; the Web MIDI connection lives in ../midi.ts.

export interface MidiMsg { type: 'note' | 'cc' | 'pc'; channel: number; number: number; value: number }

const c7 = (n: number) => Math.max(0, Math.min(127, Math.round(n)));
const ch = (n: number) => Math.max(1, Math.min(16, Math.round(n))) - 1;

/** Raw MIDI bytes. A "note" press is note-on; release sends note-off. */
export function midiBytes(m: MidiMsg, phase: 'press' | 'release' = 'press'): number[] {
  if (m.type === 'cc') return [0xb0 | ch(m.channel), c7(m.number), phase === 'press' ? c7(m.value) : 0];
  if (m.type === 'pc') return phase === 'press' ? [0xc0 | ch(m.channel), c7(m.number)] : [];
  return phase === 'press' ? [0x90 | ch(m.channel), c7(m.number), c7(m.value) || 127] : [0x80 | ch(m.channel), c7(m.number), 0];
}

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export function describe(m: MidiMsg): string {
  if (m.type === 'note') return `ch${m.channel} ${NOTES[m.number % 12]}${Math.floor(m.number / 12) - 1} (${m.number})`;
  if (m.type === 'cc') return `ch${m.channel} CC${m.number}=${m.value}`;
  return `ch${m.channel} PC${m.number}`;
}

/** The same MIDI message mapped twice to one controller would trigger both. */
export function duplicateMidi<T extends { id: string; controller: string; midi?: MidiMsg }>(cues: T[]): [T, T][] {
  const out: [T, T][] = [];
  const key = (c: T) => (c.midi ? `${c.controller}|${c.midi.type}|${c.midi.channel}|${c.midi.number}|${c.midi.type === 'cc' ? c.midi.value : ''}` : '');
  for (let i = 0; i < cues.length; i++) for (let j = i + 1; j < cues.length; j++) if (key(cues[i]) && key(cues[i]) === key(cues[j])) out.push([cues[i], cues[j]]);
  return out;
}

/** BPM from tap times (ms). Uses the last 8 taps, ignores pauses > 2 s, median interval. */
export function bpmFromTaps(taps: number[]): number | null {
  const recent: number[] = [];
  for (let i = taps.length - 1; i > 0 && recent.length < 7; i--) {
    const d = taps[i] - taps[i - 1];
    if (d > 2000 || d < 200) break;
    recent.push(d);
  }
  if (recent.length < 3) return null;
  const s = [...recent].sort((a, b) => a - b);
  const med = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  return Math.round((60000 / med) * 10) / 10;
}

// ---- Laser ---------------------------------------------------------------

export const LASER_CHECKS = ['aboveHeads', 'estop', 'noReflections', 'safetyCable', 'venueOk'] as const;
export type LaserBlock = 'checklist' | 'operator_at_key' | 'crowd_without_estop' | 'crowd_without_permission' | 'crowd_not_measured';

export interface LaserState {
  checks: Record<string, boolean>;   // from the gig's packing list (app 5)
  remoteEstop: boolean;              // a remote interlock/e-stop is connected (Gijs: not yet)
  operatorAtKey: boolean;            // confirmed for this show when there is no remote e-stop
  crowdScan: boolean;
  crowdPermission?: string;
  crowdMeasured?: boolean;
}

/** May the laser cues be used? Software never replaces the hardware stop (plan §3.5). */
export function laserGate(s: LaserState): { allowed: boolean; blocks: LaserBlock[] } {
  const blocks: LaserBlock[] = [];
  const needed = LASER_CHECKS.filter((k) => k !== 'estop');
  if (needed.some((k) => !s.checks[k])) blocks.push('checklist');
  if (!s.remoteEstop && !s.operatorAtKey) blocks.push('operator_at_key');
  if (s.crowdScan) {
    if (!s.remoteEstop) blocks.push('crowd_without_estop');
    if (!s.crowdPermission?.trim()) blocks.push('crowd_without_permission');
    if (!s.crowdMeasured) blocks.push('crowd_not_measured');
  }
  return { allowed: blocks.length === 0, blocks };
}

// ---- What the live screen shows ------------------------------------------

export const SECTIONS = ['warmup', 'build', 'peak', 'cooldown', 'afterparty'] as const;
export type Section = (typeof SECTIONS)[number];

export interface CueLike { id: string; kind: 'scene' | 'moment' | 'blackout' | 'laser'; eventTypes: EventType[]; sections: Section[]; strobe?: boolean; order?: number }

/** Scenes for this event type and section; strobe cues hidden where strobe is off. */
export function visibleScenes<T extends CueLike>(cues: T[], eventType: EventType | undefined, section: Section | 'all', strobeOff: EventType[]): T[] {
  return cues
    .filter((c) => c.kind === 'scene')
    .filter((c) => !eventType || !c.eventTypes.length || c.eventTypes.includes(eventType))
    .filter((c) => section === 'all' || !c.sections.length || c.sections.includes(section))
    .filter((c) => !(c.strobe && eventType && strobeOff.includes(eventType)))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export interface StepLike { kind: string; label: string; plannedAt: string; actualAt?: string }
/** The next timeline moment within the coming hour (for the "over 10 min: eerste dans" banner). */
export function nextMoment(steps: StepLike[], now = new Date()): { label: string; inMin: number } | null {
  const t = now.getTime();
  const next = steps
    .filter((s) => ['moment', 'set_start', 'set_end', 'curfew'].includes(s.kind) && !s.actualAt)
    .map((s) => ({ s, at: new Date(s.plannedAt).getTime() }))
    .filter((x) => x.at >= t - 5 * 60_000 && x.at <= t + 60 * 60_000)
    .sort((a, b) => a.at - b.at)[0];
  return next ? { label: next.s.label, inMin: Math.round((next.at - t) / 60_000) } : null;
}

/** Hours the laser was on, from the show log (for app 5 usage counters). */
export function laserHours(log: { at: string; event: string }[]): number {
  let on: number | null = null, ms = 0;
  for (const e of [...log].sort((a, b) => a.at.localeCompare(b.at))) {
    if (e.event === 'laser_on' && on == null) on = new Date(e.at).getTime();
    if ((e.event === 'laser_off' || e.event === 'estop' || e.event === 'show_end') && on != null) { ms += new Date(e.at).getTime() - on; on = null; }
  }
  return Math.round((ms / 3600_000) * 100) / 100;
}
