import { useLiveQuery } from 'dexie-react-hooks';
import { parseBuffer } from 'music-metadata';
import { db } from '../../core/db';
import { alive, nowIso, save, uid } from '../../core/repo';
import type { CrowdType, Mood, MusicLocation, Track, TrackFile, TrackFlag, TrackSource, Artwork } from '../../core/types';
import { CROWD_TYPES, MOODS, TRACK_FLAGS } from '../../core/types';
import { audioRange, commentText, decodeComment, encodeComment, readId3, writeId3 } from './domain/id3';
import { toCamelot } from './domain/keys';
import { cleanFields, normKey } from './domain/names';
import { readMarkers2 } from './domain/serato';
import { cutoffHz, detectBpm, detectKey, excerpt, judgeQuality, suggestEnergy } from './domain/analysis';
import { extOf, type FileSource } from './fs';

const EMPTY: never[] = [];
export const useTracks = () => alive(useLiveQuery(() => db.musicTracks.toArray(), []) ?? EMPTY) as Track[];
export const useTrackFiles = () => alive(useLiveQuery(() => db.trackFiles.toArray(), []) ?? EMPTY) as TrackFile[];
export const useLocations = () => alive(useLiveQuery(() => db.musicLocations.toArray(), []) ?? EMPTY) as MusicLocation[];

