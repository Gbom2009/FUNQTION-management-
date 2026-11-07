import type { Map, GeoJSONSource } from "maplibre-gl";
import type { Route } from "../nav/valhalla";

/**
 * Route rendering. Alternatives are muted grey; the selected route is the
 * hero: orange core + soft glow. (The animated "waveform" pulse is Phase 4.)
 */
const SRC = "fq-routes";

function cssVar(name: string, fallback: string) {
  const v = getComputedStyle(document.querySelector(".fq-maps") ?? document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function ensureRouteLayers(map: Map) {
  if (map.getSource(SRC)) return;
  const orange = cssVar("--fq-route", "#f68712");
  const alt = cssVar("--fq-muted", "#8d8d8d");
  const bg = cssVar("--fq-bg", "#040404");
  // lineMetrics enables line-progress for the waveform pulse gradient
  map.addSource(SRC, { type: "geojson", lineMetrics: true, data: { type: "FeatureCollection", features: [] } });
  const w = (base: number) => ["interpolate", ["exponential", 1.4], ["zoom"], 6, base * 0.5, 12, base, 18, base * 3] as never;
  map.addLayer({ id: "fq-route-alt-casing", type: "line", source: SRC, filter: ["==", ["get", "selected"], false],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": bg, "line-width": w(7) } });
  map.addLayer({ id: "fq-route-alt", type: "line", source: SRC, filter: ["==", ["get", "selected"], false],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": alt, "line-width": w(4), "line-opacity": 0.8 } });
  map.addLayer({ id: "fq-route-glow", type: "line", source: SRC, filter: ["==", ["get", "selected"], true],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": orange, "line-width": w(16), "line-blur": 10, "line-opacity": 0.45 } });
  map.addLayer({ id: "fq-route-casing", type: "line", source: SRC, filter: ["==", ["get", "selected"], true],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#040404", "line-width": w(8) } });
  map.addLayer({ id: "fq-route-main", type: "line", source: SRC, filter: ["==", ["get", "selected"], true],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": orange, "line-width": w(5) } });
  map.addLayer({ id: PULSE_LAYER, type: "line", source: SRC, filter: ["==", ["get", "selected"], true],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-width": w(7), "line-blur": 2, "line-gradient": ["interpolate", ["linear"], ["line-progress"], 0, "rgba(0,0,0,0)", 1, "rgba(0,0,0,0)"] } });
}

export function setRoutes(map: Map, routes: Route[], selected: number) {
  ensureRouteLayers(map);
  const src = map.getSource(SRC) as GeoJSONSource;
  // selected last so it draws on top within shared layers
  const order = routes.map((r, i) => ({ r, i })).sort((a, b) => Number(a.i === selected) - Number(b.i === selected));
  src.setData({
    type: "FeatureCollection",
    features: order.map(({ r, i }) => ({
      type: "Feature",
      properties: { idx: i, selected: i === selected },
      geometry: { type: "LineString", coordinates: r.shape },
    })),
  });
}

export const ALT_LAYER = "fq-route-alt";
export const PULSE_LAYER = "fq-route-pulse";
