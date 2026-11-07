import * as maplibregl from "maplibre-gl";
import type { Map, GeoJSONSource } from "maplibre-gl";
import { loadZones } from "../features/phev/zones";
import { usePhev } from "../features/phev/store";
import { fetchChargers, MissingKeyError, ocmKey, type Charger } from "../features/phev/chargers";

/**
 * Map overlays for PHEV features: milieuzone areas (bundled GeoJSON) and the
 * Open Charge Map charger layer (fetched for the visible area, zoom ≥ 11).
 */
const ZONES = "fq-zones";
const CHARGERS = "fq-chargers";
const MIN_CHARGER_ZOOM = 11;

export type ChargerStatus = { state: "off" | "zoom" | "loading" | "ok" | "nokey" | "error"; count?: number; message?: string };
let status: ChargerStatus = { state: "off" };
const listeners = new Set<(s: ChargerStatus) => void>();
export function onChargerStatus(fn: (s: ChargerStatus) => void) { listeners.add(fn); fn(status); return () => { listeners.delete(fn); }; }
function setStatus(s: ChargerStatus) { status = s; listeners.forEach((l) => l(s)); }

/** user-entered key (Settings) — kept in localStorage, never in source */
export function userOcmKey(): string { try { return localStorage.getItem("fq-ocm-key") ?? ""; } catch { return ""; } }
export function setUserOcmKey(k: string) { try { localStorage.setItem("fq-ocm-key", k.trim()); } catch { /* ignore */ } }

function zonesBefore(map: Map) {
  // under roads/labels if possible, so the zone tint never hides the map
  return map.getLayer("road-minor") ? "road-minor" : undefined;
}

async function addZoneLayers(map: Map) {
  if (map.getSource(ZONES)) return;
  const zones = await loadZones();
  if (!map.style || map.getSource(ZONES)) return;
  map.addSource(ZONES, {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: zones.map((z) => ({
        type: "Feature", properties: { name: z.name },
        geometry: { type: "MultiPolygon", coordinates: z.polygons },
      })),
    },
  });
  map.addLayer({ id: `${ZONES}-fill`, type: "fill", source: ZONES, paint: { "fill-color": "#3ddc84", "fill-opacity": 0.11 } }, zonesBefore(map));
  map.addLayer({ id: `${ZONES}-line`, type: "line", source: ZONES, paint: { "line-color": "#3ddc84", "line-width": 1.5, "line-opacity": 0.8, "line-dasharray": [3, 2] } }, zonesBefore(map));
}

function addChargerLayers(map: Map) {
  if (map.getSource(CHARGERS)) return;
  map.addSource(CHARGERS, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({
    id: CHARGERS, type: "circle", source: CHARGERS,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 4, 16, 8],
      "circle-color": ["step", ["get", "kw"], "#8d8d8d", 22, "#f68712", 50, "#ffd29a"],
      "circle-stroke-color": "#040404",
      "circle-stroke-width": 1.5,
    },
  });
  map.addLayer({
    id: `${CHARGERS}-label`, type: "symbol", source: CHARGERS, minzoom: 14,
    layout: { "text-field": ["concat", ["to-string", ["get", "kw"]], " kW"], "text-font": ["Noto Sans Regular"], "text-size": 10, "text-offset": [0, 1.2] },
    paint: { "text-color": "#f68712", "text-halo-color": "#040404", "text-halo-width": 1.2 },
  });
}

function chargerFeatures(list: Charger[]) {
  return {
    type: "FeatureCollection" as const,
    features: list.map((c) => ({
      type: "Feature" as const,
      properties: { id: c.id, name: c.name, address: c.address ?? "", kw: Math.round(c.maxKw), points: c.points, connectors: c.connectors.join(", "), cost: c.cost ?? "" },
      geometry: { type: "Point" as const, coordinates: [c.lon, c.lat] },
    })),
  };
}

