import type { Fix, LocationProvider } from "../../location/provider";
import { RealGps } from "../../location/realGps";
import { Simulator, type SimPath } from "../../location/simulator";
import { buildGeometry, GuidanceTracker, DESTINATION_TYPES, type RouteGeometry, type GuidanceState } from "../../nav/guidance";
import { PromptPlanner, preparePrompts, stopSpeaking, thresholds, warmUpVoice } from "../../nav/voice";
import { fetchSpeedLimits, segmentAt, effectiveLimit, isMotorwayClass, type LimitSegment } from "../../nav/speed";
import { getRoutes, type Route } from "../../nav/valhalla";
import { decodePolyline } from "../../nav/polyline";
import { usePlan, towRouting, vehicleRouting, type ActiveRoute, type Stop } from "../../store/plan";
import { useDrive, LOCK_KMH, UNLOCK_AFTER_MS } from "../../store/drive";
import { useApp } from "../../store/app";
import { translate } from "../../i18n";
import { towCapFor } from "../../features/vehicles/profiles";
import type { TowProfile } from "../../features/vehicles/store";
import { computeTowWarnings, fetchHeights, type TowWarning } from "../../features/vehicles/towWarnings";
import { recordTrip } from "../../features/stats/tripLog";
import { createDecimator, saveTrack } from "../../features/stats/tracks";
import { activeVehicle } from "../../features/vehicles/store";
import { haversine } from "../../nav/geo";
import { evHints, loadZones, urbanStretches, zoneEntries, type EvHint, type ZoneEntry } from "../../features/phev/zones";
import { usePhev } from "../../features/phev/store";
import { spokenDistance } from "../../nav/voice";
import { say as ttsSay, stopAll as ttsStop } from "../../nav/tts";
import { fetchRoadFeatures, type RoadFeature } from "../../nav/osmFeatures";
import { buildEvents, turnContext, type NarrationEvent } from "../../nav/narration/events";
import { richInstruction } from "../../nav/narration/instructions";
import { maneuverArt, type ManeuverArt } from "../../nav/narration/art";
import { enabledTopics, useGuidance } from "../../nav/narration/settings";
import { effectiveHeight } from "../../features/vehicles/apply";

/**
 * Drive session controller (framework-free). Owns the location provider,
 * guidance tracker, voice planner, speed-limit lookup and rerouting.
 * React only reads the resulting state from useDrive.
 */

const REROUTE_MIN_GAP_MS = 8000;
const REROUTE_RETRY_MS = 15000;
/** Maneuver types the simulator brakes for (turns, roundabouts, arrival). */
const SLOW_TYPES = new Set([4, 5, 6, 9, 10, 11, 12, 13, 14, 15, 16, 26]);

let provider: LocationProvider | null = null;
let sim: Simulator | null = null;
let geo: RouteGeometry | null = null;
let tracker: GuidanceTracker | null = null;
let planner = new PromptPlanner();
let limits: LimitSegment[] = [];
let sessionId: number | null = null;
let lastReroute = 0;
let slowSince: number | null = null;
let preparedFor = -1;
let tow: TowProfile | null = null;
let heights: [number, number][] = [];
let towWarnings: TowWarning[] = [];
let warned = new Set<number>();
let zones: ZoneEntry[] = [];
let hints: EvHint[] = [];
let zoneSaid = new Set<string>();
/** announce zone entries / EV hints this far ahead */
const ZONE_WARN_M = 1000;
const EV_HINT_M = 600;
let features: RoadFeature[] = [];
let events: NarrationEvent[] = [];
let spokenEv = new Set<string>();
let evCursor = 0;
let preparedEv = new Set<string>();

function narrationVehicle() {
  const v = activeVehicle();
  const label = v ? (v.make && v.model ? v.make + " " + v.model : v.name) : "auto";
  const heightM = tow ? tow.dims.heightM : v ? effectiveHeight(v) : undefined;
  const weightT = tow ? tow.dims.weightT : v?.maxMassKg ? v.maxMassKg / 1000 : v?.weightKg ? v.weightKg / 1000 : undefined;
  return { v, label, heightM, weightT };
}

