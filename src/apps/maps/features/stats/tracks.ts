import type { LonLat } from "../../nav/geo";

/**
 * Driven tracks per trip, in IndexedDB (too big for localStorage over a
 * season). Points are decimated to ≥ 50 m apart and rounded to ~1 m.
 */
const DB = "fq-tracks";
const STORE = "tracks";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const r = fn(db.transaction(STORE, mode).objectStore(STORE));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export const saveTrack = (id: string, pts: LonLat[]) => tx("readwrite", (s) => s.put(pts, id)).catch(() => undefined);
export const loadTrack = (id: string) => tx<LonLat[] | undefined>("readonly", (s) => s.get(id)).catch(() => undefined);
export const deleteTrack = (id: string) => tx("readwrite", (s) => s.delete(id)).catch(() => undefined);

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
