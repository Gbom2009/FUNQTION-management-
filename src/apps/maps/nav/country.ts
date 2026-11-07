import type { LonLat } from "./geo";
import { haversine } from "./geo";

/**
 * Where may the app warn for speed cameras? Netherlands and Belgium: yes.
 * Germany, France, Switzerland, Austria: no (illegal there). Borders come
 * from Natural Earth 1:50m (public domain, ~1–2 km accurate), so near the
 * border we stay on the safe side and don't warn.
 */
type Ring = LonLat[];
let polys: Ring[][] = [];
let loading: Promise<void> | null = null;

export function loadBorders(): Promise<void> {
  loading ??= fetch(`${import.meta.env.BASE_URL}maps/data/nl-be.geojson`)
    .then((r) => (r.ok ? r.json() : { features: [] }))
    .then((gj: { features: { geometry: { type: string; coordinates: unknown } }[] }) => {
      polys = gj.features.flatMap((f) => (f.geometry.type === "Polygon" ? [f.geometry.coordinates as Ring[]] : (f.geometry.coordinates as Ring[][])));
    })
    .catch(() => { polys = []; });
  return loading;
}

/** For tests. */
export function setBorders(p: Ring[][]) { polys = p; loading = Promise.resolve(); }

function inRing(p: LonLat, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance (m) from p to the nearest outer border vertex segment. */
function distToBorder(p: LonLat): number {
  let best = Infinity;
  const k = Math.cos((p[1] * Math.PI) / 180);
  for (const poly of polys) {
    const r = poly[0];
    for (let i = 0; i < r.length - 1; i++) {
      const a = r[i], b = r[i + 1];
      const bx = (b[0] - a[0]) * k, by = b[1] - a[1], px = (p[0] - a[0]) * k, py = p[1] - a[1];
      const len2 = bx * bx + by * by;
      const t = len2 ? Math.max(0, Math.min(1, (px * bx + py * by) / len2)) : 0;
      const q: LonLat = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      best = Math.min(best, haversine(p, q));
    }
  }
  return best;
}

/** Inside NL/BE and not within the uncertainty margin of the border. Unknown borders → false (safe). */
export function cameraWarningsAllowed(lon: number, lat: number, marginM = 1500): boolean {
  if (!polys.length) return false;
  const p: LonLat = [lon, lat];
  if (!polys.some((poly) => inRing(p, poly[0]) && !poly.slice(1).some((h) => inRing(p, h)))) return false;
  // The NL–BE border itself is fine (both allow it); only foreign borders matter, but
  // the outline here is the union's outer edge for each country — so stay conservative.
  return distToBorder(p) > marginM || insideBothNeighbours(p);
}

/** Points near the NL–BE border are inside one of the two countries either way. */
function insideBothNeighbours(p: LonLat): boolean {
  // within 3 km of both polygons → it's the shared NL–BE border, warnings legal on both sides
  if (polys.length < 2) return false;
  const near = (poly: Ring[]) => inRing(p, poly[0]) || ringDistance(p, poly[0]) < 3000;
  return polys.filter(near).length >= 2;
}

function ringDistance(p: LonLat, r: Ring): number {
  let best = Infinity;
  for (const v of r) best = Math.min(best, haversine(p, v));
  return best;
}
