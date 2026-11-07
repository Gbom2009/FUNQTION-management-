import { create } from "zustand";
import { persist } from "zustand/middleware";
import { lazyStorage } from "../../store/storage";
import {
  DEFAULT_TRAILERS, DEFAULT_VEHICLES, NL_TOW_DEFAULTS, combinedDims,
  type Trailer, type TowCaps, type Vehicle, type TruckDims, type Licence,
} from "./profiles";

interface VehicleState {
  vehicles: Vehicle[];
  trailers: Trailer[];
  activeVehicleId: string;
  /** null = no trailer attached */
  activeTrailerId: string | null;
  towCaps: TowCaps;
  licence: Licence;
  setLicence: (l: Licence) => void;

  updateVehicle: (id: string, p: Partial<Vehicle>) => void;
  updateTrailer: (id: string, p: Partial<Trailer>) => void;
  addVehicle: () => void;
  addTrailer: () => void;
  removeVehicle: (id: string) => void;
  removeTrailer: (id: string) => void;
  setActiveVehicle: (id: string) => void;
  setActiveTrailer: (id: string | null) => void;
  setTowCaps: (c: Partial<TowCaps>) => void;
}

const uid = (p: string) => `${p}-${Date.now().toString(36)}`;

export const useVehicles = create<VehicleState>()(
  persist(
    (set, get) => ({
      vehicles: DEFAULT_VEHICLES,
      trailers: DEFAULT_TRAILERS,
      activeVehicleId: DEFAULT_VEHICLES[0].id,
      activeTrailerId: null,
      towCaps: NL_TOW_DEFAULTS,
      licence: "B",
      setLicence: (licence) => set({ licence }),

      updateVehicle: (id, p) => set({ vehicles: get().vehicles.map((v) => (v.id === id ? { ...v, ...p } : v)) }),
      updateTrailer: (id, p) => set({ trailers: get().trailers.map((t) => (t.id === id ? { ...t, ...p } : t)) }),
      addVehicle: () => set({ vehicles: [...get().vehicles, { id: uid("v"), name: "Nieuwe auto" }] }),
      addTrailer: () => set({ trailers: [...get().trailers, { id: uid("t"), name: "Nieuwe aanhanger" }] }),
      removeVehicle: (id) => {
        const vehicles = get().vehicles.filter((v) => v.id !== id);
        if (!vehicles.length) return;
        set({ vehicles, activeVehicleId: get().activeVehicleId === id ? vehicles[0].id : get().activeVehicleId });
      },
      removeTrailer: (id) => set({
        trailers: get().trailers.filter((t) => t.id !== id),
        activeTrailerId: get().activeTrailerId === id ? null : get().activeTrailerId,
      }),
      setActiveVehicle: (activeVehicleId) => set({ activeVehicleId }),
      setActiveTrailer: (activeTrailerId) => set({ activeTrailerId }),
      setTowCaps: (c) => set({ towCaps: { ...get().towCaps, ...c } }),
    }),
    {
      name: "fq-vehicles", storage: lazyStorage,
      version: 2,
      migrate: (state) => {
        const st = state as VehicleState;
        st.vehicles = st.vehicles.map((v) => ({ ...(DEFAULT_VEHICLES.find((d) => d.id === v.id) ?? {}), ...v }));
        st.trailers = st.trailers.map((t) => ({ ...(DEFAULT_TRAILERS.find((d) => d.id === t.id) ?? {}), ...t }));
        st.licence ??= "B";
        return st;
      },
    },
  ),
);

/** The routing profile implied by the current selection. */
export interface TowProfile {
  vehicle: Vehicle;
  trailer: Trailer;
  dims: TruckDims;
  caps: TowCaps;
}

export function currentTow(): TowProfile | null {
  const s = useVehicles.getState();
  const vehicle = s.vehicles.find((v) => v.id === s.activeVehicleId) ?? s.vehicles[0];
  const trailer = s.trailers.find((t) => t.id === s.activeTrailerId);
  if (!vehicle || !trailer) return null;
  return { vehicle, trailer, dims: combinedDims(vehicle, trailer), caps: s.towCaps };
}

export function activeVehicle(): Vehicle | undefined {
  const s = useVehicles.getState();
  return s.vehicles.find((v) => v.id === s.activeVehicleId);
}
