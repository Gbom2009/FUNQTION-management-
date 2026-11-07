import { describe, expect, it } from "vitest";
import { buildEvents, turnContext } from "./events";
import { richInstruction } from "./instructions";
import { guessExitAngle, maneuverArt, rel } from "./art";
import { topicOn } from "./settings";
import { buildGeometry, type FlatManeuver } from "../guidance";
import { destination, type LonLat } from "../geo";
import { classify, routeBoxes, simplify, snapFeatures } from "../osmFeatures";
import { cameraWarningsAllowed, setBorders } from "../country";
import type { Route } from "../valhalla";
import type { LimitSegment } from "../speed";
import { rulesForZone, zoneVerdict, describeZone } from "../../features/phev/zoneRules";
import { autoCosting, rangeFor, towChecks, tripCost, effectiveHeight } from "../../features/vehicles/apply";
import { combinedDims, type Vehicle, type Trailer } from "../../features/vehicles/profiles";

const A: LonLat = [5.6, 51.5];
const shape = Array.from({ length: 31 }, (_, i) => destination(A, 90, i * 100)); // 3 km east
const man = (type: number, begin: number, extra: Partial<FlatManeuver> = {}) =>
  ({ type, instruction: "x", streetNames: [], lengthM: 0, timeS: 0, beginShapeIndex: begin, endShapeIndex: begin, ...extra });
const route: Route = {
  id: "r", shape, lengthM: 3000, timeS: 300, hasToll: false, hasHighway: false, hasFerry: false, bbox: [0, 0, 0, 0],
  legs: [{ shape, lengthM: 3000, timeS: 300, maneuvers: [man(1, 0), man(15, 10, { verbalPre: "Sla linksaf naar de Kerkstraat.", verbalAlert: "Links afslaan naar de Kerkstraat.", bearingBefore: 90, bearingAfter: 0 }), man(4, 30)] as never }],
};
const g = buildGeometry(route);
const all = () => true;

describe("narration events", () => {
  const limits: LimitSegment[] = [
    { from: 0, to: 5, limitKmh: 50, roadClass: "residential" },
    { from: 5, to: 10, limitKmh: 50, roadClass: "residential", signal: true, arms: [{ heading: 0, use: "road", roadClass: "residential" }, { heading: 180, use: "cycleway" }] },
    { from: 10, to: 20, limitKmh: 80, roadClass: "secondary", cycleLane: "dedicated", tunnel: true },
    { from: 20, to: 25, limitKmh: 80, roadClass: "residential", arms: [{ heading: 0, use: "road", roadClass: "residential" }] },
    { from: 25, to: 30, limitKmh: 80, roadClass: "residential", arms: [{ heading: 0, use: "road", roadClass: "residential" }] },
  ];
  const features = [
    { id: "c1", kind: "camera" as const, lat: 0, lon: 0, along: 1500, value: 80 },
    { id: "z1", kind: "zebra" as const, lat: 0, lon: 0, along: 700 },
    { id: "h1", kind: "maxheight" as const, lat: 0, lon: 0, along: 2000, value: 2.2 },
  ];
  const ev = buildEvents({ g, limits, features, zones: [], vehicleLabel: "auto", heightM: 2.6, on: all, lang: "nl" });
  const ids = ev.map((e) => e.topic);

  it("covers cameras, zebra, tunnel, limit change, priority and a too-low bridge", () => {
    expect(ids).toEqual(expect.arrayContaining(["camera", "zebra", "tunnel", "speedLimit", "priority", "height"]));
  });
  it("too-low clearance is critical and announced twice", () => {
    const h = ev.filter((e) => e.topic === "height");
    expect(h).toHaveLength(2);
    expect(h.every((e) => e.prio === 0)).toBe(true);
    expect(h[0].text(1500)).toContain("2,2 meter");
    expect(h[0].text(1500)).toContain("2,6 meter");
  });
  it("speaks distances the way people say them", () => {
    const cam = ev.find((e) => e.topic === "camera")!;
    expect(cam.text(500)).toBe("Flitser over 500 meter, maximaal 80.");
    expect(ev.find((e) => e.topic === "speedLimit")!.text(0)).toBe("De maximumsnelheid wordt 80.");
  });
  it("respects topic switches", () => {
    const only = buildEvents({ g, limits, features, zones: [], vehicleLabel: "auto", heightM: 2.6, on: (t) => t === "camera", lang: "nl" });
    expect(new Set(only.map((e) => e.topic))).toEqual(new Set(["camera", "height"])); // height is always on
  });
  it("doesn't call a junction at a turn 'straight on'", () => {
    expect(ev.some((e) => e.topic === "lights" && Math.abs(e.along - 1000) < 50)).toBe(false);
  });
});

