// Builds public/maps/data/milieuzones.geojson from OpenStreetMap (boundary=low_emission_zone in NL).
// Source: (c) OpenStreetMap contributors, ODbL - https://www.openstreetmap.org/copyright
// Run occasionally (zones change yearly):  npm run data:milieuzones
// One small query; respects the Overpass usage policy (no bulk scraping). No dependencies.
import { writeFileSync } from "node:fs";

const QUERY = `[out:json][timeout:120];
area["ISO3166-1"="NL"][admin_level=2]->.nl;
(relation["boundary"="low_emission_zone"](area.nl);way["boundary"="low_emission_zone"](area.nl););
out geom;`;

const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

async function fetchOsm() {
  for (const url of MIRRORS) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "User-Agent": "FunqtionMaps/0.1 (personal navigation app; data build script)" },
        body: new URLSearchParams({ data: QUERY }),
        signal: AbortSignal.timeout(150_000),
      });
      if (r.ok) return { json: await r.json(), url };
      console.warn(`${url}: HTTP ${r.status}`);
    } catch (e) {
      console.warn(`${url}: ${e.message}`);
    }
  }
  throw new Error("All Overpass servers failed - try again later.");
}

const r5 = (v) => Math.round(v * 1e5) / 1e5;
const pt = (g) => [r5(g.lon), r5(g.lat)];
const same = (a, b) => a[0] === b[0] && a[1] === b[1];

/** Join way segments end-to-end into closed rings. */
function joinRings(lines) {
  const rings = [];
  const pool = lines.filter((l) => l.length > 1).map((l) => [...l]);
  while (pool.length) {
    let ring = pool.shift();
    let grew = true;
    while (!same(ring[0], ring[ring.length - 1]) && grew) {
      grew = false;
      const end = ring[ring.length - 1];
      for (let i = 0; i < pool.length; i++) {
        const l = pool[i];
        if (same(l[0], end)) { ring = ring.concat(l.slice(1)); }
        else if (same(l[l.length - 1], end)) { ring = ring.concat([...l].reverse().slice(1)); }
        else continue;
        pool.splice(i, 1); grew = true; break;
      }
    }
    if (same(ring[0], ring[ring.length - 1]) && ring.length >= 4) rings.push(ring);
  }
  return rings;
}

/** Even-odd containment: which outer ring holds this inner ring. */
function inRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function toGeometry(el) {
  if (el.type === "way") {
    const ring = el.geometry.map(pt);
    return same(ring[0], ring[ring.length - 1]) ? { type: "Polygon", coordinates: [ring] } : null;
  }
  const ways = (el.members ?? []).filter((m) => m.type === "way" && m.geometry);
  const outers = joinRings(ways.filter((m) => m.role !== "inner").map((m) => m.geometry.map(pt)));
  const inners = joinRings(ways.filter((m) => m.role === "inner").map((m) => m.geometry.map(pt)));
  if (!outers.length) return null;
  const polys = outers.map((o) => [o]);
  for (const h of inners) polys.find((p) => inRing(h[0], p[0]))?.push(h);
  return polys.length === 1 ? { type: "Polygon", coordinates: polys[0] } : { type: "MultiPolygon", coordinates: polys };
}

const { json, url } = await fetchOsm();
const keep = ["name", "website", "start_date", "operator", "description"];
const features = json.elements
  .filter((el) => el.tags?.boundary === "low_emission_zone")
  // moped-only zones (brom-/snorfiets) don't concern cars
  .filter((el) => !/brom|snor/i.test(el.tags.name ?? ""))
  .map((el) => ({
    type: "Feature",
    id: `${el.type}/${el.id}`,
    properties: Object.fromEntries(Object.entries(el.tags).filter(([k]) => keep.includes(k) || k.startsWith("low_emission_zone"))),
    geometry: toGeometry(el),
  }))
  .filter((f) => f.geometry);

const out = {
  type: "FeatureCollection",
  metadata: {
    source: "OpenStreetMap boundary=low_emission_zone (Netherlands)",
    license: "ODbL - (c) OpenStreetMap contributors",
    fetchedFrom: url,
    fetchedAt: new Date().toISOString(),
    note: "Check milieuzones.nl for the legally binding rules per city. Moped-only zones (brom-/snorfiets) removed.",
  },
  features,
};
writeFileSync(new URL("../../public/maps/data/milieuzones.geojson", import.meta.url), JSON.stringify(out));
console.log(`wrote ${features.length} zones: ${[...new Set(features.map((f) => f.properties.name ?? f.id))].join(", ")}`);
