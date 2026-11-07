import type { CrowdType, EventType, MemberId, SetSection, SetTemplate, Track } from '../../../core/types';
import { keyScore, shiftedKey } from '../../library/domain/keys';
import { normKey } from '../../library/domain/names';

// Next-track suggestions: an explainable score per candidate (every part shows
// as a chip), hard filters, and a small beam search to fill a section.

export interface Weights { key: number; bpm: number; energy: number; crowd: number; learned: number }
export const DEFAULT_WEIGHTS: Weights = { key: 0.3, bpm: 0.25, energy: 0.2, crowd: 0.1, learned: 0.1 };

export type Cand = Pick<Track, 'id' | 'artist' | 'title' | 'bpm' | 'key' | 'energy' | 'crowd' | 'flags' | 'durationS' | 'source'> & { stream?: Track['stream'] };

/** BPM fit: ±3% 1, ±6% 0.6, half/double time 0.7, else 0 (and a pitch % to match). */
export function bpmScore(from?: number, to?: number): { s: number; pitch: number } {
  if (!from || !to) return { s: 0.5, pitch: 0 };
  const opts = [to, to * 2, to / 2].map((b) => ({ b, d: (from - b) / b }));
  const best = opts.sort((a, b) => Math.abs(a.d) - Math.abs(b.d))[0];
  const pct = Math.abs(best.d) * 100;
  const halfDouble = best.b !== to;
  const s = pct <= 3 ? 1 : pct <= 6 ? 0.6 : pct <= 8 ? 0.3 : 0;
  return { s: halfDouble ? Math.min(s, 0.7) : s, pitch: Math.round(best.d * 1000) / 10 };
}

/** Energy fit against the target at this point of the curve; small steps up in a build. */
export function energyScore(prev?: number, cand?: number, target?: number): number {
  if (cand === undefined) return 0.4;
  const t = target ?? prev ?? cand;
  const dist = Math.abs(cand - t);
  let s = Math.max(0, 1 - dist / 4);
  if (prev !== undefined && cand - prev > 2) s *= 0.5; // no big jumps unless planned
  return s;
}

export const crowdFor = (e: EventType): CrowdType[] =>
  e === 'wedding' ? ['wedding'] : e === 'village_festival' || e === 'carnival' ? ['village_festival'] : e === 'club' || e === 'festival' ? ['club', 'after_party'] : e === 'company' ? ['company'] : ['private', 'wedding'];

export interface Learned {
  /** reaction score per track for this event type, 0–1 (from play history) */
  track: Map<string, number>;
  /** A→B transitions that worked ("from|to" → 0–1) */
  pair: Map<string, number>;
  /** times requested */
  requested: Map<string, number>;
}
export const NO_LEARNING: Learned = { track: new Map(), pair: new Map(), requested: new Map() };

export interface Context {
  prev?: Cand;
  section?: Pick<SetSection, 'energyFrom' | 'energyTo' | 'bpmMin' | 'bpmMax'>;
  /** 0–1: how far into the section (for the energy target) */
  progress?: number;
  eventType?: EventType;
  explicitAllowed?: boolean;
  blocked?: Set<string>;               // normKeys + "artist:<name>"
  usedIds?: Set<string>;
  recentArtists?: string[];            // last hour, newest last
  lastGigIds?: Set<string>;            // played for this client/venue last time
  weights?: Weights;
  learned?: Learned;
}

export interface Scored { track: Cand; score: number; reasons: { k: string; v: string; good: boolean }[]; pitch: number }

export function isBlocked(t: Cand, blocked?: Set<string>): boolean {
  if (!blocked?.size) return false;
  if (blocked.has(normKey(t.artist, t.title))) return true;
  return t.artist.toLowerCase().split(/\s*(?:,|&| x | feat\.? | vs\.? )\s*/).some((a) => blocked.has(`artist:${a.trim()}`));
}

