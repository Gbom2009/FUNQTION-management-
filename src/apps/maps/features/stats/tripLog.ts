import { create } from "zustand";
import { persist } from "zustand/middleware";
import { lazyStorage } from "../../store/storage";
import { save, softDelete, getActor } from "../../../../core/repo";
import type { Trip as SuiteTrip } from "../../../../core/types";
import { suiteTripFrom } from "../shared/mapping";

/** One driven trip, as Setlist and the story export read it. */
export interface Trip {
  id: string;
  startedAt: number;
  endedAt: number;
  km: number;
  vehicle?: string;
  trailer?: string;
  gigId?: string;
  destination?: string;
  arrived: boolean;
  /** driven with the simulator — kept on this device only, never in mileage */
  simulated?: boolean;
}

interface TripState {
  /** App 3 trips (shared, filled by features/shared/sync.ts) + this device's simulated drives. */
  trips: Trip[];
  /** simulated drives (device only) */
  simTrips: Trip[];
  remove: (id: string) => void;
}

export const useTrips = create<TripState>()(
  persist(
    (set, get) => ({
      trips: [],
      simTrips: [],
      remove: (id) => {
        const sim = get().simTrips.some((t) => t.id === id);
        set({ trips: get().trips.filter((t) => t.id !== id), simTrips: get().simTrips.filter((t) => t.id !== id) });
        if (!sim) void softDelete("trips", id);
        void import("./tracks").then((m) => m.deleteTrack(id));
      },
    }),
    { name: "fq-maps-sim-trips", storage: lazyStorage, partialize: ({ simTrips }) => ({ simTrips }) },
  ),
);

/** Merge shared trips with this device's simulated ones (newest first). */
export function setSharedTrips(shared: Trip[]) {
  const sim = useTrips.getState().simTrips;
  useTrips.setState({ trips: [...shared, ...sim].sort((a, b) => b.startedAt - a.startedAt) });
}

/**
 * Store a finished drive. Real drives become App 3 trips (source "nav", for
 * mileage); simulated ones stay on this device.
 */
export function recordTrip(t: Omit<Trip, "id"> & { vehicleId?: string; trailerId?: string; gigTitle?: string }): string {
  const id = `trip-${t.startedAt.toString(36)}`;
  if (t.simulated) {
    const trip: Trip = { id, startedAt: t.startedAt, endedAt: t.endedAt, km: t.km, vehicle: t.vehicle, trailer: t.trailer, gigId: t.gigId, destination: t.destination, arrived: t.arrived, simulated: true };
    useTrips.setState((s) => ({ simTrips: [trip, ...s.simTrips].slice(0, 500), trips: [trip, ...s.trips] }));
    return id;
  }
  const actor = getActor();
  const driver = actor === "system" ? "gijs" : actor;
  void save<SuiteTrip>("trips", suiteTripFrom(t, { id, driver, gigTitle: t.gigTitle }));
  useTrips.setState((s) => ({ trips: [{ ...t, id, simulated: false }, ...s.trips] }));
  return id;
}