function refreshNarration() {
  if (!geo) return;
  useDrive.getState().set({ detailVersion: useDrive.getState().detailVersion + 1 });
  const nv = narrationVehicle();
  evCursor = 0;
  events = buildEvents({
    g: geo, limits, features, zones, vehicle: nv.v, vehicleLabel: nv.label,
    heightM: nv.heightM, weightT: nv.weightT, on: enabledTopics(), lang: useApp.getState().lang,
  });
}

const NOTICE_TOPICS = new Set(["camera", "rail", "zebra", "height", "stopSign", "toll", "tunnel"]);

/** Speak road-info events that are due; pre-render the next few; feed the HUD chip. */
function checkNarration(g: GuidanceState, f: Fix) {
  const d = useDrive.getState();
  const scale = useGuidance.getState().leadScale * Math.max(1, f.speedKmh / 80);
  const lang = useApp.getState().lang;
  let notice: { topic: string; dist: number; text: string } | null = null;
  // events are sorted by position: skip everything already behind us
  while (evCursor < events.length && events[evCursor].along < g.along - 10) evCursor++;
  for (let k = evCursor; k < events.length; k++) {
    const e = events[k];
    const dist = e.along - g.along;
    if (dist < -10) continue;
    if (dist > 2500) break;
    const lead = Math.max(30, e.lead * scale);
    const rounded = Math.round(lead / 50) * 50;
    if (!preparedEv.has(e.id) && dist < lead + 800) { preparedEv.add(e.id); preparePrompts([e.text(rounded)], lang); }
    if (!notice && dist <= Math.max(lead, 300) && NOTICE_TOPICS.has(e.topic)) {
      notice = { topic: e.topic, dist: Math.max(0, Math.round(dist)), text: e.text(Math.max(0, dist)) };
    }
    if (spokenEv.has(e.id) || dist > lead) continue;
    spokenEv.add(e.id);
    // say the lead distance when we just crossed it (matches the pre-rendered audio)
    say(e.text(dist >= lead * 0.7 ? rounded : dist), e.prio === 0 ? "critical" : "info", e.prio);
  }
  const prev = d.roadNotice;
  if (notice?.topic !== prev?.topic || Math.abs((notice?.dist ?? 0) - (prev?.dist ?? 0)) > 20) d.set({ roadNotice: notice });
}

/** announce tow warnings this far ahead */
const TOW_WARN_M = 300;

export const simulator = () => sim;

// ---- speech queue: turn instructions interrupt, info waits its turn -------
let speaking = false;
let lastTurnAt = 0;
let infoQueue: { text: string; prio: number; at: number }[] = [];

function run(text: string) {
  speaking = true;
  let done = false;
  const finish = () => { if (done) return; done = true; speaking = false; setTimeout(pump, 600); };
  // never let a voice that forgets to report "ended" block the queue
  const guard = setTimeout(finish, Math.min(20_000, 2500 + text.length * 90));
  void ttsSay(text, useApp.getState().lang).finally(() => { clearTimeout(guard); finish(); });
}
function pump() {
  if (speaking || !infoQueue.length || useDrive.getState().muted) return;
  if (Date.now() - lastTurnAt < 1500) { setTimeout(pump, 700); return; }
  const now = Date.now();
  infoQueue = infoQueue.filter((q) => now - q.at < 20_000); // stale info is worse than none
  const next = infoQueue.shift();
  if (next) run(next.text);
}
/** kind "turn"/"critical" interrupts whatever is playing; "info" queues by priority. */
function say(text: string, kind: "turn" | "critical" | "info" = "turn", prio = 3) {
  if (useDrive.getState().muted) return;
  if (kind === "info") {
    infoQueue.push({ text, prio, at: Date.now() });
    infoQueue.sort((a, b) => a.prio - b.prio);
    pump();
    return;
  }
  infoQueue = infoQueue.filter((q) => q.prio === 0);
  ttsStop();
  lastTurnAt = Date.now();
  run(text);
}
const t = (k: Parameters<typeof translate>[1]) => translate(useApp.getState().lang, k);

/**
 * Simulator speed profile for the route:
 * - planned: Valhalla's average speed per maneuver (includes junction delays)
 * - limit: exactly the posted limit of each edge (planned where unknown)
 * - fixed: one constant speed
 */