export function score(c: Cand, ctx: Context): Scored | null {
  const w = ctx.weights ?? DEFAULT_WEIGHTS;
  if (ctx.usedIds?.has(c.id) || isBlocked(c, ctx.blocked)) return null;
  if (ctx.explicitAllowed === false && c.flags.includes('explicit')) return null;
  const reasons: Scored['reasons'] = [];
  const prev = ctx.prev;
  // BPM: the section's range, then the step from the previous track
  const sec = ctx.section;
  if (sec?.bpmMin && c.bpm && c.bpm < sec.bpmMin * 0.97 && c.bpm * 2 > (sec.bpmMax ?? 200)) return null;
  const b = bpmScore(prev?.bpm, c.bpm);
  // Key at the tempo it'll be played at (keylock off)
  const k = prev ? keyScore(shiftedKey(prev.key, 0), shiftedKey(c.key, b.pitch)) : 0.5;
  const target = sec ? sec.energyFrom + (sec.energyTo - sec.energyFrom) * (ctx.progress ?? 0) : undefined;
  const e = energyScore(prev?.energy, c.energy, target);
  const crowd = ctx.eventType ? (c.crowd.some((x) => crowdFor(ctx.eventType!).includes(x)) ? 1 : c.crowd.length ? 0.2 : 0.5) : 0.5;
  const L = ctx.learned ?? NO_LEARNING;
  const learnedTrack = L.track.get(c.id) ?? 0.5;
  const learnedPair = prev ? L.pair.get(`${prev.id}|${c.id}`) : undefined;
  const learned = learnedPair !== undefined ? 0.5 * learnedTrack + 0.5 * learnedPair : learnedTrack;
  let s = w.key * k + w.bpm * b.s + w.energy * e + w.crowd * crowd + w.learned * learned;
  // variety penalties
  const recent = ctx.recentArtists ?? [];
  if (recent.some((a) => a.toLowerCase() === c.artist.toLowerCase())) { s -= 0.15; reasons.push({ k: 'artist', v: c.artist, good: false }); }
  if (ctx.lastGigIds?.has(c.id)) { s -= 0.08; reasons.push({ k: 'lastTime', v: '', good: false }); }
  const req = L.requested.get(c.id);
  if (req) { s += Math.min(0.1, req * 0.02); reasons.push({ k: 'requested', v: String(req), good: true }); }
  if (prev?.key && c.key) reasons.unshift({ k: 'key', v: `${prev.key}→${c.key}`, good: k >= 0.85 });
  if (prev?.bpm && c.bpm) reasons.unshift({ k: 'bpm', v: `${b.pitch > 0 ? '+' : ''}${b.pitch}%`, good: b.s >= 0.6 });
  if (c.energy !== undefined && prev?.energy !== undefined) reasons.push({ k: 'energy', v: c.energy > prev.energy ? '↑' : c.energy < prev.energy ? '↓' : '=', good: e >= 0.6 });
  if (learnedPair !== undefined && learnedPair > 0.6) reasons.push({ k: 'worked', v: '', good: true });
  if (crowd === 1) reasons.push({ k: 'crowd', v: '', good: true });
  return { track: c, score: Math.round(s * 1000) / 1000, reasons, pitch: b.pitch };
}

export function suggest(pool: Cand[], ctx: Context, n = 8): Scored[] {
  return pool.map((c) => score(c, ctx)).filter((x): x is Scored => !!x).sort((a, b) => b.score - a.score).slice(0, n);
}

/**
 * Fill `count` tracks after `start` with a beam search (width 5): the best
 * chain overall, not just the best next track. Never auto-applied: the planner
 * shows it as a proposal.
 */
export function fillChain(pool: Cand[], start: Cand | undefined, count: number, ctx: Omit<Context, 'prev' | 'progress'>, width = 5): Cand[] {
  type Beam = { chain: Cand[]; total: number };
  let beams: Beam[] = [{ chain: [], total: 0 }];
  for (let i = 0; i < count; i++) {
    const next: Beam[] = [];
    for (const beam of beams) {
      const prev = beam.chain[beam.chain.length - 1] ?? start;
      const used = new Set([...(ctx.usedIds ?? []), ...beam.chain.map((c) => c.id)]);
      const recent = [...(ctx.recentArtists ?? []), ...beam.chain.slice(-4).map((c) => c.artist)];
      for (const s of suggest(pool, { ...ctx, prev, usedIds: used, recentArtists: recent, progress: count > 1 ? i / (count - 1) : 1 }, width)) {
        next.push({ chain: [...beam.chain, s.track], total: beam.total + s.score });
      }
    }
    if (!next.length) break;
    beams = next.sort((a, b) => b.total - a.total).slice(0, width);
  }
  return beams[0]?.chain ?? [];
}

