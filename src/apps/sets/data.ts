import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../core/db';
import { alive, nowIso, save, uid } from '../../core/repo';
import type { EventType, Gig, MemberId, Play, RequestStat, SetItem, SetPlan, SetSection, SetTemplate, Track, TrackFile } from '../../core/types';
import { normKey, similarity } from '../library/domain/names';
import { readSession } from '../library/domain/serato';
import { DEFAULT_SET_TEMPLATES, learn, type Learned } from './domain/suggest';

const EMPTY: never[] = [];
export const useSetPlans = () => (alive(useLiveQuery(() => db.setPlans.toArray(), []) ?? EMPTY) as SetPlan[]).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
export const useSetPlan = (id?: string) => useLiveQuery(() => (id ? db.setPlans.get(id) : undefined), [id]);
export const useSetTemplates = () => (alive(useLiveQuery(() => db.setTemplates.toArray(), []) ?? EMPTY) as SetTemplate[]).sort((a, b) => a.name.localeCompare(b.name));
export const usePlays = (gigId?: string) =>
  (alive(useLiveQuery(() => (gigId ? db.plays.where('gigId').equals(gigId).toArray() : db.plays.toArray()), [gigId]) ?? EMPTY) as Play[]).sort((a, b) => a.at.localeCompare(b.at));

export async function ensureSetTemplates() {
  for (const tp of DEFAULT_SET_TEMPLATES) {
    if (!(await db.setTemplates.where('key').equals(tp.key).first())) await save<SetTemplate>('setTemplates', { ...tp, id: `st-${tp.key}` }, { actor: 'system' });
  }
}

export async function templateFor(eventType?: EventType): Promise<SetTemplate | undefined> {
  await ensureSetTemplates();
  const all = alive(await db.setTemplates.toArray()) as SetTemplate[];
  return all.find((t) => t.active && eventType && t.eventTypes.includes(eventType)) ?? all.find((t) => t.key === 'private');
}

/** "Artist - Title" or "Title" from a music wish → the best library match (or none). */
export function matchWish(text: string, tracks: Track[]): Track | undefined {
  const [a, ...rest] = text.split(/\s+[-–]\s+/);
  const artist = rest.length ? a : '';
  const title = rest.length ? rest.join(' - ') : text;
  const key = normKey(artist, title);
  const exact = tracks.find((t) => normKey(t.artist, t.title) === key);
  if (exact) return exact;
  const t0 = normKey('', title).slice(1);
  let best: { t: Track; s: number } | undefined;
  for (const t of tracks) {
    const s = similarity(normKey('', t.title).slice(1), t0) * (artist ? 0.5 + 0.5 * similarity(normKey(t.artist, '').split('|')[0], normKey(artist, '').split('|')[0]) : 1);
    if (s > 0.85 && (!best || s > best.s)) best = { t, s };
  }
  return best?.t;
}

/** Do-not-play wish → block key: "Artist - Title" blocks the song, a bare name blocks the artist. */
export function blockKey(text: string): string {
  const [a, ...rest] = text.split(/\s+[-–]\s+/);
  return rest.length ? normKey(a, rest.join(' - ')) : `artist:${text.trim().toLowerCase()}`;
}

/**
 * A set plan for a gig: the event type's template, performers from the gig's
 * set slots (Gijs / Coen / B2B), must-plays and special moments matched to the
 * library, do-not-plays as blocks.
 */
export async function createPlanForGig(gigId: string): Promise<SetPlan> {
  const existing = alive(await db.setPlans.where('gigId').equals(gigId).toArray())[0] as SetPlan | undefined;
  if (existing) return existing;
  const gig = (await db.gigs.get(gigId)) as Gig;
  const tp = await templateFor(gig.eventType);
  const tracks = alive(await db.musicTracks.toArray()) as Track[];
  const slots = [...(gig.setSlots ?? [])].sort((a, b) => a.start.localeCompare(b.start));
  const perf = (i: number): SetSection['performer'] => {
    if (!slots.length) return gig.performers.length > 1 ? 'b2b' : gig.performers[0];
    const s = slots[Math.min(slots.length - 1, Math.floor((i / Math.max(1, (tp?.sections.length ?? 1))) * slots.length))];
    return s.performers.length > 1 ? 'b2b' : s.performers[0];
  };
  const sections: SetSection[] = (tp?.sections ?? []).map((s, i) => ({ ...s, id: uid(), performer: perf(i) }));
  const items: SetItem[] = [];
  const firstMain = sections.find((s) => s.kind === 'peak') ?? sections.find((s) => s.kind !== 'moment') ?? sections[0];
  const momentSecs = sections.filter((s) => s.kind === 'moment');
  let mi = 0;
  for (const w of gig.musicWishes ?? []) {
    if (w.kind === 'must_play') {
      const t = matchWish(w.text, tracks);
      if (t && firstMain) items.push({ id: uid(), sectionId: firstMain.id, trackId: t.id, role: 'must_play', note: w.text });
    } else if (w.kind === 'special_moment' && w.track) {
      const t = matchWish(w.track, tracks);
      const sec = momentSecs[mi++] ?? firstMain;
      if (t && sec) items.push({ id: uid(), sectionId: sec.id, trackId: t.id, role: 'moment', momentWishId: w.id, note: w.text, locked: true });
    }
  }
  const blocked = (gig.musicWishes ?? []).filter((w) => w.kind === 'do_not_play').map((w) => blockKey(w.text));
  return save<SetPlan>('setPlans', { name: gig.title, gigId, templateKey: tp?.key, status: 'draft', sections, items, blocked });
}