export function simSpeeds(g: RouteGeometry, mode: "planned" | "limit" | "fixed", fixedKmh: number, lim: LimitSegment[]): number[] {
  const n = Math.max(0, g.shape.length - 1);
  if (mode === "fixed") return new Array<number>(n).fill(fixedKmh / 3.6);
  const planned = simPathFromRoute(g).speeds!;
  if (mode === "planned" || !lim.length) return planned;
  const out = planned.slice();
  for (const sg of lim) {
    if (sg.limitKmh === undefined) continue;
    for (let k = sg.from; k < Math.min(sg.to, n); k++) out[k] = sg.limitKmh / 3.6;
  }
  return out;
}

/** Apply the current speed settings to the running simulator. */
export function applySimSpeeds() {
  if (!sim || !geo) return;
  const d = useDrive.getState();
  sim.brake = d.simBrake;
  sim.setSpeeds(simSpeeds(geo, d.simSpeedMode, d.simFixedKmh, limits), simPathFromRoute(geo).slowAt);
}

export function simPathFromRoute(g: RouteGeometry): SimPath {
  const speeds = new Array<number>(Math.max(0, g.shape.length - 1)).fill(50 / 3.6);
  g.maneuvers.forEach((m, i) => {
    const end = g.maneuvers[i + 1]?.globalIndex ?? g.shape.length - 1;
    const v = m.timeS > 0 && m.lengthM > 0 ? m.lengthM / m.timeS : 50 / 3.6;
    for (let k = m.globalIndex; k < end; k++) speeds[k] = v;
  });
  const slowAt = g.maneuvers.filter((m) => SLOW_TYPES.has(m.type)).map((m) => m.along);
  return { shape: g.shape, speeds, slowAt };
}

function loadRoute(route: Route) {
  geo = buildGeometry(route);
  tracker = new GuidanceTracker(geo);
  planner = new PromptPlanner();
  preparedFor = -1;
  limits = [];
  heights = [];
  towWarnings = tow ? computeTowWarnings(geo, []) : [];
  warned = new Set();
  useDrive.getState().set({ limitsStatus: "loading", towWarning: null });
  const forSession = sessionId;
  const g = geo;
  zones = []; hints = []; zoneSaid = new Set();
  features = []; events = []; spokenEv = new Set(); preparedEv = new Set();
  useDrive.getState().set({ featuresStatus: "loading", roadNotice: null });
  void fetchRoadFeatures(g).then((r) => {
    if (geo !== g) return;
    features = r.features;
    refreshNarration();
    useDrive.getState().set({ featuresStatus: r.complete ? "ok" : "partial", featureCount: r.features.length });
  }).catch(() => useDrive.getState().set({ featuresStatus: "error" }));
  const refreshHints = () => {
    if (geo !== g) return;
    hints = evHints(zones, urbanStretches(g, limits), activeVehicle()?.evRangeKm);
  };
  void loadZones().then((z) => { if (geo === g) { zones = zoneEntries(g, z); refreshHints(); refreshNarration(); } });
  const refreshWarnings = () => { if (tow && geo === g) towWarnings = computeTowWarnings(g, limits, heights); refreshHints(); refreshNarration(); };
  fetchSpeedLimits(route.legs.map((l) => l.shape), decodePolyline, tow ? "truck" : "auto")
    .then((l) => { if (sessionId === forSession) { limits = l; refreshWarnings(); applySimSpeeds(); useDrive.getState().set({ limitsStatus: "ok" }); } })
    .catch(() => { if (sessionId === forSession) useDrive.getState().set({ limitsStatus: "error" }); });
  if (tow) {
    fetchHeights(route.shape)
      .then((h) => { if (sessionId === forSession) { heights = h; refreshWarnings(); } })
      .catch(() => { /* no elevation: descents just aren’t warned */ });
  }
}