// ---- energy curve -------------------------------------------------------------

export interface CurvePoint { atMin: number; energy?: number; target: number; performer?: MemberId | 'b2b' }

/** Planned energy over time vs the template's target (per item, using track lengths). */
export function energyCurve(sections: SetSection[], items: { sectionId: string; trackId: string; performer?: MemberId }[], tracks: Map<string, Cand>): CurvePoint[] {
  const pts: CurvePoint[] = [];
  let t = 0;
  for (const s of sections) {
    const its = items.filter((i) => i.sectionId === s.id);
    const total = its.reduce((a, i) => a + (tracks.get(i.trackId)?.durationS ?? 240) / 60, 0) || s.minutes;
    let inSec = 0;
    if (!its.length) pts.push({ atMin: t, target: s.energyFrom, performer: s.performer }, { atMin: t + s.minutes, target: s.energyTo, performer: s.performer });
    for (const i of its) {
      const tr = tracks.get(i.trackId);
      const p = total ? inSec / total : 0;
      pts.push({ atMin: t + inSec, energy: tr?.energy, target: s.energyFrom + (s.energyTo - s.energyFrom) * p, performer: i.performer ?? s.performer });
      inSec += (tr?.durationS ?? 240) / 60;
    }
    t += Math.max(s.minutes, inSec);
  }
  return pts;
}

/** Where the plan deviates: target − energy ≥ 3 for 2+ tracks in a row (dip) or an early peak. */
export function curveWarnings(pts: CurvePoint[]): { atMin: number; kind: 'dip' | 'early_peak' }[] {
  const out: { atMin: number; kind: 'dip' | 'early_peak' }[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (a.energy !== undefined && b.energy !== undefined && a.target - a.energy >= 3 && b.target - b.energy >= 3) out.push({ atMin: a.atMin, kind: 'dip' });
    if (b.energy !== undefined && b.energy - b.target >= 3) out.push({ atMin: b.atMin, kind: 'early_peak' });
  }
  return out.filter((w, i, arr) => i === 0 || arr[i - 1].atMin !== w.atMin);
}

// ---- learning from play history -----------------------------------------------

export interface PlayLike { trackId?: string; at: string; reaction?: 'fire' | 'good' | 'meh' | 'empty'; gigId?: string }
const REACTION: Record<string, number> = { fire: 1, good: 0.75, meh: 0.35, empty: 0 };

/**
 * Per-track reaction score for an event type (Bayesian: one 🔥 doesn't dominate)
 * and per-transition scores from consecutive plays at the same gig.
 */
export function learn(plays: PlayLike[], gigType: Map<string, EventType>, eventType: EventType | undefined, requests: Map<string, number> = new Map()): Learned {
  const sums = new Map<string, { s: number; n: number }>();
  const pairs = new Map<string, { s: number; n: number }>();
  const byGig = new Map<string, PlayLike[]>();
  for (const p of plays) {
    if (!p.trackId) continue;
    if (eventType && p.gigId && gigType.get(p.gigId) !== eventType) continue;
    const r = p.reaction ? REACTION[p.reaction] : 0.6; // played without a reaction = slightly positive
    const cur = sums.get(p.trackId) ?? { s: 0, n: 0 };
    sums.set(p.trackId, { s: cur.s + r, n: cur.n + 1 });
    if (p.gigId) byGig.set(p.gigId, [...(byGig.get(p.gigId) ?? []), p]);
  }
  for (const list of byGig.values()) {
    const s = [...list].sort((a, b) => a.at.localeCompare(b.at));
    for (let i = 1; i < s.length; i++) {
      if (!s[i].reaction) continue;
      const k = `${s[i - 1].trackId}|${s[i].trackId}`;
      const cur = pairs.get(k) ?? { s: 0, n: 0 };
      pairs.set(k, { s: cur.s + REACTION[s[i].reaction!], n: cur.n + 1 });
    }
  }
  const prior = 0.5, weight = 2;
  const bayes = (x: { s: number; n: number }) => (x.s + prior * weight) / (x.n + weight);
  return {
    track: new Map([...sums].map(([k, v]) => [k, bayes(v)])),
    pair: new Map([...pairs].filter(([, v]) => v.n >= 2).map(([k, v]) => [k, bayes(v)])),
    requested: requests,
  };
}

