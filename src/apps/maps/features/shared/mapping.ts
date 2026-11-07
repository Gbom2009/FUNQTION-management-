import type {
  Gig as SuiteGig, GigDay, Trip as SuiteTrip, Venue as SuiteVenue, VehicleRecord, MemberId,
} from "../../../../core/types";
import type { Gig, Venue } from "../gigs/store";
import type { Trip } from "../stats/tripLog";
import type { Trailer, Vehicle } from "../vehicles/profiles";

/**
 * Pure conversions between the suite's records (one shared database for all
 * apps) and the shapes Maps' UI was written for. Kept pure so they're tested.
 */

const pin = (p?: { lat: number; lng: number }) => (p ? { lat: p.lat, lon: p.lng } : undefined);
const geo = (p?: { lat: number; lon: number }) => (p ? { lat: p.lat, lng: p.lon } : undefined);

export function toMapsVenue(v: SuiteVenue, photos: string[] = []): Venue {
  const detail = [v.postcode, v.city].filter(Boolean).join(" ") || undefined;
  return {
    id: v.id,
    name: v.name,
    address: v.lat != null && v.lng != null
      ? { id: `addr-${v.id}`, name: v.street || v.name, detail, lat: v.lat, lon: v.lng, source: "pin" }
      : undefined,
    loadInDoor: pin(v.loadingEntrance),
    trailerParking: pin(v.trailerParking),
    contactName: v.contactName,
    contactPhone: v.contactPhone,
    notes: v.notes,
    photos,
  };
}

/** Maps edit → suite venue fields. `photos` is handled separately (venuePhotos table). */
export function venueChanges(p: Partial<Venue>, cur?: Pick<SuiteVenue, "street" | "city">): Partial<SuiteVenue> {
  const out: Partial<SuiteVenue> = {};
  if ("name" in p && p.name !== undefined) out.name = p.name;
  if ("address" in p) {
    const a = p.address;
    out.lat = a?.lat;
    out.lng = a?.lon;
    // Only fill the written address when the venue has none yet (Bookings owns it).
    if (a && !cur?.street) out.street = a.name;
    if (a && !cur?.city && a.detail) out.city = a.detail;
  }
  if ("loadInDoor" in p) out.loadingEntrance = geo(p.loadInDoor);
  if ("trailerParking" in p) out.trailerParking = geo(p.trailerParking);
  if ("contactName" in p) out.contactName = p.contactName || undefined;
  if ("contactPhone" in p) out.contactPhone = p.contactPhone || undefined;
  if ("notes" in p) out.notes = p.notes || undefined;
  return out;
}

export const DEFAULT_SETUP_BUFFER = 60;
export const DEFAULT_TRAFFIC_MARGIN = 15;
export const gigDayId = (gigId: string) => `gd-${gigId}`;

/** Gigs Maps shows: alive and not lost/cancelled. */
export const navGig = (g: SuiteGig) => !g.deletedAt && g.stage !== "lost" && g.stage !== "cancelled";

export function toMapsGig(g: SuiteGig, day?: GigDay): Gig {
  return {
    id: g.id,
    title: g.title,
    venueId: g.venueId,
    date: g.date,
    loadIn: g.setupTime || g.startTime || "18:00",
    setupBufferMin: day?.setupBufferMin ?? DEFAULT_SETUP_BUFFER,
    trafficMarginPct: day?.trafficMarginPct ?? DEFAULT_TRAFFIC_MARGIN,
    notes: g.notesInternal,
    route: day?.route,
  };
}

/** Maps gig edit → changes for the suite gig and its gig day. */
export function gigChanges(p: Partial<Gig>): { gig: Partial<SuiteGig>; day: Partial<GigDay> } {
  const gig: Partial<SuiteGig> = {};
  const day: Partial<GigDay> = {};
  if (p.loadIn !== undefined) gig.setupTime = p.loadIn;
  if (p.setupBufferMin !== undefined) day.setupBufferMin = p.setupBufferMin;
  if (p.trafficMarginPct !== undefined) day.trafficMarginPct = p.trafficMarginPct;
  if ("route" in p) {
    day.route = p.route;
    day.travelMinutes = p.route ? Math.ceil(p.route.seconds / 60) : undefined;
  }
  return { gig, day };
}

const tripKm = (t: SuiteTrip) => t.km * (t.roundTrip ? 2 : 1);

/** Every suite trip (App 3) as a Maps trip, for Setlist stats and the story export. */
export function toMapsTrip(t: SuiteTrip): Trip {
  const start = t.startedAt ? Date.parse(t.startedAt) : Date.parse(`${t.date}T12:00:00`);
  return {
    id: t.id,
    startedAt: start,
    endedAt: t.endedAt ? Date.parse(t.endedAt) : start,
    km: tripKm(t),
    vehicle: t.vehicleName,
    trailer: t.trailerName,
    gigId: t.gigId,
    destination: t.to || undefined,
    arrived: t.arrived ?? true,
  };
}

const localDate = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** A real (not simulated) Maps drive → an App 3 trip. */
export function suiteTripFrom(
  t: Omit<Trip, "id" | "simulated"> & { vehicleId?: string; trailerId?: string },
  extra: { id: string; driver: MemberId; gigTitle?: string; from?: string },
): Omit<SuiteTrip, "createdAt" | "createdBy" | "updatedAt" | "updatedBy"> {
  return {
    id: extra.id,
    date: localDate(t.startedAt),
    gigId: t.gigId,
    driver: extra.driver,
    from: extra.from ?? "",
    to: t.destination ?? "",
    purpose: extra.gigTitle ?? "Rit (Navigatie)",
    km: t.km,
    roundTrip: false,
    source: "nav",
    startedAt: new Date(t.startedAt).toISOString(),
    endedAt: new Date(t.endedAt).toISOString(),
    vehicleId: t.vehicleId,
    trailerId: t.trailerId,
    vehicleName: t.vehicle,
    trailerName: t.trailer,
    arrived: t.arrived,
  };
}

export function toMapsVehicles(rows: VehicleRecord[]): { vehicles: Vehicle[]; trailers: Trailer[] } {
  const alive = rows.filter((r) => !r.deletedAt).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.name.localeCompare(b.name));
  return {
    vehicles: alive.filter((r) => r.kind === "car").map((r) => ({ ...(r.spec as object), id: r.id, name: r.name }) as Vehicle),
    trailers: alive.filter((r) => r.kind === "trailer").map((r) => ({ ...(r.spec as object), id: r.id, name: r.name }) as Trailer),
  };
}

export function vehicleRecord(kind: "car" | "trailer", v: Vehicle | Trailer): Pick<VehicleRecord, "id" | "kind" | "name" | "spec"> {
  const { id, name, ...spec } = v;
  // Drop undefined so the audit diff stays clean.
  return { id, kind, name, spec: JSON.parse(JSON.stringify(spec)) as Record<string, unknown> };
}
