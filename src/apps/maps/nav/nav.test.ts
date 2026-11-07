import { describe, expect, it } from "vitest";
import { decodePolyline } from "./polyline";
import { buildRouteBody, parseTrip, DEFAULT_OPTIONS } from "./valhalla";
import { parseWktPoint } from "./geocode";
import { formatDistance, formatDuration } from "./format";
import { createThrottle } from "./throttle";

describe("decodePolyline", () => {
  it("decodes the Google reference polyline at precision 5", () => {
    expect(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@", 5)).toEqual([
      [-120.2, 38.5], [-120.95, 40.7], [-126.453, 43.252],
    ]);
  });
  it("handles empty input", () => expect(decodePolyline("")).toEqual([]));
});

describe("buildRouteBody", () => {
  const a = { lat: 51.5, lon: 5.6 }, b = { lat: 51.4, lon: 5.4 }, c = { lat: 51.3, lon: 5.3 };
  it("maps avoid options to Valhalla costing options", () => {
    const body = buildRouteBody({ stops: [a, b], options: { ...DEFAULT_OPTIONS, avoidMotorways: true, avoidTolls: true, avoidFerries: true } });
    expect(body.costing).toBe("auto");
    expect((body.costing_options as Record<string, Record<string, number>>).auto).toMatchObject({ use_highways: 0, use_tolls: 0, use_ferry: 0 });
  });
  it("only requests alternates for 2 stops", () => {
    expect(buildRouteBody({ stops: [a, b], options: DEFAULT_OPTIONS, alternates: 2 }).alternates).toBe(2);
    expect(buildRouteBody({ stops: [a, b, c], options: DEFAULT_OPTIONS, alternates: 2 }).alternates).toBeUndefined();
  });
  it("uses Dutch by default", () => {
    expect(buildRouteBody({ stops: [a, b], options: DEFAULT_OPTIONS }).language).toBe("nl-NL");
  });
});

describe("parseTrip", () => {
  it("joins leg shapes without duplicating the shared stop point", () => {
    const leg = (shape: string) => ({ shape, summary: { time: 60, length: 1 }, maneuvers: [] });
    // two legs: (0,0)->(1,1) and (1,1)->(2,2) at precision 6
    const enc = (pts: [number, number][]) => {
      let out = "", plat = 0, plon = 0;
      const e = (v: number) => { let s = v < 0 ? ~(v << 1) : v << 1; let r = ""; while (s >= 0x20) { r += String.fromCharCode((0x20 | (s & 0x1f)) + 63); s >>= 5; } return r + String.fromCharCode(s + 63); };
      for (const [lon, lat] of pts) { const la = Math.round(lat * 1e6), lo = Math.round(lon * 1e6); out += e(la - plat) + e(lo - plon); plat = la; plon = lo; }
      return out;
    };
    const r = parseTrip({
      summary: { time: 120, length: 2, has_toll: false, has_highway: true, has_ferry: false, min_lat: 0, min_lon: 0, max_lat: 2, max_lon: 2 },
      legs: [leg(enc([[0, 0], [1, 1]])), leg(enc([[1, 1], [2, 2]]))],
    }, "r0");
    expect(r.shape).toEqual([[0, 0], [1, 1], [2, 2]]);
    expect(r.lengthM).toBe(2000);
    expect(r.bbox).toEqual([0, 0, 2, 2]);
  });
});

describe("parseWktPoint", () => {
  it("parses PDOK centroids", () => expect(parseWktPoint("POINT(5.64392646 51.5110139)")).toEqual({ lon: 5.64392646, lat: 51.5110139 }));
  it("rejects garbage", () => expect(parseWktPoint("nope")).toBeNull());
});

describe("format", () => {
  it("durations", () => {
    expect(formatDuration(1483)).toBe("25 min");
    expect(formatDuration(5400)).toBe("1 u 30");
    expect(formatDuration(3600, "en")).toBe("1 h");
    expect(formatDuration(3900, "en")).toBe("1 h 05");
  });
  it("distances", () => {
    expect(formatDistance(18241)).toBe("18,2 km");
    expect(formatDistance(18241, "en")).toBe("18.2 km");
    expect(formatDistance(452)).toBe("450 m");
    expect(formatDistance(152400)).toBe("152 km");
  });
});

describe("createThrottle", () => {
  it("spaces requests at least the interval apart", async () => {
    const q = createThrottle(50);
    const times: number[] = [];
    await Promise.all([1, 2, 3].map(() => q(async () => { times.push(Date.now()); })));
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(45);
    expect(times[2] - times[1]).toBeGreaterThanOrEqual(45);
  });
  it("keeps going after a failed task", async () => {
    const q = createThrottle(0);
    await expect(q(async () => { throw new Error("x"); })).rejects.toThrow("x");
    await expect(q(async () => 7)).resolves.toBe(7);
  });
});

import { matchesAllTokens } from "./geocode";
describe("matchesAllTokens", () => {
  it("accepts a full address match", () => {
    expect(matchesAllTokens({ name: "Dorpsstraat 10", detail: "5735ED Aarle-Rixtel" }, "dorpsstraat 10 aarle-rixtel")).toBe(true);
  });
  it("rejects PDOK fuzzy hits for venue names", () => {
    expect(matchesAllTokens({ name: "Gemeente Eindhoven", detail: "gemeente" }, "Effenaar Eindhoven")).toBe(false);
  });
  it("ignores accents and case", () => {
    expect(matchesAllTokens({ name: "Café de Zwaan" }, "cafe ZWAAN")).toBe(true);
  });
});
