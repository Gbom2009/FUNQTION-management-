import type { RouteGeometry, FlatManeuver } from "../guidance";
import type { Arm, LimitSegment } from "../speed";
import type { RoadFeature } from "../osmFeatures";
import type { ZoneEntry } from "../../features/phev/zones";
import type { Vehicle } from "../../features/vehicles/profiles";
import { describeZone, rulesForZone, zoneVerdict } from "../../features/phev/zoneRules";
import { spokenDistance } from "../voice";
import type { Topic } from "./settings";
import type { Lang } from "../../i18n";

/**
 * Builds every non-turn announcement for a route (pure, tested): speed
 * cameras, zones, limit changes, crossings, cycle lanes, one-way streets,
 * level crossings, tunnels, height limits… Each event knows where it is, how
 * early to announce it and how important it is. The session plays them.
 */
export interface NarrationEvent {
  id: string;
  along: number;
  /** announce this many metres ahead (scaled by speed + user setting) */
  lead: number;
  /** 0 = critical … 5 = trivia; lower wins when several are due */
  prio: number;
  topic: Topic;
  text: (distM: number) => string;
}

export interface NarrationInput {
  g: RouteGeometry;
  limits: LimitSegment[];
  features: RoadFeature[];
  zones: ZoneEntry[];
  vehicle?: Vehicle;
  vehicleLabel: string;
  /** combination height (car + roof box / trailer), m */
  heightM?: number;
  /** combination weight, t */
  weightT?: number;
  on: (t: Topic) => boolean;
  lang: Lang;
}

const MINOR = new Set(["residential", "unclassified", "service_other", "tertiary", "living_street"]);
const ROAD_USES = new Set(["road", "ramp", "turn_channel", undefined]);

/** Segment whose end node is at shape index i (the junction a maneuver happens at). */
export function segEndingAt(limits: LimitSegment[], i: number): LimitSegment | undefined {
  return limits.find((s) => s.to === i) ?? limits.find((s) => s.from < i && s.to >= i);
}
export function segStartingAt(limits: LimitSegment[], i: number): LimitSegment | undefined {
  return limits.find((s) => s.from === i) ?? limits.find((s) => s.from <= i && s.to > i);
}

/** A give-way/stop sign this close to our line is on our approach; further out it's on a side road. */
export const SIGN_ON_ROUTE_M = 7;
const isSign = (f: RoadFeature) => f.kind === "giveway" || f.kind === "stop";
const ours = (f: RoadFeature) => (f.offsetM ?? 0) <= SIGN_ON_ROUTE_M;

export type Priority = "give" | "have" | "equal" | "lights" | "unknown";

/**
 * Who has priority at the junction at `along` (NL rules):
 * - a give-way/stop sign on our approach (just before the junction) → we give way
 * - signs only on the side roads → we have priority
 * - traffic lights → lights decide
 * - two minor roads, no signs at all → equal junction: traffic from the right goes first
 */
export function junctionPriority(along: number, features: RoadFeature[], seg?: LimitSegment): Priority {
  if (seg?.signal) return "lights";
  const near = features.filter((f) => isSign(f) && f.along > along - 45 && f.along < along + 12);
  if (near.some((f) => ours(f) && f.along <= along + 3)) return "give";
  if (near.some((f) => !ours(f) && Math.abs(f.along - along) < 30)) return "have";
  if (seg && MINOR.has(seg.roadClass ?? "") && roadArms(seg.arms).some((a) => MINOR.has(a.roadClass ?? ""))) return "equal";
  return "unknown";
}

export const roadArms = (arms?: Arm[]) => (arms ?? []).filter((a) => ROAD_USES.has(a.use as never));
export const bikeArms = (arms?: Arm[]) => (arms ?? []).filter((a) => a.use === "cycleway" || a.use === "path");

