import { normKey } from './names';

// Duplicates: the same audio (identical audio hash) or the same song version
// (same normalised artist/title/mix, length within 2 s). Keep the best copy.

export interface DupeFile { id: string; trackId: string; audioHash: string; bitrate?: number; format: string; sizeBytes: number; missing?: boolean; quality?: string }
export interface DupeTrack { id: string; artist: string; title: string; mix?: string; durationS?: number }

const RANK: Record<string, number> = { wav: 5, aiff: 5, aif: 5, flac: 5, alac: 5, m4a: 3, aac: 3, mp3: 2 };

/** Higher = better copy to keep. */
export function fileScore(f: DupeFile): number {
  if (f.missing) return -1;
  const q = f.quality === 'broken' ? -50 : f.quality === 'transcode_suspect' ? -20 : f.quality === 'low' ? -10 : 0;
  return (RANK[f.format] ?? 1) * 100 + (f.bitrate ?? 0) / 10 + q;
}

export interface DupeGroup { kind: 'same_audio' | 'same_version'; trackIds: string[]; fileIds: string[]; keepFileId: string }

export function findDupes(tracks: DupeTrack[], files: DupeFile[]): DupeGroup[] {
  const groups: DupeGroup[] = [];
  const byHash = new Map<string, DupeFile[]>();
  for (const f of files) if (!f.missing && f.audioHash) byHash.set(f.audioHash, [...(byHash.get(f.audioHash) ?? []), f]);
  const seenTracks = new Set<string>();
  for (const list of byHash.values()) {
    const tids = [...new Set(list.map((f) => f.trackId))];
    if (list.length < 2 || tids.length < 2) continue; // copies of one track on two drives are fine
    const keep = [...list].sort((a, b) => fileScore(b) - fileScore(a))[0];
    groups.push({ kind: 'same_audio', trackIds: tids, fileIds: list.map((f) => f.id), keepFileId: keep.id });
    tids.forEach((t) => seenTracks.add(t));
  }
  const byKey = new Map<string, DupeTrack[]>();
  for (const t of tracks) {
    if (seenTracks.has(t.id)) continue;
    const k = `${normKey(t.artist, t.title)}|${(t.mix ?? '').toLowerCase()}`;
    byKey.set(k, [...(byKey.get(k) ?? []), t]);
  }
  for (const list of byKey.values()) {
    if (list.length < 2) continue;
    // split by length: an extended mix and a radio edit are different versions
    const sorted = [...list].sort((a, b) => (a.durationS ?? 0) - (b.durationS ?? 0));
    let bucket: DupeTrack[] = [sorted[0]];
    const flush = () => {
      if (bucket.length < 2) return;
      const ids = bucket.map((t) => t.id);
      const fs = files.filter((f) => ids.includes(f.trackId));
      const keep = [...fs].sort((a, b) => fileScore(b) - fileScore(a))[0];
      groups.push({ kind: 'same_version', trackIds: ids, fileIds: fs.map((f) => f.id), keepFileId: keep?.id ?? '' });
    };
    for (const t of sorted.slice(1)) {
      const last = bucket[bucket.length - 1];
      if (t.durationS === undefined || last.durationS === undefined || Math.abs(t.durationS - last.durationS) <= 2) bucket.push(t);
      else { flush(); bucket = [t]; }
    }
    flush();
  }
  return groups;
}
