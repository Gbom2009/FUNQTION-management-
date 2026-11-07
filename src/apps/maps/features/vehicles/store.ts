import { create } from "zustand";
import { persist } from "zustand/middleware";
import { lazyStorage } from "../../store/storage";
import {
  DEFAULT_TRAILERS, DEFAULT_VEHICLES, NL_TOW_DEFAULTS, combinedDims,
  type Trailer, type TowCaps, type Vehicle, type TruckDims, type Licence,
} from "./profiles";
import { softDelete } from "../../../../core/repo";
import { queueWrite } from "../shared/writer";
import { vehicleRecord } from "../shared/mapping";

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

const write = (kind: "car" | "trailer", v: Vehicle | Trailer) => {
  const { id, kind: k, name, spec } = vehicleRecord(kind, v);
  queueWrite("vehicles", id, { kind: k, name, spec }, { kind: k, name, spec });
};

// Cars and trailers are shared (suite table `vehicles`, filled by
// features/shared/sync.ts). Which one is active, tow caps and licence are
// about this device and stay in localStorage.
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

      updateVehicle: (id, p) => {
        set({ vehicles: get().vehicles.map((v) => (v.id === id ? { ...v, ...p } : v)) });
        const v = get().vehicles.find((x) => x.id === id);
        if (v) write("car", v);
      },
      updateTrailer: (id, p) => {
        set({ trailers: get().trailers.map((t) => (t.id === id ? { ...t, ...p } : t)) });
        const t = get().trailers.find((x) => x.id === id);
        if (t) write("trailer", t);
      },
      addVehicle: () => {
        const v: Vehicle = { id: uid("v"), name: "Nieuwe auto" };
        set({ vehicles: [...get().vehicles, v] });
        write("car", v);
      },
      addTrailer: () => {
        const t: Trailer = { id: uid("t"), name: "Nieuwe aanhanger" };
        set({ trailers: [...get().trailers, t] });
        write("trailer", t);
      },
      removeVehicle: (id) => {
        const vehicles = get().vehicles.filter((v) => v.id !== id);
        if (!vehicles.length) return;
        set({ vehicles, activeVehicleId: get().activeVehicleId === id ? vehicles[0].id : get().activeVehicleId });
        void softDelete("vehicles", id);
      },
      removeTrailer: (id) => {
        set({
          trailers: get().trailers.filter((t) => t.id !== id),
          activeTrailerId: get().activeTrailerId === id ? null : get().activeTrailerId,
        });
        void softDelete("vehicles", id);
      },
      setActiveVehicle: (activeVehicleId) => set({ activeVehicleId }),
      setActiveTrailer: (activeTrailerId) => set({ activeTrailerId }),
      setTowCaps: (c) => set({ towCaps: { ...get().towCaps, ...c } }),
    }),
    {
      name: "fq-maps-vehicle-prefs", storage: lazyStorage,
      partialize: ({ activeVehicleId, activeTrailerId, towCaps, licence }) => ({ activeVehicleId, activeTrailerId, towCaps, licence }),
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
