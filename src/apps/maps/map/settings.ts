import { create } from "zustand";
import { persist } from "zustand/middleware";
import { lazyStorage } from "../store/storage";

/** What the map shows and how the drive camera behaves — all user-tweakable. */
export interface MapSettings {
  // map layers
  oneway: boolean;
  houseNumbers: boolean;
  pois: boolean;
  buildings3d: boolean;
  /** cameras, traffic lights, crossings, level crossings … along the route */
  routeDetails: boolean;
  /** cycle lanes along the route, green */
  cycleLanes: boolean;
  pulse: boolean;
  // drive camera
  tilt: number;
  headingUp: boolean;
  autoZoom: boolean;
  /** −1 … +1: zoom out / in relative to the speed-based zoom */
  zoomBias: number;
  // HUD
  etaMode: "arrival" | "remaining";
  showThen: boolean;
  bannerSize: "normal" | "large";
  set: (p: Partial<Omit<MapSettings, "set">>) => void;
}

export const useMapSettings = create<MapSettings>()(
  persist(
    (set) => ({
      oneway: true,
      houseNumbers: true,
      pois: true,
      buildings3d: false,
      routeDetails: true,
      cycleLanes: true,
      pulse: true,
      tilt: 55,
      headingUp: true,
      autoZoom: true,
      zoomBias: 0,
      etaMode: "arrival",
      showThen: true,
      bannerSize: "normal",
      set: (p) => set(p),
    }),
    { name: "fq-map-settings", storage: lazyStorage },
  ),
);
