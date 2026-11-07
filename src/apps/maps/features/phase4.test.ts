import { describe, expect, it } from "vitest";
import { combinedDims, towCapFor, NL_TOW_DEFAULTS } from "./vehicles/profiles";
import { leaveBy, localDateTime, urgency } from "./gigs/leaveBy";
import { computeTowWarnings } from "./vehicles/towWarnings";
import { etaMessage } from "./gigs/shareEta";
import { buildRouteBody, DEFAULT_OPTIONS } from "../nav/valhalla";
import { buildGeometry } from "../nav/guidance";
import { destination, type LonLat } from "../nav/geo";
import { gradientFor, pulsesAt } from "../map/waveformRoute";
import type { Route } from "../nav/valhalla";

describe("combinedDims", () => {
  it("adds lengths and weights, takes max width/height", () => {
    const d = combinedDims(
      { id: "c", name: "RR", lengthM: 4.95, widthM: 2.05, heightM: 1.82, weightKg: 2600 },
      { id: "t", name: "DJ", lengthM: 4.2, widthM: 1.9, heightM: 2.3, weightKg: 1300 },
    );
    expect(d).toEqual({ lengthM: 9.2, widthM: 2.1, heightM: 2.3, weightT: 3.9, estimated: [] });
  });
  it("flags fallbacks for empty fields", () => {
    const d = combinedDims({ id: "c", name: "RR" }, { id: "t", name: "DJ", heightM: 2.5 });
    expect(d.estimated).toContain("car.lengthM");
    expect(d.estimated).toContain("trailer.weightKg");
    expect(d.estimated).not.toContain("trailer.heightM");
    expect(d.heightM).toBe(2.5);
  });
});

describe("towCapFor (NL defaults 90/80/50)", () => {
  const c = NL_TOW_DEFAULTS;
  it("motorway and autoweg → 90", () => {
    expect(towCapFor(c, "motorway", 130)).toBe(90);
    expect(towCapFor(c, "trunk", 100)).toBe(90);
  });
  it("posted ≤ 50 → built-up → 50", () => {
    expect(towCapFor(c, "secondary", 50)).toBe(50);
    expect(towCapFor(c, "residential", 30)).toBe(50);
  });
  it("other roads outside built-up → 80", () => {
    expect(towCapFor(c, "primary", 80)).toBe(80);
    expect(towCapFor(c, "secondary", 60)).toBe(80);
    expect(towCapFor(c, "primary")).toBe(80);
  });
});

describe("leave-by", () => {
  it("load-in − buffer − drive × (1 + margin)", () => {
    // 18:00 load-in, 60 min setup, 40 min drive + 15% = 46 min → 16:14
    const d = leaveBy({ date: "2026-11-20", loadIn: "18:00", setupBufferMin: 60, routeS: 40 * 60, trafficMarginPct: 15 })!;
    expect(d.getHours()).toBe(16);
    expect(d.getMinutes()).toBe(14);
  });
  it("rounds down to the minute, never later", () => {
    const d = leaveBy({ date: "2026-11-20", loadIn: "18:00", setupBufferMin: 0, routeS: 61, trafficMarginPct: 0 })!;
    expect(d.getHours()).toBe(17);
    expect(d.getMinutes()).toBe(58);
  });
  it("crosses midnight", () => {
    const d = leaveBy({ date: "2026-11-20", loadIn: "00:30", setupBufferMin: 60, routeS: 30 * 60, trafficMarginPct: 0 })!;
    expect(d.getDate()).toBe(19);
    expect(d.getHours()).toBe(23);
    expect(d.getMinutes()).toBe(0);
  });
  it("rejects bad input", () => {
    expect(localDateTime("20-11-2026", "18:00")).toBeNull();
    expect(leaveBy({ date: "2026-11-20", loadIn: "", setupBufferMin: 0, routeS: 0, trafficMarginPct: 0 })).toBeNull();
  });
  it("urgency bands", () => {
    const now = new Date(2026, 10, 20, 12, 0);
    expect(urgency(new Date(2026, 10, 20, 14, 0), now)).toBe("later");
    expect(urgency(new Date(2026, 10, 20, 12, 30), now)).toBe("soon");
    expect(urgency(new Date(2026, 10, 20, 12, 3), now)).toBe("now");
    expect(urgency(new Date(2026, 10, 20, 11, 59), now)).toBe("late");
  });
});