export async function createPlan(name: string, templateKey: string): Promise<SetPlan> {
  await ensureSetTemplates();
  const tp = (await db.setTemplates.where('key').equals(templateKey).first()) as SetTemplate | undefined;
  return save<SetPlan>('setPlans', { name, templateKey, status: 'draft', sections: (tp?.sections ?? []).map((s) => ({ ...s, id: uid() })), items: [], blocked: [] });
}

export const savePlan = (p: SetPlan) => save<SetPlan>('setPlans', p);

export function addItems(p: SetPlan, sectionId: string, trackIds: string[], role: SetItem['role'] = 'planned'): SetPlan {
  const add = [...new Set(trackIds)].filter((id) => !p.items.some((i) => i.trackId === id)).map((trackId) => ({ id: uid(), sectionId, trackId, role }));
  const idx = p.items.map((i) => i.sectionId).lastIndexOf(sectionId);
  const items = [...p.items];
  items.splice(idx >= 0 ? idx + 1 : items.length, 0, ...add);
  return { ...p, items };
}

export function moveItem(p: SetPlan, itemId: string, dir: -1 | 1): SetPlan {
  const items = [...p.items];
  const i = items.findIndex((x) => x.id === itemId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= items.length) return p;
  if (items[j].sectionId !== items[i].sectionId) { items[i] = { ...items[i], sectionId: items[j].sectionId }; return { ...p, items }; }
  [items[i], items[j]] = [items[j], items[i]];
  return { ...p, items };
}

/** Learned scores for an event type from all play history and request counts. */
export async function learnedFor(eventType?: EventType): Promise<Learned> {
  const plays = alive(await db.plays.toArray()) as Play[];
  const gigs = alive(await db.gigs.toArray()) as Gig[];
  const req = new Map<string, number>();
  for (const r of alive(await db.requestStats.toArray()) as RequestStat[]) if (r.trackId) req.set(r.trackId, (req.get(r.trackId) ?? 0) + Math.max(1, r.votes));
  return learn(plays, new Map(gigs.map((g) => [g.id, g.eventType])), eventType, req);
}

// ---- live: what's really played ------------------------------------------------

export async function recordPlay(p: { gigId?: string; setPlanId?: string; trackId?: string; rawArtist?: string; rawTitle?: string; performer?: MemberId; source: Play['source']; requestId?: string; at?: string }) {
  return save<Play>('plays', { ...p, at: p.at ?? nowIso() });
}

export async function setReaction(play: Play, reaction: Play['reaction']) {
  return save<Play>('plays', { ...play, reaction: play.reaction === reaction ? undefined : reaction });
}

/**
 * Import a Serato history session (after the gig): each loaded track becomes a
 * play, matched by file path or artist/title. Plays already logged within two
 * minutes of the same track are not duplicated.
 */
export async function importSeratoHistory(bytes: Uint8Array, gigId?: string): Promise<{ added: number; matched: number; skipped: number }> {
  const rows = readSession(bytes);
  const files = alive(await db.trackFiles.toArray()) as TrackFile[];
  const tracks = alive(await db.musicTracks.toArray()) as Track[];
  const existing = alive(gigId ? await db.plays.where('gigId').equals(gigId).toArray() : await db.plays.toArray()) as Play[];
  const res = { added: 0, matched: 0, skipped: 0 };
  for (const r of rows) {
    const at = r.startedAt ? new Date(r.startedAt * 1000).toISOString() : undefined;
    if (!at) { res.skipped++; continue; }
    const byPath = r.path ? files.find((f) => r.path!.endsWith(`/${f.path}`) || r.path === f.path) : undefined;
    const t = byPath ? tracks.find((x) => x.id === byPath.trackId) : r.artist || r.title ? tracks.find((x) => normKey(x.artist, x.title) === normKey(r.artist ?? '', r.title ?? '')) : undefined;
    if (existing.some((p) => (t ? p.trackId === t.id : p.rawTitle === r.title) && Math.abs(Date.parse(p.at) - Date.parse(at)) < 120000)) { res.skipped++; continue; }
    await recordPlay({ gigId, trackId: t?.id, rawArtist: t ? undefined : r.artist, rawTitle: t ? undefined : r.title, source: 'serato_history', at });
    res.added++;
    if (t) res.matched++;
  }
  return res;
}