// ---- templates ----------------------------------------------------------------

type Sec = SetTemplate['sections'][number];
const sec = (kind: Sec['kind'], label: string, minutes: number, energyFrom: number, energyTo: number, bpmMin?: number, bpmMax?: number): Sec => ({ kind, label, minutes, energyFrom, energyTo, bpmMin, bpmMax });

/** Seeded templates (Gijs: "ok"); editable in Sets → Templates. */
export const DEFAULT_SET_TEMPLATES: Pick<SetTemplate, 'key' | 'name' | 'eventTypes' | 'sections' | 'rules' | 'active'>[] = [
  { key: 'wedding', name: 'Bruiloft', eventTypes: ['wedding'], active: true, rules: { maxSameArtistPerHour: 1, explicitAllowed: false }, sections: [
    sec('moment', 'Openingsdans', 5, 3, 3), sec('warmup', 'Opwarmen: iedereen erbij', 45, 4, 6, 95, 124), sec('build', 'Opbouw', 45, 6, 8, 115, 128),
    sec('peak', 'Piek', 75, 8, 9, 120, 132), sec('classics', 'Late klassiekers & meezingers', 45, 8, 8), sec('cooldown', 'Afsluiten', 20, 7, 5), sec('moment', 'Laatste nummer', 5, 6, 6),
  ] },
  { key: 'village_festival', name: 'Dorpsfeest / kermis', eventTypes: ['village_festival', 'carnival'], active: true, rules: { maxSameArtistPerHour: 2, explicitAllowed: true }, sections: [
    sec('warmup', 'Binnenkomst', 45, 4, 6, 100, 128), sec('build', 'Opbouw met meezingers', 60, 6, 8), sec('peak', 'Piek: feest', 90, 8, 10), sec('classics', 'Hollandse hits', 45, 8, 9), sec('cooldown', 'Uitzwaaien', 20, 7, 6),
  ] },
  { key: 'club', name: 'Club', eventTypes: ['club', 'festival'], active: true, rules: { maxSameArtistPerHour: 1, explicitAllowed: true }, sections: [
    sec('warmup', 'Warm-up', 60, 4, 6, 118, 124), sec('build', 'Opbouw', 45, 6, 8, 122, 126), sec('peak', 'Piek', 75, 8, 10, 124, 130), sec('afterparty', 'Late night', 30, 7, 6, 120, 126),
  ] },
  { key: 'private', name: 'Privéfeest', eventTypes: ['private_party', 'other'], active: true, rules: { maxSameArtistPerHour: 1, explicitAllowed: false }, sections: [
    sec('warmup', 'Ontvangst', 45, 3, 5), sec('build', 'Opbouw', 45, 5, 7), sec('peak', 'Feest', 90, 7, 9), sec('cooldown', 'Afsluiten', 20, 6, 5),
  ] },
  { key: 'company', name: 'Bedrijfsfeest', eventTypes: ['company'], active: true, rules: { maxSameArtistPerHour: 1, explicitAllowed: false }, sections: [
    sec('dinner', 'Borrel / diner', 60, 2, 4, 90, 118), sec('build', 'Opbouw', 45, 5, 7), sec('peak', 'Feest', 75, 7, 9), sec('cooldown', 'Afsluiten', 15, 6, 5),
  ] },
];