/** Wire overlays to the map; returns a cleanup. Call again after each style load. */
export function attachPhevLayers(map: Map): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastKey = "";
  let cache: Charger[] = [];

  const applyVisibility = () => {
    const p = usePhev.getState();
    for (const id of [`${ZONES}-fill`, `${ZONES}-line`]) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", p.showZones ? "visible" : "none");
    for (const id of [CHARGERS, `${CHARGERS}-label`]) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", p.chargers ? "visible" : "none");
  };

  const refreshChargers = () => {
    const p = usePhev.getState();
    if (!p.chargers) { setStatus({ state: "off" }); return; }
    if (map.getZoom() < MIN_CHARGER_ZOOM) { setStatus({ state: "zoom" }); return; }
    const b = map.getBounds();
    // round the bbox so small pans reuse the last result
    const r = (v: number) => Math.round(v * 50) / 50;
    const bbox: [number, number, number, number] = [r(b.getWest()) - 0.02, r(b.getSouth()) - 0.02, r(b.getEast()) + 0.02, r(b.getNorth()) + 0.02];
    const key = `${bbox.join(",")}|${p.chargerMinKw}|${p.chargerConnector}`;
    if (key === lastKey) { setStatus({ state: "ok", count: cache.length }); return; }
    setStatus({ state: "loading" });
    fetchChargers(bbox, { minKw: p.chargerMinKw, connector: p.chargerConnector, key: ocmKey(userOcmKey()) })
      .then((list) => {
        lastKey = key; cache = list;
        (map.getSource(CHARGERS) as GeoJSONSource | undefined)?.setData(chargerFeatures(list));
        setStatus({ state: "ok", count: list.length });
      })
      .catch((e) => setStatus(e instanceof MissingKeyError ? { state: "nokey" } : { state: "error", message: (e as Error).message }));
  };
  const schedule = () => { if (timer) clearTimeout(timer); timer = setTimeout(refreshChargers, 800); };

  const onStyle = () => {
    void addZoneLayers(map).then(applyVisibility);
    addChargerLayers(map);
    if (cache.length) (map.getSource(CHARGERS) as GeoJSONSource).setData(chargerFeatures(cache));
    applyVisibility();
  };
  if (map.isStyleLoaded()) onStyle();
  map.on("style.load", onStyle);
  map.on("moveend", schedule);

  const popup = (e: maplibregl.MapLayerMouseEvent) => {
    const f = e.features?.[0];
    if (!f) return;
    const pr = f.properties as Record<string, string | number>;
    const el = document.createElement("div");
    el.style.cssText = "font:300 12px var(--fq-font-body);color:var(--fq-text);max-width:220px";
    const title = document.createElement("div");
    title.style.cssText = "color:var(--fq-text-strong);font-weight:400";
    title.textContent = String(pr.name);
    const meta = document.createElement("div");
    meta.style.cssText = "color:var(--fq-muted);margin-top:4px";
    meta.textContent = [pr.address, `${pr.kw} kW · ${pr.points}×`, pr.connectors, pr.cost].filter(Boolean).join("\n");
    meta.style.whiteSpace = "pre-line";
    el.append(title, meta);
    new maplibregl.Popup({ className: "fq-popup", maxWidth: "240px" }).setLngLat(e.lngLat).setDOMContent(el).addTo(map);
  };
  map.on("click", CHARGERS, popup);

  const unsub = usePhev.subscribe((s, prev) => {
    applyVisibility();
    if (s.chargers !== prev.chargers || s.chargerMinKw !== prev.chargerMinKw || s.chargerConnector !== prev.chargerConnector) { lastKey = ""; schedule(); }
  });
  schedule();

  return () => {
    unsub();
    if (timer) clearTimeout(timer);
    map.off("style.load", onStyle);
    map.off("moveend", schedule);
    map.off("click", CHARGERS, popup);
  };
}

/** Force a refetch (e.g. after the API key changes). */
export function resetChargerCache(map: Map | null) {
  if (map) map.fire("moveend");
}