/** Milieuzone entry alerts + "switch to EV mode" hints (PHEV). */
function checkZones(g: GuidanceState) {
  const p = usePhev.getState();
  const d = useDrive.getState();
  const lang = useApp.getState().lang;
  let notice: { kind: "zone" | "ev"; text: string; along: number } | null = null;

  if (p.zoneAlerts) {
    const z = zones.find((e) => e.along > g.along - 30 && e.along - g.along <= ZONE_WARN_M);
    if (z) {
      const key = `z${z.along}`;
      const dist = Math.max(0, z.along - g.along);
      notice = { kind: "zone", along: z.along, text: `${z.zone.name}${dist > 50 ? ` · ${spokenDistance(dist, lang)}` : ""}` };
      // the spoken announcement (with your car's verdict) comes from the narration events
      void key;
    }
  }
  if (p.evHints && !notice) {
    const h = hints.find((x) => x.along > g.along - 30 && x.along - g.along <= EV_HINT_M);
    if (h) {
      notice = { kind: "ev", along: h.along, text: t("phev.ev") };
      const key = `e${h.along}`;
      if (!zoneSaid.has(key)) { zoneSaid.add(key); say(t(h.kind === "zone" ? "phev.voice.evZone" : "phev.voice.evUrban"), "info", 3); }
    }
  }
  if (notice?.text !== d.zoneNotice?.text) d.set({ zoneNotice: notice });
}

function checkTowWarnings(g: GuidanceState) {
  if (!tow) return;
  const d = useDrive.getState();
  const ahead = towWarnings.find((w) => w.along >= g.along - 20 && w.along - g.along <= TOW_WARN_M);
  if (ahead && !warned.has(ahead.along)) {
    warned.add(ahead.along);
    const k = ahead.kind === "sharp" ? "tow.voice.sharp" : ahead.kind === "narrow" ? "tow.voice.narrow" : "tow.voice.descent";
    say(t(k), "info", 1);
  }
  const show = ahead ?? null;
  if (show?.along !== d.towWarning?.along) d.set({ towWarning: show });
}

function updateLock(f: Fix) {
  const d = useDrive.getState();
  if (f.speedKmh > LOCK_KMH) { slowSince = null; if (!d.locked) d.set({ locked: true }); return; }
  if (!d.locked) return;
  slowSince ??= f.t;
  if (f.t - slowSince >= UNLOCK_AFTER_MS) d.set({ locked: false });
}

// ---- trip log (Setlist, Phase 5 shows it): distance actually driven --------
let trip: { startedAt: number; startAlong: number; km: number; last: [number, number] | null; lastT: number; track: ReturnType<typeof createDecimator> } | null = null;

function trackTrip(f: Fix) {
  if (!trip || f.speedKmh < 2) return;
  const p: [number, number] = [f.lon, f.lat];
  if (trip.last) {
    const m = haversine(trip.last, p);
    const dt = Math.max(0.001, (f.t - trip.lastT) / 1000);
    // ignore GPS jumps (tunnel exits, teleports) faster than 250 km/h
    if (m / dt < 70) trip.km += m / 1000;
  }
  trip.last = p;
  trip.lastT = f.t;
  trip.track.push(p);
}

function finishTrip(arrived: boolean) {
  const a = usePlan.getState().active;
  if (!trip || !a || trip.km < 0.2) { trip = null; return; }
  const id = recordTrip({
    startedAt: trip.startedAt, endedAt: Date.now(), km: Math.round(trip.km * 10) / 10,
    vehicle: a.tow?.vehicle.name ?? activeVehicle()?.name, trailer: a.tow?.trailer.name,
    gigId: a.gigId, destination: a.stops[a.stops.length - 1]?.name, arrived,
    simulated: provider?.kind === "simulated",
  });
  void saveTrack(id, trip.track.points());
  trip = null;
}

