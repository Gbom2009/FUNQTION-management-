import { describe, expect, it } from "vitest";
import { evHints, inZone, parseZones, urbanStretches, zoneEntries } from "./phev/zones";
import { parsePois } from "./phev/chargers";
import { bitsToOptions, decodeRoute, encodeRoute, makePayload, optionsToBits, parseFqRoute, toFqRoute } from "./handoff/routeCode";
import { seasonStats } from "./stats/season";
import { createDecimator } from "./stats/tracks";
import { projectTracks } from "./stats/story";
import { wantsPack } from "./offline/packs";
import { buildGeometry } from "../nav/guidance";
import { destination, type LonLat } from "../nav/geo";
import { DEFAULT_OPTIONS, type Route } from "../nav/valhalla";
import type { Trip } from "./stats/tripLog";

// a zone spanning 2–3 km east of A, on an eastbound 5 km route
const A: LonLat = [5.6, 51.5];
const shape = Array.from({ length: 51 }, (_, i) => destination(A, 90, i * 100));
const x = (m: number) => destination(A, 90, m)[0];
const sq: LonLat[] = [[x(2000), 51.495], [x(3000), 51.495], [x(3000), 51.505], [x(2000), 51.505], [x(2000), 51.495]];
const zones = parseZones({ features: [{ id: "z", properties: { name: "Milieuzone Test" }, geometry: { type: "Polygon", coordinates: [sq] } }] });
const route: Route = {
  id: "r", shape, lengthM: 5000, timeS: 500, hasToll: false, hasHighway: false, hasFerry: false, bbox: [0, 0, 0, 0],
  legs: [{ shape, lengthM: 5000, timeS: 500, maneuvers: [{ type: 1, instruction: "", streetNames: [], lengthM: 5000, timeS: 500, beginShapeIndex: 0, endShapeIndex: 50 }] }],
};
const g = buildGeometry(route);

describe("milieuzones", () => {
  it("point in zone, with holes respected", () => {
    expect(inZone(destination(A, 90, 2500), zones[0])).toBe(true);
    expect(inZone(destination(A, 90, 1500), zones[0])).toBe(false);
    const hole: LonLat[] = [[x(2400), 51.499], [x(2600), 51.499], [x(2600), 51.501], [x(2400), 51.501], [x(2400), 51.499]];
    const z2 = parseZones({ features: [{ properties: {}, geometry: { type: "Polygon", coordinates: [sq, hole] } }] })[0];
    expect(inZone(destination(A, 90, 2500), z2)).toBe(false);
    expect(inZone(destination(A, 90, 2200), z2)).toBe(true);
  });
  it("finds where the route enters a zone", () => {
    const e = zoneEntries(g, zones);
    expect(e).toHaveLength(1);
    // the zone starts at 2000 m; the first vertex on/inside it is the entry
    expect(e[0].along).toBeGreaterThanOrEqual(1950);
    expect(e[0].along).toBeLessThanOrEqual(2150);
  });
  it("urban stretches merge short gaps and drop short ones", () => {
    const limits = [
      { from: 0, to: 10, limitKmh: 80 },
      { from: 10, to: 20, limitKmh: 50 },
      { from: 20, to: 22, limitKmh: 70 },
      { from: 22, to: 30, limitKmh: 30 },
      { from: 30, to: 40, limitKmh: 80 },
      { from: 40, to: 45, limitKmh: 50 },
    ];
    const u = urbanStretches(g, limits);
    expect(u).toHaveLength(1);
    expect(Math.round(u[0].from)).toBe(1000);
    expect(Math.round(u[0].to)).toBe(3000);
  });
  it("EV hints respect the electric range", () => {
    const e = zoneEntries(g, zones);
    const u = [{ from: 1000, to: 3000 }];
    expect(evHints(e, u).map((h) => h.kind)).toEqual(["zone"]);
    expect(evHints(e, u, 0.5)).toEqual([]);
    expect(evHints([], [{ from: 0, to: 2000 }], 40).map((h) => h.kind)).toEqual(["urban"]);
  });
});

describe("chargers", () => {
  it("parses compact OCM POIs", () => {
    const [c] = parsePois([{ ID: 7, AddressInfo: { Title: "Laadplein", AddressLine1: "Markt 1", Town: "Helmond", Latitude: 51.48, Longitude: 5.66 },
      Connections: [{ ConnectionTypeID: 25, PowerKW: 11 }, { ConnectionTypeID: 33, PowerKW: 150 }], NumberOfPoints: 4 }]);
    expect(c).toMatchObject({ id: 7, name: "Laadplein", address: "Markt 1, Helmond", maxKw: 150, points: 4, connectors: ["Type 2", "CCS"] });
  });
});

