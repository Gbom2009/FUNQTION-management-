import type { LonLat } from "../../nav/geo";

import { db } from "../../../../core/db";

/**
 * Driven tracks per trip, in the suite database (table `tracks`, id = trip id).
 * Large over a season, so they're not in backups. Points are decimated to
 * ≥ 50 m apart and rounded to ~1 m.
 */
export const saveTrack = (id: string, pts: LonLat[]) => db.tracks.put({ id, points: pts }).catch(() => undefined);
export const loadTrack = (id: string) => db.tracks.get(id).then((r) => r?.points as LonLat[] | undefined).catch(() => undefined);
export const deleteTrack = (id: string) => db.tracks.delete(id).catch(() => undefined);

export async function loadTracks(ids: string[]): Promise<Map<string, LonLat[]>> {
  const out = new Map<string, LonLat[]>();
  for (const id of ids) { const t = await loadTrack(id); if (t?.length) out.set(id, t); }
  return out;
}

/** Incremental decimator: keeps a point when it is ≥ minM from the last kept one. */
export function createDecimator(minM = 50) {
  const pts: LonLat[] = [];
  const k = 111_320; // m per degree latitude
  return {
    push(p: LonLat) {
      const last = pts[pts.length - 1];
      if (last) {
        const dx = (p[0] - last[0]) * k * Math.cos((p[1] * Math.PI) / 180), dy = (p[1] - last[1]) * k;
        if (dx * dx + dy * dy < minM * minM) return;
      }
      pts.push([Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5]);
    },
    points: () => pts,
  };
}