function onFix(f: Fix) {
  updateLock(f);
  trackTrip(f);
  const d = useDrive.getState();
  if (!geo || !tracker || d.arrived) { d.set({ fix: f, gpsError: null }); return; }

  const g = tracker.update(f);
  const seg = segmentAt(limits, geoSegment(g));
  const capKmh = tow ? towCapFor(tow.caps, seg?.roadClass, seg?.limitKmh) : undefined;
  // HUD uses the lower of the posted limit and the tow cap
  const limitKmh = effectiveLimit(seg?.limitKmh, capKmh);
  d.set({ fix: f, guidance: g, limitKmh, postedKmh: seg?.limitKmh, capKmh, gpsError: null });
  checkTowWarnings(g);
  checkZones(g);
  checkNarration(g, f);

  // voice
  if (g.next >= 0) {
    const m = geo.maneuvers[g.next];
    const fast = isMotorwayClass(seg?.roadClass) || f.speedKmh > 75;
    const lang = useApp.getState().lang;
    const finalStop = m.leg === geo.legEnds.length - 1 && DESTINATION_TYPES.has(m.type);
    // pre-render this maneuver’s prompts once it becomes "next" (Piper: zero delay later)
    const on = enabledTopics();
    const ctx = limits.length ? turnContext(m, limits, features) : undefined;
    const after = geo.maneuvers[g.next + 1];
    if (g.next !== preparedFor) {
      preparedFor = g.next;
      const th = thresholds(fast);
      preparePrompts((["far", "mid", "now"] as const).map((st) => richInstruction(m, st, th[st], lang, finalStop, ctx, after, on)), lang);
    }
    const stage = planner.check(g.next, g.distToNext, fast);
    if (stage) {
      // Say the threshold distance when we just crossed it, so the pre-rendered audio matches.
      const th = thresholds(fast)[stage];
      const dist = g.distToNext >= th * 0.7 ? th : g.distToNext;
      say(richInstruction(m, stage, dist, lang, finalStop, ctx, after, on), "turn");
    }
  }

  if (g.arrived) {
    d.set({ arrived: true });
    finishTrip(true);
    setTimeout(() => { if (sim) sim.paused = true; }, 3000);
    return;
  }
  if (g.offRoute) void reroute(f, g);
}

/** Shape index nearest the snapped point (segment index tracked by projection). */
function geoSegment(g: GuidanceState): number {
  // binary search cum for along
  const cum = geo!.cum;
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= g.along) lo = mid; else hi = mid; }
  return lo;
}

async function reroute(f: Fix, g: GuidanceState | null, skipNextStop = false) {
  const d = useDrive.getState();
  const active = usePlan.getState().active;
  if (!active || d.rerouting) return;
  const now = Date.now();
  if (!skipNextStop && now - lastReroute < REROUTE_MIN_GAP_MS) return;
  lastReroute = now;

  const leg = g?.leg ?? 0;
  // stops still ahead: stops[leg+1 …]; skipping drops the next one
  const remaining = active.stops.slice(leg + 1 + (skipNextStop ? 1 : 0));
  if (!remaining.length) { stop(); usePlan.getState().endDrive(); return; }
  const here: Stop = { key: `here-${now}`, id: "here", name: t("drive.here"), lat: f.lat, lon: f.lon, source: "pin" };

  d.set({ rerouting: true, rerouteError: null });
  if (!skipNextStop) say(t("drive.voice.rerouting"));
  try {
    const [route] = await getRoutes({
      stops: [{ lat: f.lat, lon: f.lon, heading: f.speedKmh > 5 ? f.heading : undefined }, ...remaining],
      options: active.options,
      language: useApp.getState().lang,
      tow: towRouting(active.tow),
      vehicle: vehicleRouting(),
    });
    if (!route || sessionId !== active.sessionId) return;
    usePlan.getState().setActiveRoute(route, [here, ...remaining]);
    loadRoute(route);
    sim?.setPath(simPathFromRoute(geo!), { fromPosition: [f.lon, f.lat] });
    applySimSpeeds();
    d.set({ rerouting: false, reroutes: d.reroutes + 1 });
    const first = geo!.maneuvers.find((m) => m.along > 5);
    if (first && !skipNextStop) say(first.verbalPre ?? first.instruction);
  } catch (e) {
    // offline / rate limited: keep guiding on the old route, try again later
    d.set({ rerouting: false, rerouteError: (e as Error).message });
    lastReroute = now - REROUTE_MIN_GAP_MS + REROUTE_RETRY_MS;
    tracker?.resetOffRoute();
  }
}

