// Builds public/maps/data/nl-be.geojson: Netherlands + Belgium outlines (Natural Earth 1:50m,
// public domain, via the world-atlas package). Used to decide where speed-camera
// warnings are legal (NL/BE yes; DE/FR/CH/AT no). Accuracy ~1–2 km at the border.
// Run: npm run data:borders
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { feature } from "topojson-client";

const require = createRequire(import.meta.url);
const topo = JSON.parse(readFileSync(require.resolve("world-atlas/countries-50m.json"), "utf8"));
const all = feature(topo, topo.objects.countries);
const pick = all.features.filter((f) => f.id === "528" || f.id === "056");
const r4 = (v) => Math.round(v * 1e4) / 1e4;
const round = (c) => (typeof c[0] === "number" ? [r4(c[0]), r4(c[1])] : c.map(round));
const out = {
  type: "FeatureCollection",
  metadata: { source: "Natural Earth 1:50m via world-atlas@2 (public domain)", use: "speed camera warning legality (NL/BE)" },
  features: pick.map((f) => ({ type: "Feature", id: f.id, properties: { name: f.properties.name }, geometry: { type: f.geometry.type, coordinates: round(f.geometry.coordinates) } })),
};
writeFileSync(new URL("../../public/maps/data/nl-be.geojson", import.meta.url), JSON.stringify(out));
console.log("wrote", pick.map((f) => f.properties.name).join(", "));