describe("rich turn instructions", () => {
  const limits: LimitSegment[] = [
    { from: 0, to: 10, roadClass: "residential", signal: true, arms: [{ heading: 0, use: "road" }, { heading: 200, use: "cycleway" }] },
    { from: 10, to: 30, roadClass: "residential", oneway: true, cycleLane: "dedicated", names: ["Kerkstraat"] },
  ];
  const m = g.maneuvers[1];
  const ctx = turnContext(m, limits);
  it("reads the junction", () => {
    expect(ctx).toMatchObject({ signal: true, crossesBikePath: true, cycleOnNext: true, onewayNext: true, nextStreet: "Kerkstraat" });
  });
  it("adds traffic lights, bike path and one-way to the turn", () => {
    const now = richInstruction(m, "now", 30, "nl", false, ctx, undefined, all);
    expect(now).toBe("Bij de verkeerslichten, sla linksaf naar de Kerkstraat. Je kruist een fietspad, let op fietsers. Dat is een eenrichtingsweg.");
    const mid = richInstruction(m, "mid", 200, "nl", false, ctx, undefined, all);
    expect(mid.startsWith("Over 200 meter, bij de verkeerslichten, linksaf")).toBe(true);
  });
  it("stays plain when turn details are off", () => {
    expect(richInstruction(m, "now", 30, "nl", false, ctx, undefined, () => false)).toBe("Sla linksaf naar de Kerkstraat.");
  });
  it("chains a maneuver that follows right after", () => {
    const next = { ...g.maneuvers[1], along: m.along + 80, type: 10, verbalSuccinct: "Rechts afslaan." } as FlatManeuver;
    expect(richInstruction(m, "now", 30, "nl", false, ctx, next, (t) => t === "turnDetail")).toContain("En daarna direct rechtsaf.");
  });
});

describe("junction art", () => {
  it("relative angles", () => {
    expect(rel(0, 90)).toBe(-90);
    expect(rel(180, 90)).toBe(90);
    expect(rel(90, 90)).toBe(0);
  });
  it("guesses roundabout exits counter-clockwise (right-hand traffic)", () => {
    expect(guessExitAngle(1)).toBe(90);   // first exit: right
    expect(guessExitAngle(2)).toBe(0);    // straight on
    expect(guessExitAngle(3)).toBe(-90);  // left
  });
  it("uses the real exit bearing and arms", () => {
    const rb = { ...g.maneuvers[1], type: 26, roundaboutExit: 2, bearingBefore: 0 } as FlatManeuver;
    const ex = { ...g.maneuvers[2], type: 27, bearingAfter: 10, globalIndex: 14 } as FlatManeuver;
    const limits: LimitSegment[] = [
      { from: 10, to: 12, roundabout: true, arms: [{ heading: 95, use: "road" }, { heading: 300, use: "road", sameName: true }] },
      { from: 12, to: 14, roundabout: true, arms: [{ heading: 270, use: "footway" }] },
    ];
    const art = maneuverArt(rb, ex, limits)!;
    expect(art.kind).toBe("roundabout");
    expect(art.exitAngle).toBe(10);
    expect(art.arms).toEqual([95]); // ring continuation (same name) and footway dropped
    expect(art.exitNumber).toBe(2);
  });
});

describe("guidance levels", () => {
  it("topics switch on by level; overrides win; height is always on", () => {
    expect(topicOn("zebra", "normaal", {})).toBe(false);
    expect(topicOn("zebra", "uitgebreid", {})).toBe(true);
    expect(topicOn("zoneDetail", "max", {})).toBe(true);
    expect(topicOn("camera", "max", { camera: false })).toBe(false);
    expect(topicOn("height", "kort", { height: false })).toBe(true);
  });
});

