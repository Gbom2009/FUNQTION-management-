import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { buildMapStyle } from "../theme/mapStyle";
import { HOME } from "../config/services";
import { useApp } from "../store/app";
import { usePlan, type Stop } from "../store/plan";
import { setRoutes, ALT_LAYER } from "./routeLayers";
import { onLongPress } from "./longPress";
import { reverse } from "../nav/geocode";
import { translate } from "../i18n";
import type { Route } from "../nav/valhalla";
import { useDrive } from "../store/drive";
import { uiPadding } from "./padding";
import { useUi } from "../store/ui";
import { FollowCamera } from "./followCamera";
import { remainingShape } from "../modes/drive/session";
import { useGigs } from "../features/gigs/store";
import { setWaveformMode, startWaveform } from "./waveformRoute";
import { attachPhevLayers } from "./phevLayers";
import { bindHeatmap } from "./heatmap";
import { attachDetailLayers } from "./detailLayers";
import { useMapSettings } from "./settings";
import { openPack, useOffline, wantsPack } from "../features/offline/packs";
type Map = maplibregl.Map;

// MapLibre 6 looks for its worker next to its own module. In dev that works
// (maplibre-gl is excluded from pre-bundling, see vite.config.ts); in a
// production bundle it doesn't, so ship the worker as an asset and point at it.
if (import.meta.env.PROD) maplibregl.setWorkerUrl(workerUrl);

interface Props {
  /** Drive mode uses a tilted, heading-up camera; Plan mode is flat north-up. */
  mode: "drive" | "plan";
}

function stopMarkerEl(i: number, n: number): HTMLElement {
  const el = document.createElement("div");
  const last = i === n - 1 && n > 1;
  el.textContent = i === 0 ? "A" : last ? "" : String(i);
  el.style.cssText = [
    "width:28px;height:28px;display:flex;align-items:center;justify-content:center",
    "font:700 12px var(--fq-font-body);border:2px solid #040404;cursor:grab",
    last
      ? "background:var(--fq-primary);border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:0 0 14px var(--fq-primary)"
      : i === 0
        ? "background:#f0f0f0;color:#040404;border-radius:50%"
        : "background:#040404;color:#f0f0f0;border-color:#f0f0f0;border-radius:50%",
  ].join(";");
  return el;
}

function fitTo(map: Map, route: Route | undefined, stops: Stop[]) {
  const pad = uiPadding();
  if (route) {
    const [a, b, c, d] = route.bbox;
    map.fitBounds([[a, b], [c, d]], { padding: pad, duration: 700, maxZoom: 15 });
  } else if (stops.length === 1) {
    map.easeTo({ center: [stops[0].lon, stops[0].lat], zoom: 14, duration: 700 });
  }
}

