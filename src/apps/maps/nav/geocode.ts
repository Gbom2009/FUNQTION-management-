import { services, HOME } from "../config/services";
import { createThrottle } from "./throttle";

export interface Place {
  id: string;
  name: string;
  /** Secondary line, e.g. town/region. */
  detail?: string;
  lat: number;
  lon: number;
  source: "pdok" | "photon" | "pin";
}

const pdokQueue = createThrottle(1000);
const photonQueue = createThrottle(1000);

/** PDOK returns "POINT(lon lat)". */
export function parseWktPoint(wkt: string): { lon: number; lat: number } | null {
  const m = /POINT\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/.exec(wkt);
  return m ? { lon: Number(m[1]), lat: Number(m[2]) } : null;
}

interface PdokDoc { id?: string; type: string; weergavenaam: string; centroide_ll: string }

function fromPdok(d: PdokDoc, i: number): Place | null {
  const p = parseWktPoint(d.centroide_ll);
  if (!p) return null;
  const [name, ...rest] = d.weergavenaam.split(", ");
  return { id: d.id ?? `pdok-${i}-${d.weergavenaam}`, name, detail: rest.join(", ") || d.type, ...p, source: "pdok" };
}

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: Record<string, string | undefined> & { osm_id?: number | string; osm_type?: string };
}

function fromPhoton(f: PhotonFeature, i: number): Place {
  const pr = f.properties;
  const street = [pr.street, pr.housenumber].filter(Boolean).join(" ");
  const name = pr.name ?? (street || pr.city || "?");
  const detail = [pr.name ? street : undefined, pr.postcode, pr.city ?? pr.locality, pr.country]
    .filter(Boolean).join(", ");
  const [lon, lat] = f.geometry.coordinates;
  return { id: `photon-${pr.osm_type ?? ""}${pr.osm_id ?? i}`, name, detail, lat, lon, source: "photon" };
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`${new URL(url).host} ${r.status}`);
  return r.json() as Promise<T>;
}

export async function searchPdok(q: string, signal?: AbortSignal): Promise<Place[]> {
  const u = new URL(`${services.pdok}/free`);
  u.searchParams.set("q", q);
  u.searchParams.set("rows", "8");
  u.searchParams.set("fl", "id,weergavenaam,type,centroide_ll");
  u.searchParams.set("fq", "type:(adres OR weg OR woonplaats OR postcode OR gemeente)");
  const j = await pdokQueue(() => getJson<{ response: { docs: PdokDoc[] } }>(u.toString(), signal));
  return j.response.docs.map(fromPdok).filter((p): p is Place => p !== null);
}

export async function searchPhoton(q: string, lang: string, signal?: AbortSignal, near: [number, number] = HOME): Promise<Place[]> {
  const u = new URL(`${services.photon}/api/`);
  u.searchParams.set("q", q);
  u.searchParams.set("limit", "8");
  // Photon supports en/de/fr; default (local names) is best for NL/BE.
  if (lang === "en") u.searchParams.set("lang", "en");
  u.searchParams.set("lon", String(near[0]));
  u.searchParams.set("lat", String(near[1]));
  const j = await photonQueue(() => getJson<{ features: PhotonFeature[] }>(u.toString(), signal));
  return j.features.map(fromPhoton);
}

export interface SearchResult { places: Place[]; source: "pdok" | "photon" | "none"; error?: string }

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * True when every word of the query appears in the place's name/detail.
 * PDOK fuzzy-matches aggressively ("Effenaar Eindhoven" → "Gemeente
 * Eindhoven"), so a result only counts as a real hit if it matches all words.
 */
export function matchesAllTokens(p: Pick<Place, "name" | "detail">, query: string): boolean {
  const hay = norm(`${p.name} ${p.detail ?? ""}`);
  return norm(query).split(/[\s,]+/).filter(Boolean).every((tok) => hay.includes(tok));
}

/**
 * PDOK first (best for Dutch addresses). If PDOK has no result matching all
 * query words, or is down, Photon is queried too — covers venues/POIs and
 * anything outside NL — and its results go first.
 */
export async function search(q: string, lang: string, signal?: AbortSignal): Promise<SearchResult> {
  const query = q.trim();
  if (query.length < 3) return { places: [], source: "none" };
  let pdokError: string | undefined;
  let pdok: Place[] = [];
  try {
    pdok = await searchPdok(query, signal);
    if (pdok.some((p) => matchesAllTokens(p, query))) return { places: pdok, source: "pdok" };
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    pdokError = (e as Error).message;
  }
  try {
    const photon = await searchPhoton(query, lang, signal);
    const places = [...photon, ...pdok];
    return { places, source: photon.length ? "photon" : pdok.length ? "pdok" : "none", error: pdokError };
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    return { places: [], source: "none", error: [pdokError, (e as Error).message].filter(Boolean).join(" / ") };
  }
}

/** Reverse geocode for long-press pins. PDOK first, Photon fallback, then raw coords. */
export async function reverse(lat: number, lon: number): Promise<Place> {
  const coords = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  const fallback: Place = { id: `pin-${lat}-${lon}`, name: coords, lat, lon, source: "pin" };
  try {
    const u = new URL(`${services.pdok}/reverse`);
    u.searchParams.set("lat", String(lat));
    u.searchParams.set("lon", String(lon));
    u.searchParams.set("rows", "1");
    u.searchParams.set("type", "adres");
    u.searchParams.set("fl", "weergavenaam,type,centroide_ll");
    const j = await pdokQueue(() => getJson<{ response: { docs: PdokDoc[] } }>(u.toString()));
    const d = j.response.docs[0];
    if (d) {
      const [name, ...rest] = d.weergavenaam.split(", ");
      return { ...fallback, name, detail: rest.join(", ") };
    }
  } catch { /* fall through */ }
  try {
    const u = new URL(`${services.photon}/reverse`);
    u.searchParams.set("lat", String(lat));
    u.searchParams.set("lon", String(lon));
    const j = await photonQueue(() => getJson<{ features: PhotonFeature[] }>(u.toString()));
    const f = j.features[0];
    if (f) { const p = fromPhoton(f, 0); return { ...fallback, name: p.name, detail: p.detail }; }
  } catch { /* fall through */ }
  return fallback;
}