describe("OSM features", () => {
  it("classifies tags", () => {
    expect(classify({ type: "node", id: 1, tags: { highway: "speed_camera", maxspeed: "80" } })).toEqual({ kind: "camera", value: 80 });
    expect(classify({ type: "node", id: 2, tags: { highway: "crossing", crossing_ref: "zebra" } })?.kind).toBe("zebra");
    expect(classify({ type: "node", id: 3, tags: { railway: "level_crossing" } })?.kind).toBe("rail");
    expect(classify({ type: "way", id: 4, tags: { maxheight: "3,2 m" } })).toEqual({ kind: "maxheight", value: 3.2 });
    expect(classify({ type: "node", id: 5, tags: { amenity: "bench" } })).toBeNull();
  });
  it("snaps to the route and drops what is off it", () => {
    setBorders([[[[5, 51], [6.5, 51], [6.5, 52], [5, 52], [5, 51]]]]);
    const on = destination(destination(A, 90, 1200), 0, 8), off = destination(destination(A, 90, 1200), 0, 120);
    const f = snapFeatures([
      { type: "node", id: 1, lat: on[1], lon: on[0], tags: { railway: "level_crossing" } },
      { type: "node", id: 2, lat: off[1], lon: off[0], tags: { railway: "level_crossing" } },
    ], g);
    expect(f).toHaveLength(1);
    expect(Math.round(f[0].along / 10) * 10).toBe(1200);
  });
  it("simplifies straight lines and boxes the route", () => {
    expect(simplify(shape, 5)).toHaveLength(2);
    expect(routeBoxes(shape).length).toBe(1);
  });
  it("speed cameras only inside NL/BE and away from foreign borders", () => {
    setBorders([[[[5, 51], [6.5, 51], [6.5, 52], [5, 52], [5, 51]]]]);
    expect(cameraWarningsAllowed(5.75, 51.5)).toBe(true);
    expect(cameraWarningsAllowed(6.49, 51.5)).toBe(false); // ~700 m from the border
    expect(cameraWarningsAllowed(7, 51.5)).toBe(false);    // outside
    setBorders([]);
    expect(cameraWarningsAllowed(5.75, 51.5)).toBe(false); // unknown → safe
  });
});

describe("milieuzone rules", () => {
  const rr: Vehicle = { id: "rr", name: "Range Rover", fuel: "phev-benzine", category: "personenauto" };
  const oldDiesel: Vehicle = { id: "d", name: "Oude diesel", fuel: "diesel", euroClass: 4, category: "personenauto" };
  it("matches zone names to cities (longest wins)", () => {
    expect(rulesForZone("Milieuzone Rotterdam Maasvlakte")?.city).toBe("Rotterdam Maasvlakte");
    expect(rulesForZone("Milieuzone Utrecht")?.dieselCarMin).toBe(5);
    expect(rulesForZone("Milieuzone Nergensdorp")).toBeUndefined();
  });
  it("petrol PHEV may enter everywhere; Euro 4 diesel not in Utrecht but yes in Den Haag", () => {
    expect(zoneVerdict(rulesForZone("Milieuzone Utrecht"), rr).access).toBe("allowed");
    expect(zoneVerdict(rulesForZone("Milieuzone Utrecht"), oldDiesel).access).toBe("banned");
    expect(zoneVerdict(rulesForZone("Milieuzone Den Haag"), oldDiesel).access).toBe("allowed");
    expect(zoneVerdict(rulesForZone("Milieuzone Breda"), oldDiesel).access).toBe("notApplicable");
    expect(zoneVerdict(rulesForZone("Milieuzone Utrecht"), { ...oldDiesel, euroClass: undefined }).access).toBe("unknown");
  });
  it("max-level description explains the rules and the verdict", () => {
    const s = describeZone("Milieuzone Amsterdam", rulesForZone("Milieuzone Amsterdam"), rr, "Range Rover");
    expect(s).toContain("emissieklasse 5");
    expect(s).toContain("130 euro");
    expect(s).toContain("Jouw Range Rover mag erin.");
  });
});

describe("vehicle application", () => {
  const v: Vehicle = { id: "v", name: "RR", heightM: 1.82, widthM: 2.2, roofBoxCm: 40, cruiseKmh: 115, maxMassKg: 3200, towBraked: 3500, towUnbraked: 750,
    tankL: 80, fuelPer100: 10, fuelLevelPct: 50, evRangeKm: 100, batteryLevelPct: 80, fuel: "phev-benzine", fuelPrice: 2, kwhPer100: 25, kwhPrice: 0.3 };
  const t: Trailer = { id: "t", name: "DJ", weightKg: 1300, maxMassKg: 1500, braked: true, lengthM: 4, heightM: 2.3 };
  it("routes with roof box height, width and cruise speed", () => {
    expect(effectiveHeight(v)).toBe(2.22);
    expect(autoCosting(v)).toEqual({ height: 2.22, width: 2.2, top_speed: 115 });
    expect(combinedDims(v, t).heightM).toBe(2.3);
  });
  it("licence check: B is not enough for 3200 + 1500 kg; BE is", () => {
    expect(towChecks(v, t, "B").some((c) => c.key === "check.licence")).toBe(true);
    expect(towChecks(v, t, "B96").some((c) => c.key === "check.licence")).toBe(true); // 4700 > 4250
    expect(towChecks(v, t, "BE").some((c) => c.level === "error")).toBe(false);
  });
  it("flags an overweight or unbraked trailer", () => {
    expect(towChecks({ ...v, towBraked: 1000 }, t, "BE").some((c) => c.key === "check.overTow")).toBe(true);
    expect(towChecks(v, { ...t, braked: false }, "BE").some((c) => c.key === "check.unbraked750")).toBe(true);
  });
  it("range and cost, with the towing factor", () => {
    const r = rangeFor(v, 300, false);
    expect(r.fuelKm).toBe(400);
    expect(r.evKm).toBe(80);
    expect(r.enough).toBe(true);
    expect(rangeFor(v, 600, true).enough).toBe(false);
    const c = tripCost(v, 100, false)!;
    expect(c.electricKm).toBe(80);
    expect(c.fuelL).toBe(2);
    expect(c.euro).toBe(10); // 2 l × €2 + 20 kWh × €0.30
  });
});

