import type { GigDay, Track } from '../../core/types';
import { keyScore } from '../library/domain/keys';
import { normKey, similarity } from '../library/domain/names';
import { bpmScore } from '../sets/domain/suggest';

// DJ side of Requests: match guests' requests to the library and to what's
// playing now, sort the queue, build the session from the gig day.

export interface QueueItem {
  id: string; artist: string; title: string; normKey: string; cover?: string; status: string; votes: number;
  inLibrary: boolean; priority: boolean; shoutout?: string; shoutName?: string; shoutPublic?: string; created: string;
}

export type MatchKind = 'fits_now' | 'in_library' | 'not_in_library';
export interface Matched extends QueueItem { match: MatchKind; track?: Track }

/** The library track for a request: same normalised key, else a close fuzzy match. */
export function findTrack(artist: string, title: string, tracks: Track[], byKey?: Map<string, Track>): Track | undefined {
  const k = normKey(artist, title);
  const exact = byKey ? byKey.get(k) : tracks.find((t) => normKey(t.artist, t.title) === k);
  if (exact) return exact;
  let best: { t: Track; s: number } | undefined;
  const [ka, kt] = k.split('|');
  for (const t of tracks) {
    const [ta, tt] = normKey(t.artist, t.title).split('|');
    const s = similarity(kt, tt) * (ka && ka !== '' && ka !== '?' ? 0.4 + 0.6 * similarity(ka, ta) : 0.9);
    if (s > 0.88 && (!best || s > best.s)) best = { t, s };
  }
  return best?.t;
}

/** Fits right now: in the library, tempo within ±6% (or half/double), harmonic key, energy within 2. */
export function fitsNow(t: Track, now?: Track): boolean {
  if (!now) return false;
  return bpmScore(now.bpm, t.bpm).s >= 0.6 && keyScore(now.key, t.key) >= 0.85 && (t.energy === undefined || now.energy === undefined || Math.abs(t.energy - now.energy) <= 2);
}

export function matchQueue(items: QueueItem[], tracks: Track[], now?: Track): Matched[] {
  const byKey = new Map(tracks.map((t) => [normKey(t.artist, t.title), t]));
  return items.map((i) => {
    const track = findTrack(i.artist, i.title, tracks, byKey);
    return { ...i, track, match: !track ? 'not_in_library' : fitsNow(track, now) ? 'fits_now' : 'in_library' };
  });
}

const STATUS_ORDER: Record<string, number> = { accepted: 0, new: 1, later: 2, played: 3, declined: 4, blocked: 5 };
/** Queue order: accepted first, then priority (the couple), votes, fits now, oldest first. */
export function sortQueue(items: Matched[]): Matched[] {
  return [...items].sort((a, b) =>
    (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9)
    || Number(b.priority) - Number(a.priority)
    || b.votes - a.votes
    || Number(b.match === 'fits_now') - Number(a.match === 'fits_now')
    || a.created.localeCompare(b.created));
}

/** Pause windows from Gig Day's timeline: special moments (first dance, speeches) ±. */
export function pauseWindows(steps: { kind: string; label: string; plannedAt: string }[], beforeMin = 2, afterMin = 8) {
  return steps.filter((s) => s.kind === 'moment').map((s) => ({
    from: new Date(Date.parse(s.plannedAt) - beforeMin * 60000).toISOString(),
    to: new Date(Date.parse(s.plannedAt) + afterMin * 60000).toISOString(),
    label: s.label,
  }));
}

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function sessionCode(rand: () => number = Math.random) {
  let s = 'FQ';
  for (let i = 0; i < 3; i++) s += ALPHA[Math.floor(rand() * ALPHA.length)];
  return s;
}

/** What the library tells the server: artist + title (+ id) only; no files, no paths, no tags. */
export const libraryIndex = (tracks: Track[]) =>
  tracks.filter((t) => t.status !== 'retired').map((t) => [t.artist, t.mix ? `${t.title} (${t.mix})` : t.title, t.id] as [string, string, string]);

export interface SessionRules {
  maxOpen: number; maxPerHour: number; allowShoutouts: boolean; explicitAllowed: boolean; showNowPlaying: boolean;
  pauseWindows: { from: string; to: string; label: string }[]; blocks: string[];
}
export function defaultRules(eventType: string | undefined, day?: Pick<GigDay, 'gigId'>, steps: { kind: string; label: string; plannedAt: string }[] = [], blocks: string[] = []): SessionRules {
  const family = eventType === 'wedding' || eventType === 'private_party' || eventType === 'company';
  void day;
  return { maxOpen: 3, maxPerHour: 10, allowShoutouts: true, explicitAllowed: !family, showNowPlaying: false, pauseWindows: pauseWindows(steps), blocks };
}
