import { services } from "../config/services";
import { createThrottle } from "./throttle";
import type { LonLat } from "./geo";

/**
 * Speed limits along a route, from Valhalla trace_attributes (OSM maxspeed).
 * One request per route; segments are indexed by route shape vertex.
 */
/** An arm leaving a junction (from Valhalla intersecting_edges). */
export interface Arm { heading: number; use?: string; roadClass?: string; sameName?: boolean }

/**
 * Everything Valhalla knows about one stretch of the route (an OSM edge):
 * limits, road type, cycle lane, one-way, roundabout, bridge/tunnel, the
 * junction at its end (traffic light, crossing arms) and the country.
 */
export interface LimitSegment {
  from: number; // shape index
  to: number;
  limitKmh?: number;
  roadClass?: string;
  use?: string;
  names?: string[];
  /** "none" | "shared" | "dedicated" | "separated" */
  cycleLane?: string;
  sidewalk?: string;
  /** only drivable in our direction */
  oneway?: boolean;
  lanes?: number;
  roundabout?: boolean;
  bridge?: boolean;
  tunnel?: boolean;
  toll?: boolean;
  surface?: string;
  /** traffic light at the end of this edge */
  signal?: boolean;
  endNodeType?: string;
  arms?: Arm[];
  country?: string;
  beginHeading?: number;
  endHeading?: number;
}

const queue = createThrottle(1000);

/** Encode [lon, lat] pairs as a precision-6 polyline (inverse of decodePolyline). */
export function encodePolyline(points: LonLat[], precision = 6): string {
  const f = 10 ** precision;
  let out = "", plat = 0, plon = 0;
  const enc = (v: number) => {
    let s = v < 0 ? ~(v << 1) : v << 1;
    let r = "";
    while (s >= 0x20) { r += String.fromCharCode((0x20 | (s & 0x1f)) + 63); s >>= 5; }
    return r + String.fromCharCode(s + 63);
  };
  for (const [lon, lat] of points) {
    const la = Math.round(lat * f), lo = Math.round(lon * f);
    out += enc(la - plat) + enc(lo - plon);
    plat = la; plon = lo;
  }
  return out;
}

interface TraceEdge {
  speed_limit?: number; road_class?: string; begin_shape_index: number; end_shape_index: number;
  use?: string; names?: string[]; cycle_lane?: string; sidewalk?: string; traversability?: string; lane_count?: number;
  roundabout?: boolean; bridge?: boolean; tunnel?: boolean; toll?: boolean; surface?: string; traffic_signal?: boolean;
  begin_heading?: number; end_heading?: number; admin_index?: number;
  end_node?: { type?: string; traffic_signal?: boolean; intersecting_edges?: { begin_heading: number; use?: string; road_class?: string; from_edge_name_consistency?: boolean }[] };
}

async function trace(shape: LonLat[], match: "edge_walk" | "walk_or_snap", costing: string) {
  const body = {
    encoded_polyline: encodePolyline(shape),
    shape_match: match,
    costing,
    filters: {
      attributes: [
        "edge.speed_limit", "edge.road_class", "edge.begin_shape_index", "edge.end_shape_index", "shape",
        "edge.use", "edge.names", "edge.cycle_lane", "edge.sidewalk", "edge.traversability", "edge.lane_count",
        "edge.roundabout", "edge.bridge", "edge.tunnel", "edge.toll", "edge.surface", "edge.traffic_signal",
        "edge.begin_heading", "edge.end_heading", "edge.admin_index", "admin.country_code",
        "node.type", "node.traffic_signal", "node.intersecting_edge.begin_heading", "node.intersecting_edge.use",
        "node.intersecting_edge.road_class", "node.intersecting_edge.from_edge_name_consistency",
      ],
      action: "include",
    },
  };
  const r = await queue(() => fetch(`${services.valhalla}/trace_attributes`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }));
  if (!r.ok) throw new Error(`trace_attributes ${r.status}`);
  return r.json() as Promise<{ edges: TraceEdge[]; shape?: string; admins?: { country_code?: string }[] }>;
}