import { polishNl } from "./instructions";
describe("Dutch phrasing", () => {
  it("turns Valhalla's stiff phrasing into natural Dutch", () => {
    expect(polishNl("Over 200 meter, links afslaan en Klokkengietersstraat ingaan.")).toBe("Over 200 meter, linksaf, de Klokkengietersstraat in.");
    expect(polishNl("Rechts afslaan naar Kanaaldijk.")).toBe("Rechtsaf naar de Kanaaldijk.");
    expect(polishNl("Rechts afslaan naar Europaweg, N270.")).toBe("Rechtsaf naar de Europaweg, N270.");
    expect(polishNl("Scherp links afslaan.")).toBe("Scherp linksaf.");
    expect(polishNl("Rechts afslaan naar Eindhoven.")).toBe("Rechtsaf naar Eindhoven."); // places keep no article
    expect(polishNl("Bij de verkeerslichten, links afslaan en Kerkstraat ingaan. En daarna direct rechts afslaan.")).toBe("Bij de verkeerslichten, linksaf, de Kerkstraat in. En daarna direct rechtsaf.");
  });
});

import { junctionPriority } from "./events";
describe("priority at junctions (NL)", () => {
  const sign = (id: string, kind: "giveway" | "stop", along: number, offsetM: number) => ({ id, kind, lat: 0, lon: 0, along, offsetM });
  const seg: LimitSegment = { from: 0, to: 10, roadClass: "residential", arms: [{ heading: 0, use: "road", roadClass: "residential" }] };
  it("a sign on our approach means we give way", () => {
    expect(junctionPriority(1000, [sign("a", "giveway", 990, 2)], seg)).toBe("give");
  });
  it("signs on the side road mean we have priority", () => {
    expect(junctionPriority(1000, [sign("b", "giveway", 1002, 14)], seg)).toBe("have");
  });
  it("no signs on two minor roads = equal junction; lights win over everything", () => {
    expect(junctionPriority(1000, [], seg)).toBe("equal");
    expect(junctionPriority(1000, [sign("c", "giveway", 990, 2)], { ...seg, signal: true })).toBe("lights");
  });
  it("only announces priority when it changes, and only our own signs", () => {
    const shape2 = Array.from({ length: 61 }, (_, i) => destination(A, 90, i * 100));
    const r2 = { ...route, shape: shape2, legs: [{ ...route.legs[0], shape: shape2, maneuvers: [man(1, 0), man(4, 60)] as never }] };
    const g2 = buildGeometry(r2);
    const junction = (i: number): LimitSegment => ({ from: i - 5, to: i, roadClass: "residential", arms: [{ heading: 0, use: "road", roadClass: "residential" }] });
    const limits = [10, 15, 20, 25, 30, 35].map(junction);
    // side-road signs at the first three junctions (we have priority), nothing at the last three (equal)
    const feats = [1000, 1500, 2000].map((a, i) => sign(`s${i}`, "giveway", a + 3, 15));
    const ev = buildEvents({ g: g2, limits, features: feats, zones: [], vehicleLabel: "auto", on: all, lang: "nl" });
    const pr = ev.filter((e) => e.topic === "priority").map((e) => e.text(0));
    expect(pr).toEqual([
      "Je rijdt nu op een voorrangsweg: op de kruisingen hier heb jij voorrang.",
      "Hier zijn de kruisingen gelijkwaardig: verkeer van rechts gaat voor.",
    ]);
    // side-road give-way signs are NOT announced as "verleen voorrang"
    expect(ev.some((e) => e.topic === "stopSign")).toBe(false);
  });
});

import { simSpeeds } from "../../modes/drive/session";
describe("simulator speed modes", () => {
  const limits: LimitSegment[] = [{ from: 0, to: 10, limitKmh: 30 }, { from: 10, to: 30, limitKmh: 80 }];
  it("fixed, limit and planned", () => {
    expect(simSpeeds(g, "fixed", 72, limits).every((v) => Math.abs(v - 20) < 1e-9)).toBe(true);
    const lim = simSpeeds(g, "limit", 0, limits);
    expect(Math.round(lim[5] * 3.6)).toBe(30);
    expect(Math.round(lim[20] * 3.6)).toBe(80);
    expect(simSpeeds(g, "planned", 0, limits)).toHaveLength(30);
  });
});
