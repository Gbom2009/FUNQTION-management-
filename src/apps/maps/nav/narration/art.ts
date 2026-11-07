import type { FlatManeuver } from "../guidance";
import type { LimitSegment } from "../speed";
import { roadArms, segEndingAt } from "./events";

/**
 * Geometry for the maneuver icon, in the driver's frame: 0° = straight
 * ahead (up), +90° = right, −90° = left. Built from the real junction where
 * Valhalla knows it (intersecting edges), so the drawing matches the road.
 */
export interface ManeuverArt {
  kind: "roundabout" | "turn";
  /** where we leave, relative to the approach direction */
  exitAngle: number;
  /** other arms (not ours), same frame */
  arms: number[];
  /** roundabout exit number to print in the middle */
  exitNumber?: number;
}

export const rel = (heading: number, approach: number) => (((heading - approach) % 360) + 540) % 360 - 180;

/** Fallback when the roundabout's arms are unknown: exits evenly round a 4-arm roundabout. */
export function guessExitAngle(exitNumber: number, arms = 4): number {
  const step = 360 / arms;
  return rel(180 - exitNumber * step, 0); // entry at 180°, counter-clockwise (right-hand traffic)
}

export function maneuverArt(m: FlatManeuver, next: FlatManeuver | undefined, limits: LimitSegment[]): ManeuverArt | undefined {
  const approach = m.bearingBefore;
  if (m.type === 26) {
    const exitBearing = next?.type === 27 ? next.bearingAfter : undefined;
    const exitAngle = approach !== undefined && exitBearing !== undefined ? rel(exitBearing, approach) : guessExitAngle(m.roundaboutExit ?? 1);
    let arms: number[] = [];
    if (approach !== undefined) {
      const ring = limits.filter((s) => s.roundabout && s.from >= m.globalIndex - 1 && s.from <= (next?.globalIndex ?? m.globalIndex + 40));
      arms = ring.flatMap((s) => roadArms(s.arms).filter((a) => !a.sameName).map((a) => rel(a.heading, approach)))
        .filter((a) => Math.abs(rel(a, exitAngle)) > 25 && Math.abs(rel(a, 180)) > 25);
    }
    if (!arms.length) {
      // no arm data: draw the exits we pass, evenly between entry and exit
      const n = Math.max(1, m.roundaboutExit ?? 1);
      const sweep = ((180 - exitAngle) + 360) % 360 || 360;
      arms = Array.from({ length: n - 1 }, (_, i) => rel(180 - ((i + 1) * sweep) / n, 0));
    }
    return { kind: "roundabout", exitAngle, arms: dedupe(arms), exitNumber: m.roundaboutExit };
  }
  if (approach === undefined || m.bearingAfter === undefined) return undefined;
  if (![9, 10, 11, 14, 15, 16, 8, 22, 23, 24].includes(m.type)) return undefined;
  const exitAngle = rel(m.bearingAfter, approach);
  const seg = segEndingAt(limits, m.globalIndex);
  const arms = roadArms(seg?.arms).map((a) => rel(a.heading, approach)).filter((a) => Math.abs(rel(a, exitAngle)) > 20 && Math.abs(rel(a, 180)) > 20);
  return { kind: "turn", exitAngle, arms: dedupe(arms) };
}

function dedupe(a: number[]): number[] {
  const out: number[] = [];
  for (const x of a.sort((p, q) => p - q)) if (!out.some((y) => Math.abs(rel(x, y)) < 18)) out.push(x);
  return out;
}
