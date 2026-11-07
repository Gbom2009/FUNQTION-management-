import type { RouteOptions } from "../../nav/valhalla";
import type { LonLat } from "../../nav/geo";
import { parseGpx } from "./gpx";

/**
 * Plan on the iPad → drive on the iPhone, no server: the plan (stops +
 * options + trailer profile) is compressed into a short text that fits a QR
 * code, or saved as a .fqroute / .gpx file. Pure functions, tested.
 */
export interface HandoffStop { n: string; lat: number; lon: number }
export interface HandoffTrailer { name: string; l?: number; w?: number; h?: number; kg?: number }
export interface HandoffPayload {
  v: 1;
  stops: HandoffStop[];
  /** options as a bitmask: 1 motorways, 2 tolls, 4 ferries, 8 shortest */
  o: number;
  vehicle?: string;
  trailer?: HandoffTrailer;
}

export function optionsToBits(o: RouteOptions): number {
  return (o.avoidMotorways ? 1 : 0) | (o.avoidTolls ? 2 : 0) | (o.avoidFerries ? 4 : 0) | (o.shortest ? 8 : 0);
}
export function bitsToOptions(b: number): RouteOptions {
  return { avoidMotorways: !!(b & 1), avoidTolls: !!(b & 2), avoidFerries: !!(b & 4), shortest: !!(b & 8) };
}

const round5 = (n: number) => Math.round(n * 1e5) / 1e5;

export function makePayload(stops: { name: string; lat: number; lon: number }[], options: RouteOptions,
  vehicle?: string, trailer?: HandoffTrailer): HandoffPayload {
  return {
    v: 1,
    // names trimmed: QR capacity matters more than a long street suffix
    stops: stops.map((s) => ({ n: s.name.slice(0, 48), lat: round5(s.lat), lon: round5(s.lon) })),
    o: optionsToBits(options),
    ...(vehicle ? { vehicle } : {}),
    ...(trailer ? { trailer } : {}),
  };
}

// --- base64url ---------------------------------------------------------
function toB64u(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64u(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

/** "FQR1.<deflate+base64url>" (or "FQR0.<base64url>" where CompressionStream is missing). */
export async function encodeRoute(p: HandoffPayload): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(p));
  if (typeof CompressionStream !== "undefined") return `FQR1.${toB64u(await pipe(json, new CompressionStream("deflate-raw")))}`;
  return `FQR0.${toB64u(json)}`;
}

export async function decodeRoute(code: string): Promise<HandoffPayload> {
  const m = /^(?:fqmaps:\/\/route\?d=)?FQR([01])\.([A-Za-z0-9_-]+)$/.exec(code.trim());
  if (!m) throw new Error("Not a Funqtion Maps route code");
  let bytes = fromB64u(m[2]);
  if (m[1] === "1") bytes = await pipe(bytes, new DecompressionStream("deflate-raw"));
  return validate(JSON.parse(new TextDecoder().decode(bytes)));
}

function validate(p: unknown): HandoffPayload {
  const x = p as HandoffPayload;
  if (!x || x.v !== 1 || !Array.isArray(x.stops) || x.stops.length < 1) throw new Error("Invalid route payload");
  for (const s of x.stops) {
    if (typeof s.lat !== "number" || typeof s.lon !== "number" || Math.abs(s.lat) > 90 || Math.abs(s.lon) > 180) throw new Error("Invalid stop");
    s.n = String(s.n ?? "").slice(0, 80);
  }
  x.o = Number(x.o) & 15;
  return x;
}

// --- files ----------------------------------------------------------------
export interface FqRouteFile { format: "fqroute"; version: 1; createdAt: string; plan: HandoffPayload; shape?: LonLat[] }

export function toFqRoute(plan: HandoffPayload, shape?: LonLat[]): string {
  const f: FqRouteFile = { format: "fqroute", version: 1, createdAt: new Date().toISOString(), plan, ...(shape ? { shape } : {}) };
  return JSON.stringify(f, null, 1);
}

const esc = (s: string) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);

/** GPX 1.1: stops as a <rte>, the computed route geometry as a <trk>. */
export function toGpx(plan: HandoffPayload, shape?: LonLat[], name = "Funqtion Maps route"): string {
  const rte = plan.stops.map((s) => `<rtept lat="${s.lat}" lon="${s.lon}"><name>${esc(s.n)}</name></rtept>`).join("");
  const trk = shape?.length
    ? `<trk><name>${esc(name)}</name><trkseg>${shape.map(([lon, lat]) => `<trkpt lat="${round5(lat)}" lon="${round5(lon)}"/>`).join("")}</trkseg></trk>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Funqtion Maps" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>${esc(name)}</name></metadata><rte><name>${esc(name)}</name>${rte}</rte>${trk}</gpx>`;
}

/** Read stops from GPX: <rtept>/<wpt> if there are a few, else start + end of the track. */
export function stopsFromGpx(xml: string): { stops: HandoffStop[]; simplified: boolean } {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Invalid GPX");
  const pts = [...doc.getElementsByTagName("rtept"), ...doc.getElementsByTagName("wpt")];
  if (pts.length >= 2 && pts.length <= 25) {
    return {
      stops: pts.map((n, i) => ({
        n: n.getElementsByTagName("name")[0]?.textContent ?? `Stop ${i + 1}`,
        lat: Number(n.getAttribute("lat")), lon: Number(n.getAttribute("lon")),
      })),
      simplified: false,
    };
  }
  const t = parseGpx(xml);
  const a = t.points[0], b = t.points[t.points.length - 1];
  return { stops: [{ n: "Start", lat: a[1], lon: a[0] }, { n: t.name ?? "Einde", lat: b[1], lon: b[0] }], simplified: true };
}

export function parseFqRoute(text: string): FqRouteFile {
  const f = JSON.parse(text) as FqRouteFile;
  if (f.format !== "fqroute") throw new Error("Not a .fqroute file");
  f.plan = validate(f.plan);
  return f;
}
