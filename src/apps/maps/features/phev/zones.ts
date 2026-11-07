import type { LonLat } from "../../nav/geo";
import type { RouteGeometry } from "../../nav/guidance";
import type { LimitSegment } from "../../nav/speed";

/**
 * Milieuzones (bundled from OSM, see scripts/fetch-milieuzones.mjs) and
 * PHEV "switch to EV mode" hints. Pure geometry here; session wires it up.
 */
export interface Zone {
  id: string;
  name: string;
  website?: string;
  /** polygons as rings: [outer, ...holes] */
  polygons: LonLat[][][];
  bbox: [number, number, number, number];
}

type Ring = LonLat[];
interface GeoFeature {
  id?: string;
  properties: { name?: string; website?: string };
  geometry: { type: "Polygon"; coordinates: Ring[] } | { type: "MultiPolygon"; coordinates: Ring[][] };
}

export function parseZones(gj: { features: GeoFeature[] }): Zone[] {
  return gj.features.map((f, i) => {
    const polygons = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const poly of polygons) for (const [x, y] of poly[0]) {
      if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y;
    }
    return { id: String(f.id ?? i), name: f.properties.name ?? "Milieuzone", website: f.properties.website, polygons, bbox: [minX, minY, maxX, maxY] };
  });
}

/** Ray casting point-in-ring. */
function inRing(p: LonLat, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function inZone(p: LonLat, z: Zone): boolean {
  const [a, b, c, d] = z.bbox;
  if (p[0] < a || p[0] > c || p[1] < b || p[1] > d) return false;
  return z.polygons.some((poly) => inRing(p, poly[0]) && !poly.slice(1).some((hole) => inRing(p, hole)));
}

export interface ZoneEntry { along: number; zone: Zone }

/** Where the route enters a zone (outside → inside transitions), in order. */
export function zoneEntries(g: RouteGeometry, zones: Zone[]): ZoneEntry[] {
  if (!zones.length || g.shape.length < 2) return [];
  // only zones whose bbox touches the route's bbox
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of g.shape) { if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; }
  const near = zones.filter((z) => !(z.bbox[0] > maxX || z.bbox[2] < minX || z.bbox[1] > maxY || z.bbox[3] < minY));
  const out: ZoneEntry[] = [];
  for (const z of near) {
    let prev = inZone(g.shape[0], z);
    // starting inside counts as an entry at 0 (you're already in it)
    if (prev) out.push({ along: 0, zone: z });
    for (let i = 1; i < g.shape.length; i++) {
      const now = inZone(g.shape[i], z);
      if (now && !prev) out.push({ along: g.cum[i], zone: z });
      prev = now;
    }
  }
  return out.sort((a, b) => a.along - b.along);
}

export interface UrbanStretch { from: number; to: number }

/**
 * Built-up stretches worth driving electric: consecutive road with posted
 * limit ≤ 50 km/h totalling at least `minM`. Short gaps (< 300 m) are merged.
 */
export function urbanStretches(g: RouteGeometry, limits: LimitSegment[], minM = 1500): UrbanStretch[] {
  const raw: UrbanStretch[] = [];
  for (const s of limits) {
    if (s.limitKmh === undefined || s.limitKmh > 50) continue;
    const from = g.cum[Math.min(s.from, g.cum.length - 1)], to = g.cum[Math.min(s.to, g.cum.length - 1)];
    const last = raw[raw.length - 1];
    if (last && from - last.to < 300) last.to = Math.max(last.to, to);
    else raw.push({ from, to });
  }
  return raw.filter((r) => r.to - r.from >= minM);
}

export interface EvHint { along: number; kind: "zone" | "urban"; zone?: Zone; lengthM: number }

/**
 * EV-mode hints: before each zone entry, and before each long urban stretch,
 * but only if the stretch fits within the car's electric range (when known).
 */
export function evHints(entries: ZoneEntry[], urban: UrbanStretch[], evRangeKm?: number): EvHint[] {
  const fits = (m: number) => evRangeKm === undefined || m <= evRangeKm * 1000;
  const out: EvHint[] = [];
  for (const e of entries) {
    // zone length ≈ the urban stretch that contains the entry, else 3 km
    const u = urban.find((s) => e.along >= s.from - 300 && e.along <= s.to);
    const len = u ? u.to - e.along : 3000;
    if (fits(len)) out.push({ along: e.along, kind: "zone", zone: e.zone, lengthM: len });
  }
  for (const s of urban) {
    if (out.some((h) => Math.abs(h.along - s.from) < 1500)) continue;
    if (fits(s.to - s.from)) out.push({ along: s.from, kind: "urban", lengthM: s.to - s.from });
  }
  return out.sort((a, b) => a.along - b.along);
}

let cache: Promise<Zone[]> | null = null;
/** Load the bundled zones once. Missing file → empty list (feature degrades, UI says so). */
export function loadZones(): Promise<Zone[]> {
  cache ??= fetch(`${import.meta.env.BASE_URL}maps/data/milieuzones.geojson`)
    .then((r) => (r.ok ? r.json() : { features: [] }))
    .then(parseZones)
    .catch(() => []);
  return cache;
}
