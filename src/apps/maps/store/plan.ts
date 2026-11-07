import { create } from "zustand";
import { persist } from "zustand/middleware";
import { lazyStorage } from "./storage";
import type { Place } from "../nav/geocode";
import { DEFAULT_OPTIONS, getRoutes, type Route, type RouteOptions } from "../nav/valhalla";
import { useApp } from "./app";
import { unlockAudio } from "../nav/tts/piper";
import { activeVehicle, currentTow, useVehicles, type TowProfile } from "../features/vehicles/store";
import { autoCosting } from "../features/vehicles/apply";
import type { TowRouting } from "../nav/valhalla";

/** Valhalla truck parameters for the attached trailer, or undefined without one. */
export function towRouting(t: TowProfile | null): TowRouting | undefined {
  if (!t) return undefined;
  // a slower cruise preference of the car still applies when towing
  const cruise = t.vehicle.cruiseKmh;
  return { ...t.dims, topSpeedKmh: cruise ? Math.min(cruise, t.caps.motorway) : t.caps.motorway };
}

/** Car-specific routing options when no trailer is attached. */
export function vehicleRouting(): Record<string, number> | undefined {
  const v = activeVehicle();
  return v ? autoCosting(v) : undefined;
}

export interface Stop extends Place { key: string }
export interface ActiveRoute {
  route: Route; stops: Stop[]; sessionId: number; options: RouteOptions;
  /** trailer profile at the time of starting (null = no trailer) */
  tow: TowProfile | null;
  /** linked gig, for Share ETA and the trip log */
  gigId?: string;
}

interface PlanState {
  stops: Stop[];
  options: RouteOptions;
  routes: Route[];
  selected: number;
  loading: boolean;
  error: string | null;
  /** gig being planned via the Gigs tab, handed to the drive session */
  planningGigId?: string;
  /** Route handed over to Drive mode. sessionId stays the same across reroutes. */
  active: ActiveRoute | null;
  /** Replace the active route (reroute) without starting a new session. */
  setActiveRoute: (route: Route, stops: Stop[]) => void;

  addStop: (p: Place, at?: number) => void;
  removeStop: (key: string) => void;
  replaceStop: (key: string, p: Place) => void;
  moveStop: (from: number, to: number) => void;
  reverseStops: () => void;
  clearStops: () => void;
  setOption: <K extends keyof RouteOptions>(k: K, v: RouteOptions[K]) => void;
  select: (i: number) => void;
  compute: () => Promise<void>;
  startDrive: (gigId?: string) => void;
  endDrive: () => void;
}

let seq = 0;
const newKey = () => `s${Date.now().toString(36)}${(seq++).toString(36)}`;
let inflight: AbortController | null = null;

export const usePlan = create<PlanState>()(
  persist(
    (set, get) => ({
      stops: [],
      options: DEFAULT_OPTIONS,
      routes: [],
      selected: 0,
      loading: false,
      error: null,
      active: null,

      addStop: (p, at) => {
        const stops = [...get().stops];
        stops.splice(at ?? stops.length, 0, { ...p, key: newKey() });
        set({ stops });
        void get().compute();
      },
      removeStop: (key) => { set({ stops: get().stops.filter((s) => s.key !== key) }); void get().compute(); },
      replaceStop: (key, p) => {
        set({ stops: get().stops.map((s) => (s.key === key ? { ...p, key } : s)) });
        void get().compute();
      },
      moveStop: (from, to) => {
        const stops = [...get().stops];
        if (from === to || to < 0 || to >= stops.length) return;
        const [s] = stops.splice(from, 1);
        stops.splice(to, 0, s);
        set({ stops });
        void get().compute();
      },
      reverseStops: () => { set({ stops: [...get().stops].reverse() }); void get().compute(); },
      clearStops: () => { inflight?.abort(); set({ stops: [], routes: [], selected: 0, error: null, loading: false, planningGigId: undefined }); },
      setOption: (k, v) => { set({ options: { ...get().options, [k]: v } }); void get().compute(); },
      select: (i) => set({ selected: i }),

      compute: async () => {
        const { stops, options } = get();
        inflight?.abort();
        if (stops.length < 2) { set({ routes: [], selected: 0, error: null, loading: false }); return; }
        const ctrl = new AbortController();
        inflight = ctrl;
        set({ loading: true, error: null });
        try {
          const routes = await getRoutes(
            { stops, options, alternates: 2, language: useApp.getState().lang, tow: towRouting(currentTow()), vehicle: vehicleRouting() },
            ctrl.signal,
          );
          if (ctrl.signal.aborted) return;
          set({ routes: routes.slice(0, 3), selected: 0, loading: false });
        } catch (e) {
          if ((e as Error).name === "AbortError") return;
          set({ routes: [], loading: false, error: (e as Error).message });
        }
      },

      startDrive: (gigId) => {
        unlockAudio(); // this runs inside the tap: lets iOS play voice audio later
        const { routes, selected, stops } = get();
        const route = routes[selected];
        if (!route) return;
        set({ active: { route, stops, sessionId: Date.now(), options: get().options, tow: currentTow(), gigId: gigId ?? get().planningGigId } });
        useApp.getState().setMode("drive");
      },
      endDrive: () => set({ active: null }),
      setActiveRoute: (route, stops) => {
        const a = get().active;
        if (a) set({ active: { ...a, route, stops } });
      },
    }),
    {
      name: "fq-plan", storage: lazyStorage,
      // routes are cached separately; recompute on load
      partialize: ({ stops, options, active, planningGigId }) => ({ stops, options, active, planningGigId }),
      onRehydrateStorage: () => (s) => { if (s && s.stops.length >= 2) void s.compute(); },
    },
  ),
);

// Re-route when the car/trailer selection or their specs change (debounced: typing in specs).
let vehTimer: ReturnType<typeof setTimeout> | null = null;
useVehicles.subscribe((s, prev) => {
  const car = (st: typeof s) => st.vehicles.find((v) => v.id === st.activeVehicleId);
  const trl = (st: typeof s) => st.trailers.find((t) => t.id === st.activeTrailerId);
  if (car(s) === car(prev) && trl(s) === trl(prev) && s.towCaps === prev.towCaps) return;
  if (vehTimer) clearTimeout(vehTimer);
  vehTimer = setTimeout(() => { if (usePlan.getState().stops.length >= 2) void usePlan.getState().compute(); }, 800);
});
