import { useEffect, useState } from 'react';
import { db } from '../../core/db';
import { useI18n } from '../../core/i18n';
import type { MusicLocation, Track } from '../../core/types';
import { keyColor } from './domain/keys';
import { browserSource, ensurePermission, isDesktop, tauriSource, type FileSource } from './fs';

/** A Camelot key chip in the key-wheel colour (the only place those colours are used). */
export function KeyChip({ k }: { k?: string }) {
  if (!k) return <span className="muted">–</span>;
  return <span className="lib-key" style={{ background: keyColor(k) }}>{k}</span>;
}

export function EnergyBar({ e }: { e?: number }) {
  return <span className="lib-energy" title={e ? `E${e}` : ''}><span style={{ width: `${(e ?? 0) * 10}%` }} /></span>;
}

const SOURCE_ICON: Record<Track['source'], string> = { stream: '☁', download: '⇣', converted: '⟳', cd_rip: '◉', promo: '✉', own_production: '★', unknown: '?' };
export function SourceBadge({ s }: { s: Track['source'] }) {
  const { t } = useI18n();
  return <span className={`lib-src ${s}`} title={t(`lib.source.${s}` as never)}>{SOURCE_ICON[s]}</span>;
}

/** The file access for a location on this device, or null when it has to be picked (again). */
export async function sourceFor(loc: MusicLocation): Promise<FileSource | null> {
  if (isDesktop() && loc.rootPath) return tauriSource(loc.rootPath);
  const h = await db.dirHandles.get(loc.id);
  if (h && (await ensurePermission(h.handle))) {
    const src = browserSource(h.handle);
    return loc.rootPath ? { ...src, absRoot: loc.rootPath } : src;
  }
  return null;
}

export function useArtworkUrl(id?: string) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let u: string | undefined;
    if (id) void db.artworks.get(id).then((a) => { if (a) { u = URL.createObjectURL(a.blob); setUrl(u); } });
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [id]);
  return url;
}

export function Art({ id, size = 36 }: { id?: string; size?: number }) {
  const url = useArtworkUrl(id);
  return url ? <img className="lib-art" src={url} alt="" width={size} height={size} /> : <span className="lib-art empty" style={{ width: size, height: size }} />;
}

export const fmtDur = (s?: number) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '–');
