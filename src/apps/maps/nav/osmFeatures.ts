import { createThrottle } from "./throttle";
import { angleDiff, project, type LonLat } from "./geo";
import type { RouteGeometry } from "./guidance";
import { cameraWarningsAllowed, loadBorders } from "./country";

/**
 * Road details along the route that Valhalla doesn't have, from
 * OpenStreetMap via Overpass (one query per route, corridor of ~25 m):
 * speed cameras, zebra/marked crossings, level crossings, speed bumps,
 * stop / give-way signs and height/weight limits.
 *
 * Speed cameras are only kept inside the Netherlands and Belgium (see
 * country.ts): warning for them is legal there, but not in Germany, France,
 * Switzerland or Austria.
 */
export type FeatureKind = "camera" | "zebra" | "crossing" | "rail" | "bump" | "stop" | "giveway" | "maxheight" | "maxweight";

export interface RoadFeature {
  id: string;
  kind: FeatureKind;
  lat: number;
  lon: number;
  /** distance along the route, m */
  along: number;
  /** camera: enforced limit; maxheight: metres; maxweight: tonnes */
  value?: number;
  /** crossing: "zebra" | "traffic_signals" | "uncontrolled" | … */
  detail?: string;
  /** distance from the route line, m — signs ≈ 0 are on our approach, ~10–25 m on a side road */
  offsetM?: number;
}

