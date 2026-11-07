import { db } from '../../core/db';
import { alive } from '../../core/repo';
import type { MusicLocation, Track, TrackFile } from '../../core/types';
import { fileScore } from './domain/dupes';
import { m3u, rekordboxXml, type ExportTrack } from './domain/exports';
import { cratePath, crateFileName, writeCrate } from './domain/serato';
import { normKey } from './domain/names';
import { homeDir, isDesktop, saveAs, writeAbsolute, type FileSource } from './fs';

/** The best playable copy of each track on this device (absolute path known). */
export async function resolveExport(trackIds: string[], locationId?: string): Promise<{ tracks: ExportTrack[]; missing: Track[] }> {
  const locs = new Map((alive(await db.musicLocations.toArray()) as MusicLocation[]).map((l) => [l.id, l]));
  const out: ExportTrack[] = [];
  const missing: Track[] = [];
  for (const id of trackIds) {
    const t = await db.musicTracks.get(id);
    if (!t || t.deletedAt) continue;
    const files = (alive(await db.trackFiles.where('trackId').equals(id).toArray()) as TrackFile[])
      .filter((f) => !f.missing && locs.get(f.locationId)?.rootPath && (!locationId || f.locationId === locationId))
      .sort((a, b) => fileScore(b) - fileScore(a));
    const f = files[0];
    if (!f) { missing.push(t); continue; }
    const root = locs.get(f.locationId)!.rootPath!.replace(/\/+$/, '');
    out.push({
      id: t.id, absPath: `${root}/${f.path}`, artist: t.artist, title: t.title, mix: t.mix, album: t.album, genre: t.genre, label: t.label, year: t.year,
      bpm: t.bpm, key: t.key, durationS: t.durationS, sizeBytes: f.sizeBytes, comment: t.comment, hotCues: t.hotCues,
    });
  }
  return { tracks: out, missing };
}

export async function exportRekordbox(name: string, trackIds: string[]) {
  const { tracks, missing } = await resolveExport(trackIds);
  await saveAs(`${name}.xml`, rekordboxXml(tracks, [{ name, trackIds: tracks.map((t) => t.id) }]), 'application/xml');
  return { count: tracks.length, missing };
}

export async function exportM3u(name: string, trackIds: string[]) {
  const { tracks, missing } = await resolveExport(trackIds);
  await saveAs(`${name}.m3u8`, m3u(tracks), 'audio/x-mpegurl');
  return { count: tracks.length, missing };
}

/**
 * A Serato crate (also read by djay Pro). On the Mac it's written straight into
 * the _Serato_ folder of each drive the tracks are on (Serato must be closed);
 * in the browser it downloads, to be copied into _Serato_/Subcrates/.
 */
export async function exportSeratoCrate(name: string, trackIds: string[]): Promise<{ count: number; missing: Track[]; written: string[] }> {
  const { tracks, missing } = await resolveExport(trackIds);
  const byVolume = new Map<string, string[]>();
  for (const t of tracks) {
    const vol = /^\/Volumes\/[^/]+/.exec(t.absPath)?.[0] ?? '';
    byVolume.set(vol, [...(byVolume.get(vol) ?? []), cratePath(t.absPath)]);
  }
  const file = crateFileName(['Funqtion', name]);
  const written: string[] = [];
  for (const [vol, paths] of byVolume) {
    const data = writeCrate(paths);
    if (isDesktop()) {
      const base = vol || `${await homeDir()}/Music`;
      const target = `${base}/_Serato_/Subcrates/${file}`;
      await writeAbsolute(target, data);
      written.push(target);
    } else {
      await saveAs(file, data, 'application/octet-stream');
      written.push(file);
    }
  }
  return { count: tracks.length, missing, written };
}

export interface UsbReport { planned: number; found: number; missing: { trackId: string; label: string }[]; hasRekordboxExport: boolean; extra: number }

/**
 * Check a USB stick against a list of tracks: present by filename or by
 * normalised artist/title in the name; plus whether Rekordbox exported to it.
 */
export async function checkUsb(src: FileSource, trackIds: string[], hasPioneerFolder: boolean): Promise<UsbReport> {
  const names: string[] = [];
  for await (const e of src.list()) names.push(e.path);
  const lower = new Set(names.map((n) => n.split('/').pop()!.toLowerCase()));
  const keys = new Set(names.map((n) => { const base = n.split('/').pop()!.replace(/\.[^.]+$/, ''); const [a, ...rest] = base.split(' - '); return rest.length ? normKey(a, rest.join(' - ')) : ''; }));
  const report: UsbReport = { planned: trackIds.length, found: 0, missing: [], hasRekordboxExport: hasPioneerFolder, extra: 0 };
  for (const id of trackIds) {
    const t = await db.musicTracks.get(id);
    if (!t) continue;
    const files = alive(await db.trackFiles.where('trackId').equals(id).toArray()) as TrackFile[];
    const ok = files.some((f) => lower.has(f.path.split('/').pop()!.toLowerCase())) || keys.has(normKey(t.artist, t.title));
    if (ok) report.found++; else report.missing.push({ trackId: id, label: `${t.artist} – ${t.title}${t.stream ? ' ☁' : ''}` });
  }
  report.extra = Math.max(0, names.length - report.found);
  return report;
}