const P = {
  nl: {
    camera: (d: string, v?: number) => `Flitser over ${d}${v ? `, maximaal ${v}` : ""}.`,
    limit: (v: number) => `De maximumsnelheid wordt ${v}.`,
    rail: (d: string) => `Spoorwegovergang over ${d}. Let op de bomen en de lichten.`,
    zebra: (d: string) => `Zebrapad over ${d}. Voetgangers die oversteken hebben voorrang.`,
    crossing: (d: string, kind?: string) => kind === "traffic_signals" ? `Voetgangersoversteek met verkeerslichten over ${d}.` : `Oversteekplaats over ${d}.`,
    bump: (d: string) => `Verkeersdrempel over ${d}.`,
    stop: (d: string) => `Stopbord over ${d}. Helemaal stoppen en voorrang verlenen.`,
    giveway: (d: string) => `Haaientanden over ${d}. Verleen voorrang.`,
    lights: (d: string) => `Kruispunt met verkeerslichten over ${d}. Je gaat rechtdoor.`,
    havePriority: () => `Je rijdt nu op een voorrangsweg: op de kruisingen hier heb jij voorrang.`,
    equalJunctions: () => `Hier zijn de kruisingen gelijkwaardig: verkeer van rechts gaat voor.`,
    tunnel: (d: string) => `Over ${d} rij je een tunnel in.`,
    bridge: (d: string) => `Over ${d} rij je over een brug.`,
    toll: (d: string) => `Let op: over ${d} begint een tolweg.`,
    unpaved: (d: string) => `Over ${d} wordt de weg onverhard.`,
    lanes: (n: number) => `De weg heeft hier ${n} rijstroken.`,
    cycleRoad: () => `Deze weg heeft een fietsstrook. Let op fietsers naast je.`,
    tooLow: (d: string, h: number, mine: number) => `Waarschuwing! Over ${d} is de doorrijhoogte ${fmt(h)} meter. Jouw combinatie is ${fmt(mine)} meter hoog. Rijd hier niet onderdoor.`,
    fits: (d: string, h: number) => `Over ${d} een doorrijhoogte van ${fmt(h)} meter. Je past eronder.`,
    tooHeavy: (d: string, w: number, mine: number) => `Waarschuwing! Over ${d} geldt een maximum gewicht van ${fmt(w)} ton. Jouw combinatie weegt ${fmt(mine)} ton.`,
    zone: (d: string, zone: string, verdict: string) => `Over ${d} rij je de ${zone} in. ${verdict}`,
    allowed: (car: string) => `Jouw ${car} mag erin.`,
    banned: (car: string) => `Let op: jouw ${car} mag deze zone niet in. De boete is 130 euro.`,
    unknown: () => `Check of jouw auto erin mag.`,
  },
  en: {
    camera: (d: string, v?: number) => `Speed camera in ${d}${v ? `, limit ${v}` : ""}.`,
    limit: (v: number) => `The speed limit changes to ${v}.`,
    rail: (d: string) => `Level crossing in ${d}.`,
    zebra: (d: string) => `Zebra crossing in ${d}. Pedestrians have priority.`,
    crossing: (d: string) => `Pedestrian crossing in ${d}.`,
    bump: (d: string) => `Speed bump in ${d}.`,
    stop: (d: string) => `Stop sign in ${d}.`,
    giveway: (d: string) => `Give way in ${d}.`,
    lights: (d: string) => `Junction with traffic lights in ${d}. Go straight on.`,
    havePriority: () => `You're on a priority road now: you have right of way at these junctions.`,
    equalJunctions: () => `Equal junctions here: traffic from the right goes first.`,
    tunnel: (d: string) => `Tunnel in ${d}.`,
    bridge: (d: string) => `Bridge in ${d}.`,
    toll: (d: string) => `Toll road begins in ${d}.`,
    unpaved: (d: string) => `Unpaved road in ${d}.`,
    lanes: (n: number) => `The road has ${n} lanes here.`,
    cycleRoad: () => `This road has a cycle lane. Watch for cyclists.`,
    tooLow: (d: string, h: number, mine: number) => `Warning! In ${d} the clearance is ${fmt(h)} metres. You are ${fmt(mine)} metres high. Do not drive under it.`,
    fits: (d: string, h: number) => `Clearance of ${fmt(h)} metres in ${d}. You fit.`,
    tooHeavy: (d: string, w: number, mine: number) => `Warning! Weight limit of ${fmt(w)} tonnes in ${d}. You weigh ${fmt(mine)} tonnes.`,
    zone: (d: string, zone: string, verdict: string) => `In ${d} you enter the ${zone}. ${verdict}`,
    allowed: (car: string) => `Your ${car} may enter.`,
    banned: (car: string) => `Warning: your ${car} may not enter this zone.`,
    unknown: () => `Check whether your car may enter.`,
  },
};
const fmt = (n: number) => (Math.round(n * 10) / 10).toString().replace(".", ",");