// Several public Overpass instances; the main one is often at capacity (and was
// seen returning empty results), so rotate through mirrors.
const OVERPASS = [
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const queue = createThrottle(1500);

/** Douglas–Peucker simplification in metres (local equirectangular). */
export function simplify(line: LonLat[], tolM: number): LonLat[] {
  if (line.length < 3) return line;
  const k = Math.cos((line[0][1] * Math.PI) / 180) * 111_320;
  const xy = line.map(([lon, lat]) => [lon * k, lat * 111_320] as const);
  const keep = new Uint8Array(line.length);
  keep[0] = keep[line.length - 1] = 1;
  const stack: [number, number][] = [[0, line.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let best = -1, bestD = tolM;
    const [ax, ay] = xy[a], [bx, by] = xy[b];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * (xy[i][0] - ax) - dx * (xy[i][1] - ay)) / len;
      if (d > bestD) { bestD = d; best = i; }
    }
    if (best > 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return line.filter((_, i) => keep[i]);
}

/**
 * Route → small bounding boxes (~40 vertices each, +40 m margin). Box queries
 * are far cheaper for Overpass than "around a line"; we filter by distance
 * to the route afterwards.
 */
export function routeBoxes(line: LonLat[], perBox = 40, marginDeg = 0.0004): string[] {
  const s = simplify(line, 8);
  const out: string[] = [];
  for (let i = 0; i < s.length - 1; i += perBox) {
    let w = Infinity, so = Infinity, e = -Infinity, n = -Infinity;
    for (const [x, y] of s.slice(i, i + perBox + 1)) { w = Math.min(w, x); e = Math.max(e, x); so = Math.min(so, y); n = Math.max(n, y); }
    out.push(`${(so - marginDeg).toFixed(5)},${(w - marginDeg).toFixed(5)},${(n + marginDeg).toFixed(5)},${(e + marginDeg).toFixed(5)}`);
  }
  return out;
}

/** One Overpass query for a group of boxes. */
export function query(boxes: string[]): string {
  const parts = boxes.map((b) =>
    `node(${b})["highway"~"^(speed_camera|crossing|stop|give_way)$"];node(${b})["railway"="level_crossing"];node(${b})["traffic_calming"];way(${b})["maxheight"];way(${b})["maxweight"];`,
  ).join("");
  return `[out:json][timeout:60];(${parts});out center tags;`;
}

/** Group boxes so one request covers ~15 km of route. */
export function boxGroups(line: LonLat[], perGroup = 8): string[][] {
  const b = routeBoxes(line);
  const out: string[][] = [];
  for (let i = 0; i < b.length; i += perGroup) out.push(b.slice(i, i + perGroup));
  return out;
}

interface OsmEl { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }

const num = (s?: string) => {
  if (!s) return undefined;
  const m = /([\d.,]+)/.exec(s);
  return m ? Number(m[1].replace(",", ".")) : undefined;
};

export function classify(el: OsmEl): Omit<RoadFeature, "along" | "lat" | "lon" | "id"> | null {
  const t = el.tags ?? {};
  if (t.highway === "speed_camera") return { kind: "camera", value: num(t.maxspeed) };
  if (t.railway === "level_crossing") return { kind: "rail" };
  if (t.highway === "crossing") {
    const c = t.crossing_ref === "zebra" || t.crossing === "zebra" ? "zebra" : t.crossing ?? "unmarked";
    return { kind: c === "zebra" ? "zebra" : "crossing", detail: c };
  }
  if (t.traffic_calming) return { kind: "bump", detail: t.traffic_calming };
  if (t.highway === "stop") return { kind: "stop" };
  if (t.highway === "give_way") return { kind: "giveway" };
  if (t.maxheight && el.type === "way") return { kind: "maxheight", value: num(t.maxheight) };
  if (t.maxweight && el.type === "way") return { kind: "maxweight", value: num(t.maxweight) };
  return null;
}

/** Snap OSM elements onto the route; drop those not on it or facing the other way. */
export function snapFeatures(els: OsmEl[], g: RouteGeometry, maxOffM = 25): RoadFeature[] {
  const out: RoadFeature[] = [];
  const seen = new Set<string>();
  for (const el of els) {
    const c = classify(el);
    const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
    if (!c || lat === undefined || lon === undefined) continue;
    const p = project([lon, lat], g.shape, g.cum);
    if (!p || p.offset > maxOffM) continue;
    // speed cameras with a direction only count when they face our travel direction
    const dir = el.tags?.direction;
    if (c.kind === "camera" && dir) {
      // numeric bearings can be checked; "forward"/"backward" depend on the way direction → keep
      const deg = /^\d+$/.test(dir) ? Number(dir) : undefined;
      if (deg !== undefined && angleDiff(deg, p.segmentBearing) > 70) continue;
    }
    if (c.kind === "camera" && !cameraWarningsAllowed(lon, lat)) continue;
    const id = `${el.type}/${el.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, ...c, lat, lon, along: p.along, offsetM: Math.round(p.offset * 10) / 10 });
  }
  return out.sort((a, b) => a.along - b.along);
}

const memo = new Map<string, OsmEl[]>();

async function fetchChunk(boxes: string[]): Promise<OsmEl[] | null> {
  const chunk = boxes.join("|");
  const cached = memo.get(chunk);
  if (cached) return cached;
  const body = new URLSearchParams({ data: query(boxes) });
  // Overpass is often at capacity (HTTP 429/502/504): back off and retry, alternating servers.
  for (let attempt = 0; attempt < 4; attempt++) {
    const url = OVERPASS[attempt % OVERPASS.length];
    try {
      const r = await queue(() => fetch(url, { method: "POST", body, signal: AbortSignal.timeout(65_000) }));
      if (r.ok) {
        const j = (await r.json()) as { elements: OsmEl[]; remark?: string };
        // Overpass reports timeouts/out-of-memory as HTTP 200 with a "remark" — that is a failure
        if (j.remark && /error|timed out|out of memory/i.test(j.remark)) throw new Error(j.remark);
        memo.set(chunk, j.elements);
        return j.elements;
      }
    } catch { /* network / timeout */ }
    await new Promise((res) => setTimeout(res, 2000 * 2 ** attempt));
  }
  return null;
}

export interface FeatureResult { features: RoadFeature[]; complete: boolean }

/** Fetch + snap. Never blocks driving: a failed chunk just leaves its part empty (`complete: false`). */
export async function fetchRoadFeatures(g: RouteGeometry): Promise<FeatureResult> {
  await loadBorders();
  const els: OsmEl[] = [];
  let complete = true;
  for (const chunk of boxGroups(g.shape)) {
    const got = await fetchChunk(chunk);
    if (got) els.push(...got); else complete = false;
  }
  return { features: snapFeatures(els, g), complete };
}
