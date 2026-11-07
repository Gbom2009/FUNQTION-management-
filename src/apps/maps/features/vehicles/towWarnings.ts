import type { RouteGeometry } from "../../nav/guidance";
import type { LimitSegment } from "../../nav/speed";
import { services } from "../../config/services";
import { encodePolyline } from "../../nav/speed";
import { createThrottle } from "../../nav/throttle";
import type { LonLat } from "../../nav/geo";

/**
 * Extra warnings in tow mode, best effort from the data we have:
 * - sharp turns / U-turns: Valhalla maneuver types
 * - narrow roads: road class (OSM has no reliable width data here)
 * - steep descents: Valhalla /height elevation profile
 */
export type TowWarningKind = "sharp" | "narrow" | "descent";
export interface TowWarning { along: number; kind: TowWarningKind; gradePct?: number }

const SHARP_TYPES = new Set([11, 12, 13, 14]);
const NARROW_CLASSES = new Set(["service_other", "living_street", "track"]);
/** Descents at or steeper than this grade (negative %) over WINDOW_M are flagged. */
export const DESCENT_PCT = -6;
const WINDOW_M = 300;

export function computeTowWarnings(
  g: RouteGeometry, limits: LimitSegment[], heights: [number, number][] = [],
): TowWarning[] {
  const out: TowWarning[] = [];
  for (const m of g.maneuvers) if (SHARP_TYPES.has(m.type)) out.push({ along: m.along, kind: "sharp" });

  // narrow: entering a narrow-class segment from a non-narrow one
  let prevNarrow = false;
  for (const s of limits) {
    const narrow = NARROW_CLASSES.has(s.roadClass ?? "");
    if (narrow && !prevNarrow) out.push({ along: g.cum[Math.min(s.from, g.cum.length - 1)], kind: "narrow" });
    prevNarrow = narrow;
  }

  // descent: grade over a sliding window
  let lastDescent = -Infinity;
  for (let i = 0; i < heights.length; i++) {
    const [d0, h0] = heights[i];
    let j = i;
    while (j + 1 < heights.length && heights[j][0] - d0 < WINDOW_M) j++;
    const [d1, h1] = heights[j];
    if (d1 - d0 < WINDOW_M * 0.8) break;
    const grade = ((h1 - h0) / (d1 - d0)) * 100;
    if (grade <= DESCENT_PCT && d0 - lastDescent > 1000) {
      out.push({ along: d0, kind: "descent", gradePct: Math.round(grade) });
      lastDescent = d0;
    }
  }
  return out.sort((a, b) => a.along - b.along);
}

const queue = createThrottle(1000);

/** Elevation profile [distance m, height m] along the route, every 100 m. */
export async function fetchHeights(shape: LonLat[]): Promise<[number, number][]> {
  const r = await queue(() => fetch(`${services.valhalla}/height`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ encoded_polyline: encodePolyline(shape), range: true, resample_distance: 100 }),
  }));
  if (!r.ok) throw new Error(`height ${r.status}`);
  const j = await r.json() as { range_height?: [number, number | null][] };
  return (j.range_height ?? []).filter((p): p is [number, number] => p[1] !== null);
}