describe("route handoff", () => {
  const opts = { ...DEFAULT_OPTIONS, avoidTolls: true, shortest: true };
  const payload = makePayload(
    [{ name: "Thuis (Aarle-Rixtel)", lat: 51.509712345, lon: 5.638612345 }, { name: "Effenaar — laad-in deur", lat: 51.44141, lon: 5.48351 }],
    opts, "Range Rover Sport P440e", { name: "DJ gear trailer", l: 4.2, w: 1.9, h: 2.3, kg: 1300 },
  );
  it("options round-trip through the bitmask", () => {
    expect(bitsToOptions(optionsToBits(opts))).toEqual(opts);
  });
  it("encodes to a compact QR-sized code and back", async () => {
    const code = await encodeRoute(payload);
    expect(code.startsWith("FQR1.")).toBe(true);
    expect(code.length).toBeLessThan(400);
    const back = await decodeRoute(code);
    expect(back).toEqual(payload);
    expect(back.stops[0].lat).toBe(51.50971);
  });
  it("accepts the deep-link form and rejects junk", async () => {
    const code = await encodeRoute(payload);
    await expect(decodeRoute(`fqmaps://route?d=${code}`)).resolves.toEqual(payload);
    await expect(decodeRoute("hello")).rejects.toThrow();
    await expect(decodeRoute("FQR0.eyJ2IjoyfQ")).rejects.toThrow(); // {"v":2}
  });
  it(".fqroute files round-trip", () => {
    expect(parseFqRoute(toFqRoute(payload, [[5.6, 51.5], [5.5, 51.4]])).plan).toEqual(payload);
    expect(() => parseFqRoute('{"format":"other"}')).toThrow();
  });
});

describe("season stats", () => {
  const trip = (d: string, km: number, extra: Partial<Trip> = {}): Trip =>
    ({ id: d, startedAt: Date.parse(d), endedAt: Date.parse(d) + 3_600_000, km, arrived: true, ...extra });
  const venues = [
    { id: "v1", name: "Effenaar", photos: [], address: { id: "a", name: "x", lat: 51.441, lon: 5.483, source: "pdok" as const } },
    { id: "v2", name: "Paradiso", photos: [], loadInDoor: { lat: 52.362, lon: 4.884 } },
  ];
  const gigs = [
    { id: "g1", title: "Club", venueId: "v1", date: "2026-03-01", loadIn: "20:00", setupBufferMin: 60, trafficMarginPct: 10 },
    { id: "g2", title: "Ams", venueId: "v2", date: "2026-05-01", loadIn: "20:00", setupBufferMin: 60, trafficMarginPct: 10 },
  ];
  it("totals km, towed km, gigs and the furthest venue", () => {
    const s = seasonStats([trip("2026-03-01T18:00:00Z", 20, { gigId: "g1", trailer: "DJ" }), trip("2026-05-01T16:00:00Z", 120, { gigId: "g2" }),
      trip("2025-12-31T10:00:00Z", 999)], gigs, venues, 2026, [5.6386, 51.5097]);
    expect(s).toMatchObject({ trips: 2, km: 140, towKm: 20, gigs: 2, hours: 2 });
    expect(s.furthest?.name).toBe("Paradiso");
    expect(s.furthest!.km).toBeGreaterThan(90);
  });
});

describe("tracks + story", () => {
  it("decimates to ≥ 50 m spacing", () => {
    const d = createDecimator(50);
    for (let i = 0; i <= 100; i++) d.push(destination(A, 90, i * 10)); // 1 km in 10 m steps
    // ~every 50–60 m (float rounding can push a step to the next 10 m)
    expect(d.points().length).toBeGreaterThanOrEqual(17);
    expect(d.points().length).toBeLessThanOrEqual(21);
  });
  it("projects tracks into the box keeping aspect", () => {
    const [l] = projectTracks([[A, destination(A, 0, 1000)]], { x: 0, y: 0, w: 100, h: 100 });
    expect(Math.abs(l[0][0] - l[1][0])).toBeLessThan(1e-6);
    expect(Math.round(Math.abs(l[0][1] - l[1][1]))).toBe(100);
    expect(projectTracks([], { x: 0, y: 0, w: 1, h: 1 })).toEqual([]);
  });
});

describe("offline mode", () => {
  it("uses the pack only when wanted", () => {
    expect(wantsPack("auto", "nb.pmtiles", true)).toBe(false);
    expect(wantsPack("auto", "nb.pmtiles", false)).toBe(true);
    expect(wantsPack("always", "nb.pmtiles", true)).toBe(true);
    expect(wantsPack("never", "nb.pmtiles", false)).toBe(false);
    expect(wantsPack("always", null, false)).toBe(false);
  });
});
