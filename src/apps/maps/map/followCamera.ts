import * as maplibregl from "maplibre-gl";
import type { Fix } from "../location/provider";
import type { GuidanceState } from "../nav/guidance";
import { useMapSettings } from "./settings";
import { activeVehicle } from "../features/vehicles/store";

/** Zoom by speed: 17 when crawling, ~14 at motorway speed. */
export function zoomForSpeed(kmh: number): number {
  const s = Math.max(0, Math.min(130, kmh));
  return 17 - (s / 130) * 3;
}

function puckEl(color = "#f68712"): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = `<svg viewBox="0 0 48 48" width="48" height="48" aria-hidden>
    <circle cx="24" cy="24" r="21" fill="${color}" fill-opacity=".22"/>
    <circle cx="24" cy="24" r="15" fill="#040404" stroke="${color}" stroke-width="3"/>
    <path d="M24 12 L32 32 L24 27 L16 32 Z" fill="${color}"/>
  </svg>`;
  el.style.cssText = `width:48px;height:48px;filter:drop-shadow(0 0 8px ${color}99)`;
  return el;
}

/**
 * Heading-up, tilted follow camera + vehicle puck. Snaps to the route when on
 * it, raw GPS otherwise. Heading is smoothed so noisy fixes don't wobble the map.
 */
export class FollowCamera {
  private puck: maplibregl.Marker | null = null;
  private bearing = 0;

  constructor(private map: maplibregl.Map) {}

  update(f: Fix, g: GuidanceState | null, follow: boolean) {
    const onRoute = g && !g.offRoute && g.offset < 30;
    const pos: [number, number] = onRoute ? g.snapped : [f.lon, f.lat];
    // On route use the road's bearing (stable); off route the GPS heading.
    const target = onRoute && f.speedKmh > 3 ? g.routeBearing : f.speedKmh > 3 ? f.heading : this.bearing;
    const delta = ((target - this.bearing + 540) % 360) - 180;
    this.bearing = (this.bearing + delta * 0.35 + 360) % 360;

    if (!this.puck) {
      this.puck = new maplibregl.Marker({ element: puckEl(activeVehicle()?.color), rotationAlignment: "map", pitchAlignment: "map" })
        .setLngLat(pos).addTo(this.map);
    }
    this.puck.setLngLat(pos).setRotation(this.bearing);

    if (follow) {
      const h = this.map.getContainer().clientHeight;
      const st = useMapSettings.getState();
      this.map.easeTo({
        center: pos,
        bearing: st.headingUp ? this.bearing : 0,
        pitch: st.tilt,
        zoom: st.autoZoom ? zoomForSpeed(f.speedKmh) + st.zoomBias : this.map.getZoom(),
        // keep the car in the lower third so you see more road ahead
        padding: { top: Math.round(h * 0.4), bottom: 0, left: 0, right: 0 },
        duration: 260,
        easing: (x) => x,
      });
    }
  }

  clear() {
    this.puck?.remove();
    this.puck = null;
    this.map.easeTo({ padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 0 });
  }
}
