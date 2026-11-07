import * as maplibregl from "maplibre-gl";
import { PMTiles, Protocol, FileSource } from "pmtiles";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { lazyStorage } from "../../store/storage";

/**
 * Offline region packs: PMTiles files in the OpenMapTiles schema (same schema
 * as OpenFreeMap, so our branded style works unchanged). Build one with
 * planetiler (see README) and import it here. Files live in the Origin Private
 * File System — no size limits like localStorage, survives restarts.
 */
export interface PackInfo {
  name: string;
  sizeBytes: number;
  bounds?: [number, number, number, number];
  minZoom?: number;
  maxZoom?: number;
  importedAt: number;
}

export type OfflineMode = "auto" | "always" | "never";

interface OfflineState {
  packs: PackInfo[];
  activePack: string | null;
  /** auto = use the pack when the device is offline */
  mode: OfflineMode;
  set: (p: Partial<Pick<OfflineState, "activePack" | "mode">>) => void;
  _setPacks: (packs: PackInfo[]) => void;
}

export const useOffline = create<OfflineState>()(
  persist(
    (set) => ({
      packs: [],
      activePack: null,
      mode: "auto",
      set: (p) => set(p),
      _setPacks: (packs) => set({ packs }),
    }),
    { name: "fq-offline", storage: lazyStorage },
  ),
);

const DIR = "packs";
const protocol = new Protocol();
let protocolAdded = false;
const opened = new Map<string, PMTiles>();

async function dir(): Promise<FileSystemDirectoryHandle> {
  if (!navigator.storage?.getDirectory) throw new Error("Offline storage (OPFS) not available in this webview");
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(DIR, { create: true });
}

function ensureProtocol() {
  if (protocolAdded) return;
  maplibregl.addProtocol("pmtiles", protocol.tile);
  protocolAdded = true;
}

/** Open a stored pack and register it; returns the source URL for the style. */
export async function openPack(name: string): Promise<string> {
  ensureProtocol();
  if (!opened.has(name)) {
    const file = await (await (await dir()).getFileHandle(name)).getFile();
    const p = new PMTiles(new FileSource(file));
    protocol.add(p);
    opened.set(name, p);
  }
  return `pmtiles://${opened.get(name)!.source.getKey()}`;
}

/** Validate a .pmtiles file (vector, OpenMapTiles layers) and store it. */
export async function importPack(file: File): Promise<PackInfo> {
  const probe = new PMTiles(new FileSource(file));
  const header = await probe.getHeader();
  // tileType 1 = MVT vector tiles
  if (header.tileType !== 1) throw new Error("Not a vector PMTiles file");
  const meta = (await probe.getMetadata()) as { vector_layers?: { id: string }[] };
  const layers = new Set((meta.vector_layers ?? []).map((l) => l.id));
  if (!layers.has("transportation") || !layers.has("water")) {
    throw new Error("Pack is not OpenMapTiles schema (build it with planetiler, see README)");
  }
  const handle = await (await dir()).getFileHandle(file.name, { create: true });
  const w = await handle.createWritable();
  await file.stream().pipeTo(w);
  const info: PackInfo = {
    name: file.name,
    sizeBytes: file.size,
    bounds: [header.minLon, header.minLat, header.maxLon, header.maxLat],
    minZoom: header.minZoom,
    maxZoom: header.maxZoom,
    importedAt: Date.now(),
  };
  const s = useOffline.getState();
  s._setPacks([...s.packs.filter((p) => p.name !== info.name), info]);
  if (!s.activePack) s.set({ activePack: info.name });
  return info;
}

export async function deletePack(name: string) {
  try { await (await dir()).removeEntry(name); } catch { /* already gone */ }
  opened.delete(name);
  const s = useOffline.getState();
  s._setPacks(s.packs.filter((p) => p.name !== name));
  if (s.activePack === name) s.set({ activePack: s.packs.find((p) => p.name !== name)?.name ?? null });
}

/** Should the map use the offline pack right now? */
export function wantsPack(mode: OfflineMode, active: string | null, online: boolean): boolean {
  if (!active || mode === "never") return false;
  return mode === "always" || !online;
}

export function storageEstimate(): Promise<{ usage?: number; quota?: number }> {
  return navigator.storage?.estimate?.() ?? Promise.resolve({});
}
