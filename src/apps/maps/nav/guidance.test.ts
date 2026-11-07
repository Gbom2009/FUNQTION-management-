import { describe, expect, it } from "vitest";
import { buildGeometry, GuidanceTracker, nextManeuverIndex, remainingTime } from "./guidance";
import { destination, haversine, project, cumulative, angleDiff, bearing, type LonLat } from "./geo";
import type { Route, Maneuver } from "./valhalla";
import type { Fix } from "../location/provider";

// L-shaped route: 1 km east, then 1 km north. Vertices every 100 m.
const A: LonLat = [5.6, 51.5];
const corner = destination(A, 90, 1000);
const east = Array.from({ length: 11 }, (_, i) => destination(A, 90, i * 100));
const north = Array.from({ length: 11 }, (_, i) => destination(corner, 0, i * 100));
const shape = [...east, ...north.slice(1)];

const man = (type: number, begin: number, lengthM: number, timeS: number, instruction: string): Maneuver => ({
  type, instruction, streetNames: [], lengthM, timeS, beginShapeIndex: begin, endShapeIndex: begin,
});

function lRoute(): Route {
  return {
    id: "r0",
    legs: [{
      shape, lengthM: 2000, timeS: 200,
      maneuvers: [man(2, 0, 1000, 100, "Rij oost"), man(15, 10, 1000, 100, "Sla linksaf"), man(4, 20, 0, 0, "Aangekomen")],
    }],
    shape, lengthM: 2000, timeS: 200, hasToll: false, hasHighway: false, hasFerry: false,
    bbox: [A[0], A[1], corner[0], north[10][1]],
  };
}

const fix = (p: LonLat, heading: number, speedKmh = 50, accuracyM = 5): Fix =>
  ({ lon: p[0], lat: p[1], heading, speedKmh, accuracyM, t: 0 });

describe("geo", () => {
  it("haversine ≈ 100 m between vertices", () => {
    expect(haversine(east[0], east[1])).toBeCloseTo(100, 0);
  });
  it("projects a point 20 m off the line", () => {
    const off = destination(destination(A, 90, 250), 0, 20);
    const pr = project(off, shape, cumulative(shape))!;
    expect(pr.offset).toBeCloseTo(20, 0);
    expect(pr.along).toBeCloseTo(250, 0);
  });
  it("angleDiff wraps around north", () => {
    expect(angleDiff(350, 10)).toBe(20);
    expect(angleDiff(90, 270)).toBe(180);
    expect(bearing(east[0], east[1])).toBeCloseTo(90, 0);
  });
});

describe("guidance geometry", () => {
  const g = buildGeometry(lRoute());
  it("places maneuvers along the route", () => {
    expect(g.total).toBeCloseTo(2000, -1);
    expect(g.maneuvers.map((m) => Math.round(m.along))).toEqual([0, 1000, 2000]);
  });
  it("next maneuver progresses", () => {
    expect(nextManeuverIndex(g, 0)).toBe(1);
    expect(nextManeuverIndex(g, 998)).toBe(1);
    expect(nextManeuverIndex(g, 1001)).toBe(2);
    expect(nextManeuverIndex(g, 2000)).toBe(-1);
  });
  it("interpolates remaining time", () => {
    expect(remainingTime(g, 0)).toBeCloseTo(200);
    expect(remainingTime(g, 500)).toBeCloseTo(150);
    expect(remainingTime(g, 1500)).toBeCloseTo(50);
  });
});

describe("GuidanceTracker", () => {
  it("follows the route and reports distance to the turn", () => {
    const t = new GuidanceTracker(buildGeometry(lRoute()));
    const s = t.update(fix(destination(A, 90, 300), 90));
    expect(s.next).toBe(1);
    expect(s.distToNext).toBeCloseTo(700, -1);
    expect(s.remainingM).toBeCloseTo(1700, -1);
    expect(s.offRoute).toBe(false);
  });

  it("declares off-route only after consecutive bad fixes", () => {
    const t = new GuidanceTracker(buildGeometry(lRoute()));
    t.update(fix(destination(A, 90, 300), 90));
    const off = (d: number) => fix(destination(destination(A, 90, 300 + d), 180, 120), 180);
    expect(t.update(off(10)).offRoute).toBe(false);
    expect(t.update(off(20)).offRoute).toBe(false);
    expect(t.update(off(30)).offRoute).toBe(true);
  });

  it("one GPS glitch does not trigger off-route", () => {
    const t = new GuidanceTracker(buildGeometry(lRoute()));
    t.update(fix(destination(A, 90, 300), 90));
    t.update(fix(destination(destination(A, 90, 320), 180, 120), 90));
    expect(t.update(fix(destination(A, 90, 340), 90)).offRoute).toBe(false);
  });

  it("tolerates poor accuracy", () => {
    const t = new GuidanceTracker(buildGeometry(lRoute()));
    const p = destination(destination(A, 90, 300), 180, 60);
    for (let i = 0; i < 5; i++) expect(t.update(fix(p, 90, 50, 50)).offRoute).toBe(false);
  });

  it("detects driving the wrong way", () => {
    const t = new GuidanceTracker(buildGeometry(lRoute()));
    let last = false;
    for (let i = 0; i < 6; i++) last = t.update(fix(destination(A, 90, 600 - i * 30), 270, 50)).offRoute;
    expect(last).toBe(true);
  });

  it("arrives at the end", () => {
    const t = new GuidanceTracker(buildGeometry(lRoute()));
    t.update(fix(destination(corner, 0, 900), 0));
    const s = t.update(fix(destination(corner, 0, 985), 0));
    expect(s.arrived).toBe(true);
  });
});