/** Start (or restart) tracking for the given active route. */
export function start(active: ActiveRoute) {
  stop();
  sessionId = active.sessionId;
  tow = active.tow ?? null;
  trip = { startedAt: Date.now(), startAlong: 0, km: 0, last: null, lastT: 0, track: createDecimator(50) };
  const d = useDrive.getState();
  d.set({ guidance: null, arrived: false, reroutes: 0, rerouting: false, rerouteError: null, follow: true, simPaused: false });
  preparedFor = -1;
  warmUpVoice(useApp.getState().lang);
  loadRoute(active.route);
  ensureProvider();
  if (sim) { sim.setPath(simPathFromRoute(geo!)); applySimSpeeds(); }
  const first = geo!.maneuvers[0];
  if (first) say(first.verbalPre ?? first.instruction);
}

/** Location without a route (free driving): just position + speed. */
export function ensureProvider() {
  if (provider) return;
  const d = useDrive.getState();
  if (d.source === "sim") {
    sim = new Simulator();
    sim.multiplier = d.simMultiplier;
    sim.noiseM = d.simNoiseM;
    provider = sim;
  } else {
    provider = new RealGps();
  }
  provider.start(onFix, (msg) => useDrive.getState().set({ gpsError: msg }));
}

export function stop() {
  finishTrip(false);
  provider?.stop();
  provider = null;
  sim = null;
  geo = null;
  tracker = null;
  sessionId = null;
  limits = [];
  tow = null;
  towWarnings = [];
  stopSpeaking();
  useDrive.getState().set({ guidance: null, fix: null, locked: false, arrived: false, limitKmh: undefined, postedKmh: undefined, capKmh: undefined, limitsStatus: "none", towWarning: null });
}

export function skipStop() {
  const f = useDrive.getState().fix;
  if (f) void reroute(f, useDrive.getState().guidance, true);
}

/** Dev panel: force the simulated car off the route. */
export function simGoOffRoute() { sim?.goOffRoute(); }
export function simSet(p: { multiplier?: number; noiseM?: number; paused?: boolean }) {
  if (!sim) return;
  if (p.multiplier !== undefined) sim.multiplier = p.multiplier;
  if (p.noiseM !== undefined) sim.noiseM = p.noiseM;
  if (p.paused !== undefined) sim.paused = p.paused;
}
export function simLoadPath(path: SimPath) {
  ensureProvider();
  sim?.setPath(path);
  if (sim) sim.paused = false;
}

/** Remaining route geometry for drawing (traveled part removed), throttled by caller. */
export function remainingShape(): [number, number][] | null {
  const g = useDrive.getState().guidance;
  if (!geo || !g) return null;
  const i = geoSegment(g);
  return [g.snapped, ...geo.shape.slice(i + 1)];
}

/** Junction/roundabout drawing for maneuver i (real arms once road data is in). */
export function maneuverArtAt(i: number): ManeuverArt | undefined {
  if (!geo || i < 0) return undefined;
  const m = geo.maneuvers[i];
  return m ? maneuverArt(m, geo.maneuvers[i + 1], limits) : undefined;
}

/** Points + cycle-lane lines for the map's route-detail overlay. */
export function roadDetailData(): { points: { kind: string; lon: number; lat: number; label?: string }[]; cycle: [number, number][][] } {
  if (!geo) return { points: [], cycle: [] };
  const g = geo;
  const points: { kind: string; lon: number; lat: number; label?: string }[] = features
    .filter((f) => f.kind !== "crossing")
    .map((f) => ({ kind: f.kind, lon: f.lon, lat: f.lat, label: f.kind === "camera" && f.value ? String(f.value) : f.kind === "maxheight" && f.value ? f.value + " m" : undefined }));
  // traffic lights from the road data (end node of an edge)
  for (const sg of limits) {
    if (!sg.signal) continue;
    const p = g.shape[Math.min(sg.to, g.shape.length - 1)];
    if (p) points.push({ kind: "signal", lon: p[0], lat: p[1] });
  }
  const cycle: [number, number][][] = [];
  for (const sg of limits) {
    if (sg.cycleLane !== "shared" && sg.cycleLane !== "dedicated") continue;
    const line = g.shape.slice(sg.from, sg.to + 1);
    if (line.length > 1) cycle.push(line);
  }
  return { points, cycle };
}