const MIME: Record<string, string> = { mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', wav: 'audio/wav', aiff: 'audio/aiff', aif: 'audio/aiff', ogg: 'audio/ogg', opus: 'audio/ogg' };

async function sha256(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Where a file probably came from, from its path (you can change it). */
export function guessSource(path: string): TrackSource {
  const p = path.toLowerCase();
  if (/soundcloud|scdl|download/.test(p)) return 'download';
  if (/convert|converted|cdj/.test(p)) return 'converted';
  if (/cd ?rip|eac|\bcd\d?\b/.test(p)) return 'cd_rip';
  if (/promo/.test(p)) return 'promo';
  if (/own|eigen|edit|bootleg/.test(p)) return 'own_production';
  return 'unknown';
}

const WORD_MAP: Record<string, CrowdType | Mood | TrackFlag> = {
  BRUILOFT: 'wedding', WEDDING: 'wedding', DORPSFEEST: 'village_festival', 'VILLAGE-FESTIVAL': 'village_festival', KERMIS: 'village_festival',
  CLUB: 'club', AFTERPARTY: 'after_party', 'AFTER-PARTY': 'after_party', PRIVE: 'private', PRIVATE: 'private', BEDRIJF: 'company', COMPANY: 'company', KIDS: 'kids', KINDEREN: 'kids',
  FEELGOOD: 'feelgood', EUPHORIC: 'euphoric', EUFORISCH: 'euphoric', DARK: 'dark', DONKER: 'dark', EMOTIONAL: 'emotional', EMOTIONEEL: 'emotional', PARTY: 'party', CHILL: 'chill',
  CLASSIC: 'classic', KLASSIEKER: 'classic', BANGER: 'banger', SINGALONG: 'singalong', MEEZINGER: 'singalong', CLEAN: 'clean', EXPLICIT: 'explicit', NL: 'dutch', DUTCH: 'dutch', NEDERLANDS: 'dutch',
};
const WORD_OUT: Record<string, string> = {
  wedding: 'BRUILOFT', village_festival: 'DORPSFEEST', club: 'CLUB', after_party: 'AFTERPARTY', private: 'PRIVE', company: 'BEDRIJF', kids: 'KIDS',
  feelgood: 'FEELGOOD', euphoric: 'EUFORISCH', dark: 'DONKER', emotional: 'EMOTIONEEL', party: 'PARTY', chill: 'CHILL',
  classic: 'KLASSIEKER', banger: 'BANGER', singalong: 'MEEZINGER', clean: 'CLEAN', explicit: 'EXPLICIT', dutch: 'NL',
};

/** Our tags (energy, crowd, mood, flags) from the comment field. */
export function tagsFromComment(c?: string) {
  const d = decodeComment(c);
  const crowd: CrowdType[] = [], moods: Mood[] = [], flags: TrackFlag[] = [];
  for (const w of d.words) {
    const v = WORD_MAP[w];
    if (!v) continue;
    if ((CROWD_TYPES as readonly string[]).includes(v)) crowd.push(v as CrowdType);
    else if ((MOODS as readonly string[]).includes(v)) moods.push(v as Mood);
    else if ((TRACK_FLAGS as readonly string[]).includes(v)) flags.push(v as TrackFlag);
  }
  return { energy: d.energy, crowd, moods, flags, rest: d.rest };
}

export function commentFor(t: Pick<Track, 'energy' | 'crowd' | 'moods' | 'flags' | 'comment'>) {
  return encodeComment({ energy: t.energy, words: [...t.crowd, ...t.moods, ...t.flags].map((w) => WORD_OUT[w] ?? w), rest: t.comment });
}

export interface ScanProgress { done: number; total?: number; current?: string; added: number; updated: number; errors: string[] }

/**
 * Scan a location: new/changed audio files are read (tags, Serato cues,
 * artwork), hashed (audio only) and linked to an existing track (same audio,
 * or same song version: a copy on the other laptop or a USB) or a new one in
 * the Inbox. Files not found any more are marked missing.
 */
export async function scanLocation(loc: MusicLocation, src: FileSource, onProgress?: (p: ScanProgress) => void, owner = loc.owner): Promise<ScanProgress> {
  const p: ScanProgress = { done: 0, added: 0, updated: 0, errors: [] };
  const now = nowIso();
  const existing = alive(await db.trackFiles.where('locationId').equals(loc.id).toArray()) as TrackFile[];
  const byPath = new Map(existing.map((f) => [f.path, f]));
  const seen = new Set<string>();
  for await (const e of src.list()) {
    seen.add(e.path);
    p.current = e.path;
    const known = byPath.get(e.path);
    try {
      if (known && known.sizeBytes === e.size && (known.mtime ?? 0) === (e.mtime ?? 0) && !known.missing) {
        if (known.lastSeenAt.slice(0, 10) !== now.slice(0, 10)) await save<TrackFile>('trackFiles', { ...known, lastSeenAt: now });
      } else {
        const isNew = await ingestFile(loc, src, e, known, owner);
        if (isNew) p.added++; else p.updated++;
      }
    } catch (err) {
      p.errors.push(`${e.path}: ${(err as Error).message}`);
    }
    p.done++;
    if (p.done % 10 === 0) onProgress?.({ ...p });
  }
  for (const f of existing) if (!seen.has(f.path) && !f.missing) await save<TrackFile>('trackFiles', { ...f, missing: true });
  const missing = existing.filter((f) => !seen.has(f.path)).length;
  await save<MusicLocation>('musicLocations', { ...loc, lastScanAt: now, scanSummary: { files: seen.size, added: p.added, missing, errors: p.errors.length } });
  onProgress?.({ ...p, current: undefined });
  return p;
}

async function ingestFile(loc: MusicLocation, src: FileSource, e: { path: string; size: number; mtime?: number }, known: TrackFile | undefined, owner: Track['owner']): Promise<boolean> {
  const bytes = await src.read(e.path);
  const format = extOf(e.path);
  const [a0, a1] = audioRange(bytes, format);
  const audioHash = await sha256(bytes.subarray(a0, a1));
  const meta = await parseBuffer(bytes, { mimeType: MIME[format], size: bytes.length }, { duration: format !== 'mp3' });
  const c = meta.common;
  const id3 = format === 'mp3' ? readId3(bytes) : null;
  const comment = id3 ? commentText(id3) : c.comment?.[0]?.text;
  const ours = tagsFromComment(comment);
  const cues = id3?.frames.filter((f) => f.id === 'GEOB').flatMap((f) => readMarkers2(f.data)) ?? [];
  const names = cleanFields({ artist: c.artist, title: c.title }, e.path);
  const durationS = meta.format.duration ? Math.round(meta.format.duration) : undefined;
  const bitrate = meta.format.bitrate ? Math.round(meta.format.bitrate / 1000) : undefined;

  // Same audio anywhere = same track; else the same song version (copy elsewhere).
  const sameAudio = await db.trackFiles.where('audioHash').equals(audioHash).first();
  let trackId = known?.trackId ?? (sameAudio && !sameAudio.deletedAt ? sameAudio.trackId : undefined);
  if (!trackId) {
    const k = normKey(names.artist, names.title);
    const cands = (alive(await db.musicTracks.where('title').equalsIgnoreCase(names.title).toArray()) as Track[])
      .filter((t) => normKey(t.artist, t.title) === k && (t.mix ?? '') === (names.mix ?? '') && (!t.durationS || !durationS || Math.abs(t.durationS - durationS) <= 2));
    trackId = cands[0]?.id;
  }
  let artworkId: string | undefined;
  const pic = c.picture?.[0];
  if (pic && pic.data.length < 1_500_000) {
    const h = await sha256(pic.data);
    const ex = await db.artworks.where('hash').equals(h).first();
    artworkId = ex?.id ?? (await save<Artwork>('artworks', { hash: h, blob: new Blob([pic.data as BlobPart], { type: pic.format }), mime: pic.format })).id;
  }
  const isNew = !trackId;
  if (!trackId) {
    const t = await save<Track>('musicTracks', {
      artist: names.artist || 'Onbekend', title: names.title || e.path.split('/').pop()!, mix: names.mix,
      album: c.album, label: c.label?.[0], year: c.year, genre: c.genre?.[0], isrc: c.isrc?.[0],
      bpm: c.bpm ? Math.round(c.bpm * 10) / 10 : undefined, key: toCamelot(c.key), durationS,
      energy: ours.energy, moods: ours.moods, crowd: ours.crowd, flags: ours.flags, comment: ours.rest || undefined,
      owner, status: 'inbox', source: guessSource(`${loc.name}/${e.path}`), cueNotes: [], hotCues: cues.length ? cues : undefined, artworkId,
    });
    trackId = t.id;
  } else {
    const t = await db.musicTracks.get(trackId);
    if (t) {
      // Fill gaps only: the Library's own edits win over file tags.
      const fill: Partial<Track> = {};
      if (!t.bpm && c.bpm) fill.bpm = Math.round(c.bpm * 10) / 10;
      if (!t.key && c.key) fill.key = toCamelot(c.key);
      if (!t.durationS && durationS) fill.durationS = durationS;
      if (!t.artworkId && artworkId) fill.artworkId = artworkId;
      if (cues.length && !t.hotCues?.length) fill.hotCues = cues;
      if (t.owner !== owner && t.owner !== 'shared') fill.owner = 'shared';
      if (Object.keys(fill).length) await save<Track>('musicTracks', { ...t, ...fill });
    }
  }
  await save<TrackFile>('trackFiles', {
    ...(known ?? {}), trackId, locationId: loc.id, path: e.path, format, sizeBytes: e.size, mtime: e.mtime, bitrate,
    sampleRate: meta.format.sampleRate, audioHash, quality: judgeQuality({ format, bitrate, durationS: meta.format.duration }), lastSeenAt: nowIso(), missing: false,
  } as TrackFile);
  return isNew;
}

/** Decode audio to mono PCM in the webview (Web Audio). Injected in tests. */
export type Decoder = (bytes: Uint8Array) => Promise<{ pcm: Float32Array; rate: number }>;
export const webDecoder: Decoder = async (bytes) => {
  const Ctx = (window.OfflineAudioContext || (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext);
  const ctx = new Ctx(1, 1, 44100);
  const buf = await ctx.decodeAudioData(bytes.slice().buffer as ArrayBuffer);
  const pcm = new Float32Array(buf.length);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < d.length; i++) pcm[i] += d[i] / buf.numberOfChannels; }
  return { pcm, rate: buf.sampleRate };
};

/** Fill BPM, key, energy suggestion and the fake-320 check for one track. Values already set are kept. */
export async function analyseTrack(track: Track, file: TrackFile, src: FileSource, decode: Decoder = webDecoder) {
  const bytes = await src.read(file.path);
  const { pcm, rate } = await decode(bytes);
  const mid = excerpt(pcm, rate, 90);
  const patch: Partial<Track> = { analysedAt: nowIso() };
  if (!track.bpm) { const b = detectBpm(mid, rate); if (b) patch.bpm = b.bpm; }
  if (!track.key) { const k = detectKey(mid, rate); if (k) { patch.key = k.key; patch.keyConfidence = Math.round(k.confidence * 100) / 100; } }
  if (!track.durationS) patch.durationS = Math.round(pcm.length / rate);
  if (!track.energy) patch.energy = suggestEnergy(mid, rate, patch.bpm ?? track.bpm);
  await save<Track>('musicTracks', { ...track, ...patch });
  const cutoff = cutoffHz(excerpt(pcm, rate, 30), rate);
  await save<TrackFile>('trackFiles', { ...file, cutoffHz: cutoff, quality: judgeQuality({ format: file.format, bitrate: file.bitrate, cutoff, durationS: pcm.length / rate }) });
}

/**
 * Write our fields into the file (MP3 only for now): artist, title (+ mix),
 * BPM, key, genre, year, label and the comment with our tags. Serato's own data
 * in the file stays intact.
 */
export async function writeTags(track: Track, file: TrackFile, src: FileSource): Promise<'ok' | 'skipped'> {
  if (file.format !== 'mp3') return 'skipped';
  const bytes = await src.read(file.path);
  const out = writeId3(bytes, {
    artist: track.artist, title: track.mix ? `${track.title} (${track.mix})` : track.title, bpm: track.bpm, key: track.key,
    genre: track.genre, year: track.year, label: track.label, album: track.album, comment: commentFor(track),
  });
  if (!out) return 'skipped';
  await src.write(file.path, out);
  await save<TrackFile>('trackFiles', { ...file, sizeBytes: out.length, mtime: Date.now() });
  return 'ok';
}

/** A track you only stream (Serato/djay streaming services): no file, still plannable. */
export async function addStreamTrack(p: { artist: string; title: string; mix?: string; service: string; bpm?: number; key?: string; energy?: number }, owner: Track['owner']) {
  return save<Track>('musicTracks', {
    artist: p.artist, title: p.title, mix: p.mix, bpm: p.bpm, key: toCamelot(p.key), energy: p.energy,
    moods: [], crowd: [], flags: [], owner, status: 'ok', source: 'stream', stream: { service: p.service }, cueNotes: [],
  });
}

export async function addLocation(p: Pick<MusicLocation, 'name' | 'kind' | 'owner' | 'rootPath'>, handle?: unknown) {
  const loc = await save<MusicLocation>('musicLocations', p as MusicLocation);
  if (handle) await db.dirHandles.put({ id: loc.id, handle });
  return loc;
}

export const newCueId = () => uid();