export function buildEvents(inp: NarrationInput): NarrationEvent[] {
  const { g, limits, features, zones, on, lang } = inp;
  const p = P[lang];
  const d = (m: number) => spokenDistance(Math.max(50, m), lang);
  const ev: NarrationEvent[] = [];
  const at = (i: number) => g.cum[Math.min(Math.max(0, i), g.cum.length - 1)];
  const nearManeuver = (along: number, m = 40) => g.maneuvers.some((x) => Math.abs(x.along - along) < m);

  // --- height / weight limits (always on) -------------------------------
  for (const f of features) {
    if (f.kind === "maxheight" && f.value && inp.heightM) {
      if (f.value < inp.heightM + 0.1) {
        ev.push({ id: `h1-${f.id}`, along: f.along, lead: 1500, prio: 0, topic: "height", text: (m) => p.tooLow(d(m), f.value!, inp.heightM!) });
        ev.push({ id: `h2-${f.id}`, along: f.along, lead: 400, prio: 0, topic: "height", text: (m) => p.tooLow(d(m), f.value!, inp.heightM!) });
      } else if (on("tunnel")) {
        ev.push({ id: `hf-${f.id}`, along: f.along, lead: 300, prio: 4, topic: "tunnel", text: (m) => p.fits(d(m), f.value!) });
      }
    }
    if (f.kind === "maxweight" && f.value && inp.weightT && f.value < inp.weightT) {
      ev.push({ id: `w-${f.id}`, along: f.along, lead: 1200, prio: 0, topic: "height", text: (m) => p.tooHeavy(d(m), f.value!, inp.weightT!) });
    }
  }

  // --- OSM point features ------------------------------------------------
  let lastBump = -1e9;
  for (const f of features) {
    switch (f.kind) {
      case "camera": if (on("camera")) ev.push({ id: `c-${f.id}`, along: f.along, lead: 500, prio: 1, topic: "camera", text: (m) => p.camera(d(m), f.value) }); break;
      case "rail": if (on("rail")) ev.push({ id: `r-${f.id}`, along: f.along, lead: 300, prio: 1, topic: "rail", text: (m) => p.rail(d(m)) }); break;
      case "zebra": if (on("zebra")) ev.push({ id: `z-${f.id}`, along: f.along, lead: 120, prio: 2, topic: "zebra", text: (m) => p.zebra(d(m)) }); break;
      case "crossing": if (on("crossing")) ev.push({ id: `x-${f.id}`, along: f.along, lead: 100, prio: 4, topic: "crossing", text: (m) => p.crossing(d(m), f.detail) }); break;
      case "bump":
        if (on("bump") && f.along - lastBump > 150) { lastBump = f.along; ev.push({ id: `b-${f.id}`, along: f.along, lead: 100, prio: 4, topic: "bump", text: (m) => p.bump(d(m)) }); }
        break;
      case "stop": if (on("stopSign") && ours(f)) ev.push({ id: `s-${f.id}`, along: f.along, lead: 120, prio: 2, topic: "stopSign", text: (m) => p.stop(d(m)) }); break;
      case "giveway": if (on("stopSign") && ours(f)) ev.push({ id: `g-${f.id}`, along: f.along, lead: 120, prio: 3, topic: "stopSign", text: (m) => p.giveway(d(m)) }); break;
    }
  }

  // --- milieuzones -------------------------------------------------------
  if (on("zone") || on("zoneDetail")) {
    for (const z of zones) {
      if (z.along <= 0) continue;
      const r = rulesForZone(z.zone.name);
      const v = inp.vehicle;
      const verdict = v ? zoneVerdict(r, v) : undefined;
      const vText = !verdict ? "" : verdict.access === "allowed" ? p.allowed(inp.vehicleLabel) : verdict.access === "banned" ? p.banned(inp.vehicleLabel) : verdict.access === "unknown" ? p.unknown() : "";
      if (on("zoneDetail") && v && lang === "nl") {
        ev.push({ id: `zd-${z.zone.id}-${Math.round(z.along)}`, along: z.along, lead: 1500, prio: 2, topic: "zoneDetail",
          text: (m) => `Over ${d(m)} rij je de ${z.zone.name} in. ${describeZone(z.zone.name, r, v, inp.vehicleLabel)}` });
      } else if (on("zone")) {
        ev.push({ id: `zn-${z.zone.id}-${Math.round(z.along)}`, along: z.along, lead: 1000, prio: verdict?.access === "banned" ? 0 : 2, topic: "zone", text: (m) => p.zone(d(m), z.zone.name, vText) });
      }
    }
  }

  // --- per-edge facts (Valhalla) ---------------------------------------
  let prevLimit: number | undefined;
  let prevCycle = false;
  let prevLanes: number | undefined;
  let lastLanesAt = -1e9;
  // priority is announced only when it changes (on a priority road → equal junctions → …)
  let prioState: Priority = "unknown";
  let lastEqualAt = -1e9;
  for (let k = 0; k < limits.length; k++) {
    const s = limits[k];
    const start = at(s.from), end = at(s.to);
    const len = end - start;
    // speed-limit changes (ignore flicker on very short edges)
    if (s.limitKmh !== undefined && prevLimit !== undefined && s.limitKmh !== prevLimit && len > 150 && on("speedLimit")) {
      const v = s.limitKmh;
      ev.push({ id: `l-${k}`, along: start, lead: 150, prio: 3, topic: "speedLimit", text: () => p.limit(v) });
    }
    if (s.limitKmh !== undefined && len > 150) prevLimit = s.limitKmh;

    // tunnels / bridges (start of the structure)
    const prev = limits[k - 1];
    if (s.tunnel && !prev?.tunnel && on("tunnel")) ev.push({ id: `t-${k}`, along: start, lead: 300, prio: 3, topic: "tunnel", text: (m) => p.tunnel(d(m)) });
    if (s.bridge && !prev?.bridge && len > 60 && on("lights") /* bridges are trivia: max level */) ev.push({ id: `br-${k}`, along: start, lead: 200, prio: 5, topic: "lights", text: (m) => p.bridge(d(m)) });
    if (s.toll && !prev?.toll && on("toll")) ev.push({ id: `to-${k}`, along: start, lead: 1000, prio: 1, topic: "toll", text: (m) => p.toll(d(m)) });
    if (s.surface && /unpaved|gravel|dirt|path/.test(s.surface) && !(prev?.surface && /unpaved|gravel|dirt|path/.test(prev.surface)) && on("surface")) {
      ev.push({ id: `su-${k}`, along: start, lead: 200, prio: 4, topic: "surface", text: (m) => p.unpaved(d(m)) });
    }
    // cycle lane begins on the road we're on (not at a turn — turns mention it themselves)
    const cycle = s.cycleLane === "shared" || s.cycleLane === "dedicated";
    if (cycle && !prevCycle && len > 200 && !nearManeuver(start, 60) && on("cycle")) {
      ev.push({ id: `cy-${k}`, along: start, lead: 50, prio: 4, topic: "cycle", text: () => p.cycleRoad() });
    }
    prevCycle = cycle;
    // lanes (motorways): announce changes, at most every 2 km
    if (s.lanes && prevLanes && s.lanes !== prevLanes && (s.roadClass === "motorway" || s.roadClass === "trunk") && start - lastLanesAt > 2000 && on("lanes")) {
      lastLanesAt = start;
      const n = s.lanes;
      ev.push({ id: `la-${k}`, along: start, lead: 0, prio: 5, topic: "lanes", text: () => p.lanes(n) });
    }
    if (s.lanes) prevLanes = s.lanes;

    // junction at the end of this edge
    const arms = roadArms(s.arms);
    if (arms.length) {
      const pr = junctionPriority(end, features, s);
      if (pr === "lights" && !nearManeuver(end) && on("lights")) {
        ev.push({ id: `li-${k}`, along: end, lead: 200, prio: 4, topic: "lights", text: (m) => p.lights(d(m)) });
      }
      if (on("priority") && pr !== "unknown" && pr !== "lights" && pr !== prioState) {
        if (pr === "have") {
          ev.push({ id: `pv-${k}`, along: end, lead: 150, prio: 4, topic: "priority", text: () => p.havePriority() });
        } else if (pr === "equal" && end - lastEqualAt > 1500) {
          lastEqualAt = end;
          ev.push({ id: `pe-${k}`, along: end, lead: 120, prio: 4, topic: "priority", text: () => p.equalJunctions() });
        }
        // "give" is announced by the sign itself (stopSign topic) and in the turn instruction
      }
      if (pr !== "unknown" && pr !== "lights") prioState = pr;
    }
  }
  return ev.sort((a, b) => a.along - b.along);
}

