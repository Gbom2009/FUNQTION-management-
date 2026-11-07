import { services } from "../config/services";
import { createThrottle } from "./throttle";
import { decodePolyline } from "./polyline";

export interface LatLon { lat: number; lon: number; /** degrees; set on reroute start so Valhalla routes in driving direction */ heading?: number }

export interface RouteOptions {
  avoidMotorways: boolean;
  avoidTolls: boolean;
  avoidFerries: boolean;
  shortest: boolean;
}

export const DEFAULT_OPTIONS: RouteOptions = {
  avoidMotorways: false, avoidTolls: false, avoidFerries: false, shortest: false,
};

export interface Maneuver {
  type: number;
  instruction: string;
  /** Spoken versions, used by voice in Phase 3. */
  verbalAlert?: string;
  verbalPre?: string;
  verbalPost?: string;
  streetNames: string[];
  /** metres / seconds of this maneuver's segment */
  lengthM: number;
  timeS: number;
  beginShapeIndex: number;
  endShapeIndex: number;
  roundaboutExit?: number;
  highway?: boolean;
  /** short form, for chaining: "Rechts afslaan." */
  verbalSuccinct?: string;
  /** motorway sign: exit number, toward, branch */
  sign?: { exitNumber?: string; toward?: string; branch?: string; name?: string };
  bearingBefore?: number;
  bearingAfter?: number;
}

export interface RouteLeg {
  shape: [number, number][]; // [lon, lat]
  maneuvers: Maneuver[];
  lengthM: number;
  timeS: number;
}

export interface Route {
  id: string;
  legs: RouteLeg[];
  /** Whole route geometry, legs concatenated. */
  shape: [number, number][];
  lengthM: number;
  timeS: number;
  hasToll: boolean;
  hasHighway: boolean;
  hasFerry: boolean;
  bbox: [number, number, number, number]; // minLon, minLat, maxLon, maxLat
}

export type Costing = "auto" | "truck";

export interface RouteRequest {
  stops: LatLon[];
  options: RouteOptions;
  costing?: Costing;
  /** Valhalla only computes alternates for 2-location routes. */
  alternates?: number;
  language?: "nl" | "en";
  /** Trailer attached → `truck` costing with the combined dimensions. */
  tow?: TowRouting;
  /** Car without trailer: extra `auto` costing options (height, width, top_speed). */
  vehicle?: Record<string, number>;
}

export interface TowRouting {
  lengthM: number;
  widthM: number;
  heightM: number;
  weightT: number;
  /** motorway tow cap, so travel times reflect towing speed */
  topSpeedKmh: number;
}

/** Build the Valhalla /route JSON body. Pure, so it's unit-tested. */
export function buildRouteBody(req: RouteRequest) {
  const costing: Costing = req.tow ? "truck" : req.costing ?? "auto";
  const tow = req.tow ? {
    length: req.tow.lengthM, width: req.tow.widthM, height: req.tow.heightM, weight: req.tow.weightT,
    top_speed: req.tow.topSpeedKmh,
  } : {};
  const o = req.options;
  const body: Record<string, unknown> = {
    // every stop is a real stop ("break") with its own leg, not a pass-through
    locations: req.stops.map((s) => ({
      lat: s.lat, lon: s.lon, type: "break",
      ...(s.heading !== undefined ? { heading: Math.round(s.heading), heading_tolerance: 45 } : {}),
    })),
    costing,
    costing_options: {
      [costing]: {
        use_highways: o.avoidMotorways ? 0 : 1,
        use_tolls: o.avoidTolls ? 0 : 0.5,
        use_ferry: o.avoidFerries ? 0 : 0.5,
        ...(o.shortest ? { shortest: true } : {}),
        ...(req.tow ? tow : req.vehicle ?? {}),
      },
    },
    units: "kilometers",
    language: req.language === "en" ? "en-US" : "nl-NL",
    directions_options: { units: "kilometers" },
  };
  if (req.stops.length === 2 && (req.alternates ?? 0) > 0) body.alternates = req.alternates;
  return body;
}

