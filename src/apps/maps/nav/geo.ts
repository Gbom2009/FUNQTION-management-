/** Geodesy helpers. Coordinates are [lon, lat] like GeoJSON. */
export type LonLat = [number, number];

const R = 6371008.8; // mean Earth radius, m
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function haversine(a: LonLat, b: LonLat): number {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Initial bearing a→b, degrees 0..360 (0 = north). */
export function bearing(a: LonLat, b: LonLat): number {
  const φ1 = rad(a[1]), φ2 = rad(b[1]), Δλ = rad(b[0] - a[0]);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Smallest absolute difference between two headings, 0..180. */
export function angleDiff(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360 + 540) % 360 - 180);
  return d;
}

/** Point `dist` metres from `p` along `brg` degrees. */
export function destination(p: LonLat, brg: number, dist: number): LonLat {
  const δ = dist / R, θ = rad(brg), φ1 = rad(p[1]), λ1 = rad(p[0]);
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return [deg(λ2), deg(φ2)];
}

/** Cumulative distance (m) at each vertex of a polyline. */
export function cumulative(line: LonLat[]): number[] {
  const out = new Array<number>(line.length);
  let d = 0;
  for (let i = 0; i < line.length; i++) {
    if (i > 0) d += haversine(line[i - 1], line[i]);
    out[i] = d;
  }
  return out;
}

export interface Projection {
  /** segment index i (between vertex i and i+1) */
  segment: number;
  /** 0..1 along that segment */
  t: number;
  point: LonLat;
  /** distance along the line from its start, m */
  along: number;
  /** perpendicular distance from the line, m */
  offset: number;
  /** bearing of the segment, degrees */
  segmentBearing: number;
}

/**
 * Project p onto the polyline, searching segments [from, to). Uses a local
 * equirectangular plane per segment — accurate to centimetres at road scale.
 */
export function project(p: LonLat, line: LonLat[], cum: number[], from = 0, to = line.length - 1): Projection | null {
  let best: Projection | null = null;
  const lo = Math.max(0, from), hi = Math.min(line.length - 1, to);
  const k = Math.cos(rad(p[1]));
  for (let i = lo; i < hi; i++) {
    const a = line[i], b = line[i + 1];
    // local metres, origin at a
    const bx = (b[0] - a[0]) * k, by = b[1] - a[1];
    const px = (p[0] - a[0]) * k, py = p[1] - a[1];
    const len2 = bx * bx + by * by;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / len2));
    const q: LonLat = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const offset = haversine(p, q);
    if (!best || offset < best.offset) {
      best = {
        segment: i, t, point: q,
        along: cum[i] + (cum[i + 1] - cum[i]) * t,
        offset,
        segmentBearing: bearing(a, b),
      };
    }
  }
  return best;
}

/** Point at a given distance along the polyline (clamped), plus its bearing. */
export function pointAlong(line: LonLat[], cum: number[], along: number): { point: LonLat; bearing: number; segment: number } {
  const total = cum[cum.length - 1];
  const d = Math.max(0, Math.min(total, along));
  // binary search for segment
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= d) lo = mid; else hi = mid;
  }
  const a = line[lo], b = line[Math.min(lo + 1, line.length - 1)];
  const seg = cum[lo + 1] - cum[lo] || 1;
  const t = (d - cum[lo]) / seg;
  return { point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], bearing: bearing(a, b), segment: lo };
}