/** Details woven into the turn instruction itself (lights, exits, cycle lane, one-way…). */
export interface TurnContext {
  signal: boolean;
  /** turning across a cycle path */
  crossesBikePath: boolean;
  /** the road we turn into has a cycle lane */
  cycleOnNext: boolean;
  onewayNext: boolean;
  /** roundabout: number of arms (incl. entry) when known */
  roundaboutArms?: number;
  /** who has priority at the junction we turn at */
  priority: Priority;
  nextStreet?: string;
}

export function turnContext(m: FlatManeuver, limits: LimitSegment[], features: RoadFeature[] = []): TurnContext {
  const before = segEndingAt(limits, m.globalIndex);
  const after = segStartingAt(limits, m.globalIndex);
  const arms = before?.arms;
  let roundaboutArms: number | undefined;
  if (m.type === 26) {
    // arms leaving the ring between entry and exit (skip ring continuations: same name as the ring)
    const ring = limits.filter((s) => s.roundabout && s.from >= m.globalIndex - 1 && s.from < m.globalIndex + 60);
    const exits = ring.flatMap((s) => roadArms(s.arms).filter((a) => !a.sameName));
    if (exits.length) roundaboutArms = exits.length + 1; // + our own exit
  }
  return {
    signal: !!before?.signal,
    crossesBikePath: bikeArms(arms).length > 0,
    cycleOnNext: after?.cycleLane === "shared" || after?.cycleLane === "dedicated",
    onewayNext: !!after?.oneway && MINOR.has(after?.roadClass ?? ""),
    roundaboutArms,
    priority: roadArms(arms).length ? junctionPriority(m.along, features, before) : "unknown",
    nextStreet: after?.names?.[0],
  };
}