interface VTrip {
  summary: { time: number; length: number; has_toll: boolean; has_highway: boolean; has_ferry: boolean;
    min_lat: number; min_lon: number; max_lat: number; max_lon: number };
  legs: { shape: string; summary: { time: number; length: number };
    maneuvers: { type: number; instruction: string; verbal_pre_transition_instruction?: string;
      verbal_transition_alert_instruction?: string; roundabout_exit_count?: number; highway?: boolean;
      verbal_succinct_transition_instruction?: string; bearing_before?: number; bearing_after?: number;
      sign?: Record<string, { text: string }[] | undefined>;
      verbal_post_transition_instruction?: string; street_names?: string[]; length: number; time: number;
      begin_shape_index: number; end_shape_index: number }[] }[];
}

function parseSign(s?: Record<string, { text: string }[] | undefined>) {
  if (!s) return undefined;
  const join = (k: string) => s[k]?.map((x) => x.text).slice(0, 2).join(" / ") || undefined;
  const out = { exitNumber: join("exit_number_elements"), toward: join("exit_toward_elements"), branch: join("exit_branch_elements"), name: join("exit_name_elements") };
  return Object.values(out).some(Boolean) ? out : undefined;
}

export function parseTrip(trip: VTrip, id: string): Route {
  const legs: RouteLeg[] = trip.legs.map((l) => ({
    shape: decodePolyline(l.shape, 6),
    lengthM: l.summary.length * 1000,
    timeS: l.summary.time,
    maneuvers: l.maneuvers.map((m) => ({
      type: m.type,
      instruction: m.instruction,
      verbalAlert: m.verbal_transition_alert_instruction,
      verbalPre: m.verbal_pre_transition_instruction,
      roundaboutExit: m.roundabout_exit_count,
      highway: m.highway,
      verbalSuccinct: m.verbal_succinct_transition_instruction,
      sign: parseSign(m.sign),
      bearingBefore: m.bearing_before,
      bearingAfter: m.bearing_after,
      verbalPost: m.verbal_post_transition_instruction,
      streetNames: m.street_names ?? [],
      lengthM: m.length * 1000,
      timeS: m.time,
      beginShapeIndex: m.begin_shape_index,
      endShapeIndex: m.end_shape_index,
    })),
  }));
  const s = trip.summary;
  return {
    id,
    legs,
    shape: legs.flatMap((l, i) => (i === 0 ? l.shape : l.shape.slice(1))),
    lengthM: s.length * 1000,
    timeS: s.time,
    hasToll: s.has_toll,
    hasHighway: s.has_highway,
    hasFerry: s.has_ferry,
    bbox: [s.min_lon, s.min_lat, s.max_lon, s.max_lat],
  };
}

// --- cache: identical requests never hit the public server twice ---------
// v2: maneuvers carry signs/bearings now — older cached routes lack them
const CACHE_KEY = "fq-route-cache-v2";
const CACHE_MAX = 20;
const memCache = new Map<string, Route[]>();

function loadCache() {
  if (memCache.size) return;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) for (const [k, v] of JSON.parse(raw) as [string, Route[]][]) memCache.set(k, v);
  } catch { /* storage unavailable */ }
}
function saveCache() {
  try {
    while (memCache.size > CACHE_MAX) memCache.delete(memCache.keys().next().value!);
    localStorage.setItem(CACHE_KEY, JSON.stringify([...memCache]));
  } catch { /* quota / unavailable: memory cache still works */ }
}

const queue = createThrottle(1000);

export class RoutingError extends Error {
  constructor(message: string, readonly code?: number) { super(message); }
}

/** Returns the main route first, then up to `alternates` alternatives. */
export async function getRoutes(req: RouteRequest, signal?: AbortSignal): Promise<Route[]> {
  if (req.stops.length < 2) return [];
  const body = buildRouteBody(req);
  const key = JSON.stringify(body);
  loadCache();
  const hit = memCache.get(key);
  if (hit) return hit;

  const r = await queue(() => fetch(`${services.valhalla}/route`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: key,
    signal,
  }));
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    // Valhalla errors: { error_code, error, status_code }
    throw new RoutingError(j.error ?? `Valhalla ${r.status}`, j.error_code);
  }
  const trips: VTrip[] = [j.trip, ...((j.alternates ?? []) as { trip: VTrip }[]).map((a) => a.trip)];
  const routes = trips.map((t, i) => parseTrip(t, `r${i}`));
  memCache.set(key, routes);
  saveCache();
  return routes;
}
