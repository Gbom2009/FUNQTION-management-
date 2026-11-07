import type { Route, Maneuver } from "./valhalla";
import { angleDiff, cumulative, project, type LonLat } from "./geo";
import type { Fix } from "../location/provider";

/** Valhalla maneuver types we treat specially. */
export const START_TYPES = new Set([1, 2, 3]);
export const DESTINATION_TYPES = new Set([4, 5, 6]);

export interface FlatManeuver extends Maneuver {
  leg: number;
  /** index of the maneuver point in route.shape */
  globalIndex: number;
  /** distance along the route where this maneuver happens, m */
  along: number;
  /** elapsed planned time at this maneuver, s */
  timeAt: number;
}

export interface RouteGeometry {
  shape: LonLat[];
  cum: number[];
  total: number;
  maneuvers: FlatManeuver[];
  /** along-distance where each leg ends (= arrival at stop leg+1) */
  legEnds: number[];
  totalTime: number;
}

/** Precompute everything guidance needs. Legs share their joint vertex in route.shape. */
export function buildGeometry(route: Route): RouteGeometry {
  const shape = route.shape;
  const cum = cumulative(shape);
  const maneuvers: FlatManeuver[] = [];
  const legEnds: number[] = [];
  let offset = 0;
  let time = 0;
  route.legs.forEach((leg, li) => {
    for (const m of leg.maneuvers) {
      const gi = Math.min(offset + m.beginShapeIndex, shape.length - 1);
      maneuvers.push({ ...m, leg: li, globalIndex: gi, along: cum[gi], timeAt: time });
      time += m.timeS;
    }
    offset += leg.shape.length - 1;
    legEnds.push(cum[Math.min(offset, shape.length - 1)]);
  });
  return { shape, cum, total: cum[cum.length - 1] ?? 0, maneuvers, legEnds, totalTime: time };
}

export interface GuidanceState {
  snapped: LonLat;
  along: number;
  offset: number;
  /** index into geometry.maneuvers of the upcoming maneuver, -1 when none */
  next: number;
  distToNext: number;
  /** current leg (0-based); stops[leg+1] is the next stop */
  leg: number;
  remainingM: number;
  remainingS: number;
  /** remaining to the next stop (end of current leg) */
  legRemainingM: number;
  offRoute: boolean;
  arrived: boolean;
  /** segment bearing at the snapped position */
  routeBearing: number;
}

export interface TrackerConfig {
  /** off-route if further than this from the line (grows with GPS accuracy) */
  offRouteM: number;
  /** consecutive bad fixes before declaring off-route */
  offRouteFixes: number;
  /** heading mismatch counted as "wrong way" above this speed */
  wrongWayKmh: number;
  arriveM: number;
}

export const DEFAULT_TRACKER: TrackerConfig = { offRouteM: 40, offRouteFixes: 3, wrongWayKmh: 15, arriveM: 30 };

/** Index of the next maneuver ahead of `along` (skips the start maneuvers of legs > 0, which coincide with the previous leg's arrival). */
export function nextManeuverIndex(g: RouteGeometry, along: number): number {
  for (let i = 0; i < g.maneuvers.length; i++) {
    const m = g.maneuvers[i];
    if (m.leg > 0 && START_TYPES.has(m.type)) continue;
    if (m.along > along + 1) return i;
  }
  return -1;
}

/** Planned remaining time from `along`, interpolated inside the current maneuver. */
export function remainingTime(g: RouteGeometry, along: number): number {
  const ms = g.maneuvers;
  if (!ms.length) return 0;
  let i = 0;
  while (i + 1 < ms.length && ms[i + 1].along <= along) i++;
  const m = ms[i];
  const segEnd = i + 1 < ms.length ? ms[i + 1].along : g.total;
  const segLen = segEnd - m.along;
  const frac = segLen > 0 ? Math.min(1, Math.max(0, (along - m.along) / segLen)) : 1;
  return Math.max(0, g.totalTime - (m.timeAt + m.timeS * frac));
}

/**
 * Stateful route follower: snaps fixes to the route, tracks progress, detects
 * off-route and arrival. Only searches a window ahead of the last position so
 * a route that doubles back on the same road can't make it jump.
 */
export class GuidanceTracker {
  private seg = 0;
  private bad = 0;
  private wrongWay = 0;
  private started = false;
  constructor(readonly g: RouteGeometry, private cfg: TrackerConfig = DEFAULT_TRACKER) {}

  update(f: Fix): GuidanceState {
    const g = this.g;
    const p: LonLat = [f.lon, f.lat];
    // Window: from a little behind the last segment to ~1.5 km ahead (or whole route on first fix).
    let from = 0, to = g.shape.length - 1;
    if (this.started) {
      from = this.seg;
      while (from > 0 && g.cum[this.seg] - g.cum[from] < 50) from--;
      to = this.seg;
      while (to < g.shape.length - 1 && g.cum[to] - g.cum[this.seg] < 1500) to++;
    }
    const pr = project(p, g.shape, g.cum, from, to) ?? project(p, g.shape, g.cum)!;
    this.started = true;

    const limit = Math.max(this.cfg.offRouteM, f.accuracyM * 1.5);
    const far = pr.offset > limit;
    const wrong = f.speedKmh > this.cfg.wrongWayKmh && angleDiff(f.heading, pr.segmentBearing) > 120;
    this.bad = far ? this.bad + 1 : 0;
    this.wrongWay = wrong ? this.wrongWay + 1 : 0;
    // Only advance along the route when we're actually on it.
    if (!far) this.seg = pr.segment;
    const offRoute = this.bad >= this.cfg.offRouteFixes || this.wrongWay >= this.cfg.offRouteFixes + 2;

    const along = pr.along;
    const next = nextManeuverIndex(g, along);
    let leg = g.legEnds.findIndex((end) => along < end - this.cfg.arriveM);
    if (leg < 0) leg = g.legEnds.length - 1;
    const remainingM = Math.max(0, g.total - along);
    return {
      snapped: pr.point,
      along,
      offset: pr.offset,
      next,
      distToNext: next >= 0 ? g.maneuvers[next].along - along : remainingM,
      leg,
      remainingM,
      remainingS: remainingTime(g, along),
      legRemainingM: Math.max(0, g.legEnds[leg] - along),
      offRoute,
      arrived: !far && remainingM <= this.cfg.arriveM,
      routeBearing: pr.segmentBearing,
    };
  }

  /** After a reroute or manual reset. */
  resetOffRoute() { this.bad = 0; this.wrongWay = 0; }
}
