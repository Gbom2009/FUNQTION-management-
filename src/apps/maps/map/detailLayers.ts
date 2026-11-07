import type { Map, GeoJSONSource } from "maplibre-gl";
import { useMapSettings } from "./settings";
import { attachIcons, ICON_FOR } from "./icons";
import { useDrive } from "../store/drive";
import { roadDetailData } from "../modes/drive/session";

/**
 * Route detail overlay (drive mode): pictograms for speed cameras, traffic
 * lights, zebra crossings, level crossings, bumps, stop/give-way and height
 * limits, plus cycle lanes as a green line next to the route. Also applies the
 * user's base-layer toggles (one-way arrows, house numbers, POIs, 3D).
 */
const PTS = "fq-details";
const CYC = "fq-cycle";

function ensure(map: Map) {
  if (!map.getSource(PTS)) {
    map.addSource(PTS, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({
      id: PTS, type: "symbol", source: PTS, minzoom: 13,
      layout: {
        "icon-image": ["get", "icon"],
        "icon-size": ["interpolate", ["linear"], ["zoom"], 13, 0.5, 17, 0.9],
        "icon-allow-overlap": true,
        "text-field": ["get", "label"], "text-font": ["Noto Sans Bold"], "text-size": 11, "text-offset": [0, 1.4], "text-optional": true,
      },
      paint: { "text-color": "#f0f0f0", "text-halo-color": "#040404", "text-halo-width": 1.5 },
    });
  }
  if (!map.getSource(CYC)) {
    map.addSource(CYC, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({
      id: CYC, type: "line", source: CYC, minzoom: 13,
      layout: { "line-cap": "round" },
      paint: { "line-color": "#3ddc84", "line-width": 3, "line-offset": 9, "line-opacity": 0.85 },
    }, map.getLayer("fq-route-alt-casing") ? "fq-route-alt-casing" : undefined);
  }
}

function applyVisibility(map: Map) {
  const s = useMapSettings.getState();
  const vis = (id: string, on: boolean) => { if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none"); };
  vis("oneway", s.oneway);
  vis("housenumber", s.houseNumbers);
  vis("poi-dot", s.pois);
  vis("poi-label", s.pois);
  vis("building-3d", s.buildings3d);
  vis("building", !s.buildings3d);
  vis(PTS, s.routeDetails);
  vis(CYC, s.cycleLanes);
}

function setData(map: Map) {
  const d = roadDetailData();
  (map.getSource(PTS) as GeoJSONSource | undefined)?.setData({
    type: "FeatureCollection",
    features: d.points.map((p) => ({
      type: "Feature", properties: { icon: ICON_FOR[p.kind] ?? "fq-signal", label: p.label ?? "" },
      geometry: { type: "Point", coordinates: [p.lon, p.lat] },
    })),
  });
  (map.getSource(CYC) as GeoJSONSource | undefined)?.setData({
    type: "FeatureCollection",
    features: d.cycle.map((line) => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: line } })),
  });
}

export function attachDetailLayers(map: Map): () => void {
  attachIcons(map);
  const onStyle = () => { ensure(map); setData(map); applyVisibility(map); };
  if (map.isStyleLoaded()) onStyle();
  map.on("style.load", onStyle);
  const u1 = useMapSettings.subscribe(() => applyVisibility(map));
  const u2 = useDrive.subscribe((s, p) => { if (s.detailVersion !== p.detailVersion && map.getSource(PTS)) setData(map); });
  return () => { map.off("style.load", onStyle); u1(); u2(); };
}