/** Index of the input vertex nearest to p (for remapping map-matched indices). */
function nearestIndex(shape: LonLat[], p: LonLat, from: number): number {
  let best = from, bd = Infinity;
  for (let i = from; i < shape.length; i++) {
    const d = (shape[i][0] - p[0]) ** 2 + (shape[i][1] - p[1]) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/** Speed limits for one leg; indices relative to the leg's shape. */
async function legLimits(shape: LonLat[], costing: string, decode: (s: string) => LonLat[]): Promise<LimitSegment[]> {
  let admins: { country_code?: string }[] = [];
  const toSeg = (e: TraceEdge, from: number, to: number): LimitSegment => ({
    from, to,
    // Valhalla reports 0 or 255 for "unknown/none"
    limitKmh: e.speed_limit && e.speed_limit < 200 ? e.speed_limit : undefined,
    roadClass: e.road_class,
    use: e.use,
    names: e.names,
    cycleLane: e.cycle_lane,
    sidewalk: e.sidewalk,
    oneway: e.traversability === "forward",
    lanes: e.lane_count,
    roundabout: e.roundabout,
    bridge: e.bridge,
    tunnel: e.tunnel,
    toll: e.toll,
    surface: e.surface,
    signal: !!(e.end_node?.traffic_signal || e.traffic_signal),
    endNodeType: e.end_node?.type,
    arms: e.end_node?.intersecting_edges?.map((x) => ({ heading: x.begin_heading, use: x.use, roadClass: x.road_class, sameName: x.from_edge_name_consistency })),
    country: e.admin_index !== undefined ? admins[e.admin_index]?.country_code : undefined,
    beginHeading: e.begin_heading,
    endHeading: e.end_heading,
  });
  try {
    const j = await trace(shape, "edge_walk", costing);
    admins = j.admins ?? [];
    return j.edges.map((e) => toSeg(e, e.begin_shape_index, e.end_shape_index));
  } catch {
    // Exact match failed: map-match, then map its shape indices back onto ours.
    const j = await trace(shape, "walk_or_snap", costing);
    admins = j.admins ?? [];
    const matched = j.shape ? decode(j.shape) : [];
    let cursor = 0;
    return j.edges.map((e) => {
      const a = matched[e.begin_shape_index], b = matched[e.end_shape_index];
      const from = a ? nearestIndex(shape, a, cursor) : cursor;
      const to = b ? nearestIndex(shape, b, from) : from;
      cursor = from;
      return toSeg(e, from, Math.max(to, from + 1));
    });
  }
}

/**
 * Speed limits for a whole route. One request per leg (exact edge matching
 * fails across the joint at intermediate stops); indices are shifted into
 * the concatenated route shape.
 */
export async function fetchSpeedLimits(
  legs: LonLat[][], decode: (s: string) => LonLat[], costing: "auto" | "truck" = "auto",
): Promise<LimitSegment[]> {
  const out: LimitSegment[] = [];
  let offset = 0;
  for (const leg of legs) {
    if (leg.length >= 2) {
      const segs = await legLimits(leg, costing, decode);
      for (const s of segs) out.push({ ...s, from: s.from + offset, to: s.to + offset });
    }
    offset += leg.length - 1;
  }
  return out;
}

/** Segment covering a given shape vertex index (binary search; segments are ordered). */
export function segmentAt(segs: LimitSegment[], shapeIndex: number): LimitSegment | undefined {
  let lo = 0, hi = segs.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = segs[mid];
    if (shapeIndex < s.from) hi = mid - 1;
    else if (shapeIndex >= s.to && mid < segs.length - 1) lo = mid + 1;
    else return s;
  }
  return undefined;
}

export const isMotorwayClass = (rc?: string) => rc === "motorway" || rc === "trunk";

/**
 * Effective limit for the HUD: the lower of the posted limit and an optional
 * tow cap (Phase 4 fills the cap from the trailer profile).
 */
export function effectiveLimit(posted?: number, towCap?: number): number | undefined {
  if (posted === undefined) return towCap;
  if (towCap === undefined) return posted;
  return Math.min(posted, towCap);
}

/** Over the limit, with a small tolerance so GPS jitter doesn't flash red. */
export function isSpeeding(speedKmh: number, limit?: number, toleranceKmh = 3): boolean {
  return limit !== undefined && speedKmh > limit + toleranceKmh;
}