export function MapView({ mode }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const camRef = useRef<FollowCamera | null>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const theme = useApp((s) => s.theme);
  const { stops, routes, selected, active } = usePlan();

  // ---- mount ------------------------------------------------------------
  useEffect(() => {
    if (!el.current) return;
    const m = new maplibregl.Map({
      container: el.current,
      style: buildMapStyle(useApp.getState().theme),
      center: HOME,
      zoom: 12,
      attributionControl: false,
    });
    map.current = m;
    m.addControl(new maplibregl.AttributionControl({ compact: true }), "top-right");
    if (import.meta.env.DEV) (window as unknown as { __fqMap: Map }).__fqMap = m;
    m.on("error", (e) => console.warn("[map]", e.error?.message ?? e));

    // Re-add our overlay layers whenever a (theme) style finishes loading.
    m.on("style.load", () => syncRoutes(m));

    // Click an alternative to select it.
    m.on("click", ALT_LAYER, (e) => {
      const idx = e.features?.[0]?.properties?.idx;
      if (typeof idx === "number") usePlan.getState().select(idx);
    });
    m.on("mouseenter", ALT_LAYER, () => { m.getCanvas().style.cursor = "pointer"; });
    m.on("mouseleave", ALT_LAYER, () => { m.getCanvas().style.cursor = ""; });

    // Venue pin picking: the next tap (or long-press) sets the load-in door / trailer spot.
    m.on("click", (e) => {
      if (!useGigs.getState().picking) return;
      useGigs.getState().finishPicking({ lat: e.lngLat.lat, lon: e.lngLat.lng });
    });

    // Long-press / right-click → drop pin → "add stop" popup.
    const offLong = onLongPress(m, async (at) => {
      if (modeRef.current !== "plan") return;
      if (useGigs.getState().picking) { useGigs.getState().finishPicking({ lat: at.lat, lon: at.lng }); return; }
      const lang = useApp.getState().lang;
      const box = document.createElement("div");
      box.style.cssText = "font:300 13px var(--fq-font-body);color:var(--fq-text);min-width:180px";
      box.innerHTML = `<div style="color:var(--fq-muted)">…</div>`;
      const popup = new maplibregl.Popup({ closeButton: true, className: "fq-popup", maxWidth: "260px" })
        .setLngLat(at).setDOMContent(box).addTo(m);
      const place = await reverse(at.lat, at.lng);
      box.innerHTML = "";
      const name = document.createElement("div");
      name.style.cssText = "color:var(--fq-text-strong);font-weight:400";
      name.textContent = place.name;
      const detail = document.createElement("div");
      detail.style.cssText = "color:var(--fq-muted);font-size:11px;margin-bottom:10px";
      detail.textContent = place.detail ?? "";
      const btn = document.createElement("button");
      btn.className = "fq-bracket";
      btn.style.cssText = "height:44px;width:100%;color:var(--fq-primary);font:400 13px var(--fq-font-body)";
      btn.textContent = `+ ${translate(lang, "plan.addStop")}`;
      btn.onclick = () => { usePlan.getState().addStop(place); popup.remove(); };
      box.append(name, detail, btn);
    });

    // ---- drive: follow camera, puck, trimmed route ----------------------
    const cam = new FollowCamera(m);
    camRef.current = cam;
    // A user gesture (drag/rotate) pauses following until "Recenter".
    const userMoved = (e: { originalEvent?: Event }) => { if (e.originalEvent && modeRef.current === "drive") useDrive.getState().set({ follow: false }); };
    m.on("dragstart", userMoved);
    m.on("rotatestart", userMoved);
    let lastTrim = 0;
    let lastTrimAlong = -1e9;
    const unsub = useDrive.subscribe((s, prev) => {
      if (s.fix === prev.fix && s.follow === prev.follow) return;
      if (!s.fix) { cam.clear(); return; }
      cam.update(s.fix, s.guidance, s.follow && modeRef.current === "drive");
      // redraw only the part of the route still ahead, at most once a second
      const now = performance.now();
      // re-cut the remaining route only every ~150 m: each setData re-tiles the whole line
      if (modeRef.current === "drive" && s.guidance && now - lastTrim > 1000 && Math.abs(s.guidance.along - lastTrimAlong) > 150 && m.isStyleLoaded()) {
        lastTrim = now;
        lastTrimAlong = s.guidance.along;
        const rest = remainingShape();
        const r = usePlan.getState().active?.route;
        if (rest && r && rest.length > 1) setRoutes(m, [{ ...r, shape: rest }], 0);
      }
    });

    // Venue pins (address / load-in door / trailer parking) for the venue open in the editor.
    let venueMarkers: maplibregl.Marker[] = [];
    const pinEl = (label: string, color: string) => {
      const el = document.createElement("div");
      el.textContent = label;
      el.style.cssText = `width:26px;height:26px;display:flex;align-items:center;justify-content:center;border-radius:4px;font:700 12px var(--fq-font-body);color:#040404;background:${color};border:2px solid #040404`;
      return el;
    };
    const drawVenue = (fly: boolean) => {
      venueMarkers.forEach((x) => x.remove());
      venueMarkers = [];
      const s = useGigs.getState();
      const v = s.venues.find((x) => x.id === s.focusVenueId);
      if (!v) return;
      const add = (p: { lat: number; lon: number } | undefined, label: string, color: string) => {
        if (p) venueMarkers.push(new maplibregl.Marker({ element: pinEl(label, color) }).setLngLat([p.lon, p.lat]).addTo(m));
      };
      add(v.address, "A", "#f0f0f0");
      add(v.loadInDoor, "D", "#f68712");
      add(v.trailerParking, "P", "#f68712");
      const pts = [v.address, v.loadInDoor, v.trailerParking].filter(Boolean) as { lat: number; lon: number }[];
      if (fly && pts.length) m.easeTo({ center: [pts[0].lon, pts[0].lat], zoom: Math.max(m.getZoom(), 16), duration: 600 });
    };
    const unsubGigs = useGigs.subscribe((s, prev) => {
      if (s.focusVenueId !== prev.focusVenueId || s.venues !== prev.venues) {
        const addr = (st: typeof s) => st.venues.find((x) => x.id === st.focusVenueId)?.address?.id;
        // fly when another venue opens, or the open venue gets a new address
        drawVenue(s.focusVenueId !== prev.focusVenueId || addr(s) !== addr(prev));
      }
      m.getCanvas().style.cursor = s.picking ? "crosshair" : "";
    });

    const stopWave = startWaveform(m);
    const detachPhev = attachPhevLayers(m);
    bindHeatmap(m);
    const detachDetails = attachDetailLayers(m);

    return () => { detachDetails(); detachPhev(); stopWave(); unsubGigs(); venueMarkers.forEach((x) => x.remove()); unsub(); offLong(); markers.current.forEach((mk) => mk.remove()); m.remove(); map.current = null; };
  }, []);

  // ---- theme + tile source (online / offline pack) --------------------------
  const { mode: offlineMode, activePack } = useOffline();
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  const usePack = wantsPack(offlineMode, activePack, online);
  const firstStyle = useRef(true);
  const lastStyleKey = useRef("");
  useEffect(() => {
    const key = `${theme}|${usePack ? activePack : "online"}`;
    if (firstStyle.current && !usePack) { firstStyle.current = false; lastStyleKey.current = key; return; }
    firstStyle.current = false;
    if (key === lastStyleKey.current) return;
    lastStyleKey.current = key;
    let cancelled = false;
    (async () => {
      let tilesUrl: string | undefined;
      if (usePack && activePack) {
        try { tilesUrl = await openPack(activePack); } catch (e) { console.warn("[offline]", e); }
      }
      // diff:false → full reload, so "style.load" fires and our route layers get re-added
      if (!cancelled) map.current?.setStyle(buildMapStyle(theme, { tilesUrl }), { diff: false });
    })();
    return () => { cancelled = true; };
  }, [theme, usePack, activePack]);

  // ---- routes -------------------------------------------------------------
  function syncRoutes(m: Map) {
    const p = usePlan.getState();
    if (modeRef.current === "drive") setRoutes(m, p.active ? [p.active.route] : [], 0);
    else setRoutes(m, p.routes, p.selected);
  }
  useEffect(() => {
    const m = map.current;
    if (m?.isStyleLoaded()) syncRoutes(m);
  }, [routes, selected, active, mode]);

  // Re-fit when the side panel appears or the sheet settles at a new height,
  // so the route is never hidden behind the UI.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = useUi.subscribe((s, prev) => {
      if (s.panelPx === prev.panelPx && s.sheetSnap === prev.sheetSnap) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const m = map.current;
        const p = usePlan.getState();
        if (m && modeRef.current === "plan" && p.routes.length) fitTo(m, p.routes[p.selected], p.stops);
      }, 320); // after the sheet animation
    });
    return () => { unsub(); if (timer) clearTimeout(timer); };
  }, []);

  // Fit to the route when a new set of routes arrives (Plan mode only).
  useEffect(() => {
    const m = map.current;
    if (m && mode === "plan") fitTo(m, routes[0], stops);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routes]);

  // ---- stop markers -------------------------------------------------------
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    markers.current.forEach((mk) => mk.remove());
    const shown = mode === "drive" ? active?.stops ?? [] : stops;
    if (mode === "plan" && stops.length === 1) fitTo(m, undefined, stops);
    markers.current = shown.map((s, i) => {
      const mk = new maplibregl.Marker({ element: stopMarkerEl(i, shown.length), draggable: mode === "plan" })
        .setLngLat([s.lon, s.lat]).addTo(m);
      mk.on("dragend", async () => {
        // Drag a stop marker to move it; re-geocode the new spot.
        const ll = mk.getLngLat();
        const place = await reverse(ll.lat, ll.lng);
        usePlan.getState().replaceStop(s.key, place);
      });
      return mk;
    });
  }, [stops, active, mode]);

  useEffect(() => { setWaveformMode(mode); }, [mode]);

  // ---- camera per mode ----------------------------------------------------
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (mode === "drive") {
      const start = usePlan.getState().active?.route.shape[0];
      m.easeTo({ pitch: useMapSettings.getState().tilt, zoom: 15.5, duration: 800, ...(start ? { center: start } : {}) });
    } else {
      m.easeTo({ pitch: 0, bearing: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 800 });
    }
  }, [mode, active?.sessionId]);

  // MapLibre forces position:relative on its container, so size it via a wrapper.
  return (
    <div className="absolute inset-0">
      <div ref={el} className="h-full w-full" data-testid="map" />
    </div>
  );
}
