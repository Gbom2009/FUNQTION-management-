import type { Map, GeoJSONSource } from "maplibre-gl";
import type { LonLat } from "../nav/geo";
import { uiPadding } from "./padding";

/**
 * Heatmap of driven roads (Setlist tab): every trip track as a faint orange
 * line — roads driven often stack up brighter. Shown only while the Setlist
 * tab is open.
 */
const SRC = "fq-heat";
let map: Map | null = null;
let data: LonLat[][] | null = null;

export function bindHeatmap(m: Map) {
  map = m;
  m.on("style.load", draw);
  draw();
}

export function setHeatmap(tracks: LonLat[][] | null) {
  data = tracks;
  draw();
  if (map && tracks?.length) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const t of tracks) for (const [x, y] of t) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    map.fitBounds([[minX, minY], [maxX, maxY]], { padding: uiPadding(), duration: 700, maxZoom: 13 });
  }
}

function draw() {
  const m = map;
  if (!m || !m.isStyleLoaded()) return;
  const fc = {
    type: "FeatureCollection" as const,
    features: (data ?? []).filter((t) => t.length > 1).map((t) => ({ type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: t } })),
  };
  if (!m.getSource(SRC)) {
    m.addSource(SRC, { type: "geojson", data: fc });
    m.addLayer({
      id: SRC, type: "line", source: SRC,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#f68712", "line-opacity": 0.28, "line-width": ["interpolate", ["linear"], ["zoom"], 6, 2, 14, 5], "line-blur": 1 },
    });
  } else {
    (m.getSource(SRC) as GeoJSONSource).setData(fc);
  }
}