describe("truck routing body", () => {
  it("uses truck costing with combined dims and top speed", () => {
    const body = buildRouteBody({
      stops: [{ lat: 51.5, lon: 5.6 }, { lat: 51.4, lon: 5.4 }], options: DEFAULT_OPTIONS,
      tow: { lengthM: 9.2, widthM: 2.1, heightM: 2.3, weightT: 3.9, topSpeedKmh: 90 },
    });
    expect(body.costing).toBe("truck");
    expect((body.costing_options as Record<string, object>).truck).toMatchObject({ length: 9.2, width: 2.1, height: 2.3, weight: 3.9, top_speed: 90, use_highways: 1 });
  });
});

describe("tow warnings", () => {
  const A: LonLat = [5.6, 51.5];
  const shape = Array.from({ length: 31 }, (_, i) => destination(A, 90, i * 100));
  const route: Route = {
    id: "r", shape, lengthM: 3000, timeS: 300, hasToll: false, hasHighway: false, hasFerry: false, bbox: [0, 0, 0, 0],
    legs: [{ shape, lengthM: 3000, timeS: 300, maneuvers: [
      { type: 1, instruction: "", streetNames: [], lengthM: 1000, timeS: 100, beginShapeIndex: 0, endShapeIndex: 10 },
      { type: 14, instruction: "", streetNames: [], lengthM: 2000, timeS: 200, beginShapeIndex: 10, endShapeIndex: 30 },
      { type: 4, instruction: "", streetNames: [], lengthM: 0, timeS: 0, beginShapeIndex: 30, endShapeIndex: 30 },
    ] }],
  };
  const g = buildGeometry(route);
  it("flags sharp turns, narrow roads and steep descents", () => {
    const limits = [
      { from: 0, to: 15, roadClass: "secondary" },
      { from: 15, to: 20, roadClass: "service_other" },
      { from: 20, to: 30, roadClass: "residential" },
    ];
    const heights: [number, number][] = Array.from({ length: 31 }, (_, i) => [i * 100, i >= 20 && i <= 24 ? 100 - (i - 20) * 8 : i > 24 ? 68 : 100]);
    const w = computeTowWarnings(g, limits, heights);
    expect(w.map((x) => x.kind)).toEqual(["sharp", "narrow", "descent"]);
    expect(Math.round(w[1].along)).toBe(1500);
    expect(w[2].gradePct).toBeLessThanOrEqual(-6);
  });
  it("flat route has no descent warnings", () => {
    const flat: [number, number][] = Array.from({ length: 31 }, (_, i) => [i * 100, 10 + (i % 2)]);
    expect(computeTowWarnings(g, [], flat).filter((x) => x.kind === "descent")).toEqual([]);
  });
});

describe("share ETA", () => {
  it("matches the brief's message", () => {
    expect(etaMessage(new Date(2026, 10, 20, 17, 42), { lang: "nl", towing: true })).toBe("Onderweg met de trailer, ETA 17:42 🎧");
    expect(etaMessage(new Date(2026, 10, 20, 9, 5), { lang: "en", towing: false, venue: "Effenaar" })).toBe("On the way to Effenaar, ETA 09:05 🎧");
  });
});

describe("waveform", () => {
  it("drive mode is one calm pulse; plan mode has four", () => {
    expect(pulsesAt(3, "drive")).toHaveLength(1);
    expect(pulsesAt(3, "plan")).toHaveLength(4);
    expect(pulsesAt(3, "drive")[0].alpha).toBeLessThan(pulsesAt(3, "plan")[0].alpha);
  });
  it("pulses travel along the line", () => {
    expect(pulsesAt(0, "drive")[0].pos).toBe(0);
    expect(pulsesAt(5, "drive")[0].pos).toBeCloseTo(0.5);
  });
  it("gradient stops are strictly ascending within [0,1]", () => {
    for (const t of [0, 0.3, 2.9, 5.99, 7.1]) {
      const g = gradientFor(pulsesAt(t, "plan"), 0.035) as unknown[];
      const stops = g.slice(3).filter((_, i) => i % 2 === 0) as number[];
      expect(stops[0]).toBe(0);
      expect(stops[stops.length - 1]).toBe(1);
      for (let i = 1; i < stops.length; i++) expect(stops[i]).toBeGreaterThan(stops[i - 1]);
    }
  });
});
