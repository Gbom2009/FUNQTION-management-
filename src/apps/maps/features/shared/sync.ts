import { liveQuery } from "dexie";
import { db } from "../../../../core/db";
import { save, softDelete } from "../../../../core/repo";
import type { Gig as SuiteGig, GigDay, Settings, Trip as SuiteTrip, Venue as SuiteVenue, VehicleRecord, VenuePhoto } from "../../../../core/types";
import { GEAR_TRAILER_ID } from "../../../../core/types";
import { useGigs } from "../gigs/store";
import { setSharedTrips } from "../stats/tripLog";
import { useVehicles } from "../vehicles/store";
import { DEFAULT_TRAILERS, DEFAULT_VEHICLES } from "../vehicles/profiles";
import { gigDayId, navGig, toMapsGig, toMapsTrip, toMapsVehicles, toMapsVenue, vehicleRecord } from "./mapping";
import { onFlushed, overlay } from "./writer";

/**
 * Keeps Maps' in-memory stores (used synchronously all over the drive code)
 * in step with the shared database. Started when Maps opens, stopped when it
 * closes. Edits go the other way through features/shared/writer.ts.
 */

const rawVenues = new Map<string, SuiteVenue>();
export const suiteVenue = (id: string) => rawVenues.get(id);

// Photo blobs → object URLs (kept while Maps is open).
const photoUrl = new Map<string, string>();   // photo id → url
const photoId = new Map<string, string>();    // url → photo id
function urlFor(p: VenuePhoto) {
  let u = photoUrl.get(p.id);
  if (!u) { u = URL.createObjectURL(p.blob); photoUrl.set(p.id, u); photoId.set(u, p.id); }
  return u;
}

async function dataUrlToBlob(d: string): Promise<Blob> {
  return (await fetch(d)).blob();
}

/** Venue photo list edited in Maps → venuePhotos rows. */
export async function syncPhotos(venueId: string, before: string[], after: string[]) {
  for (const u of before) if (!after.includes(u) && photoId.has(u)) await softDelete("venuePhotos", photoId.get(u)!);
  for (const u of after) {
    if (!u.startsWith("data:")) continue;
    const blob = await dataUrlToBlob(u);
    await save<VenuePhoto>("venuePhotos", { venueId, blob, mime: blob.type || "image/jpeg" });
  }
}

const withOverlay = <T extends { id: string }>(table: "venues" | "gigs" | "gigDays" | "vehicles", rows: T[]): T[] =>
  rows.map((r) => { const o = overlay(table, r.id); return o ? { ...r, ...o } : r; });

const seeded = new Set<string>();
/** First run on a new database: store Maps' default cars and trailers (fixed ids, so two devices agree). */
async function seedVehicles(settings?: Settings) {
  if (seeded.has(db.name)) return;
  seeded.add(db.name);
  if ((await db.vehicles.count()) > 0) return;
  const gear = { maxMassKg: settings?.gearTrailerMaxKg ?? 750, emptyKg: settings?.gearTrailerEmptyKg };
  for (const v of DEFAULT_VEHICLES) await save<VehicleRecord>("vehicles", vehicleRecord("car", v), { actor: "system" });
  for (const t of DEFAULT_TRAILERS) {
    await save<VehicleRecord>("vehicles", vehicleRecord("trailer", t.id === GEAR_TRAILER_ID ? { ...t, ...gear, emptyKg: t.emptyKg ?? gear.emptyKg } : t), { actor: "system" });
  }
}

export function startSharedSync(): () => void {
  const subs: { unsubscribe(): void }[] = [];
  useGigs.setState({ loaded: false });

  const gigsAndVenues = liveQuery(async () => ({
    venues: await db.venues.toArray(),
    photos: await db.venuePhotos.toArray(),
    gigs: await db.gigs.toArray(),
    days: await db.gigDays.toArray(),
  }));
  let lastGV: { venues: SuiteVenue[]; photos: VenuePhoto[]; gigs: SuiteGig[]; days: GigDay[] } | null = null;
  const applyGV = () => {
    if (!lastGV) return;
    const { photos, days } = lastGV;
    const venues = withOverlay("venues", lastGV.venues.filter((v) => !v.deletedAt));
    rawVenues.clear();
    venues.forEach((v) => rawVenues.set(v.id, v));
    const byVenue = new Map<string, string[]>();
    for (const p of photos) if (!p.deletedAt) byVenue.set(p.venueId, [...(byVenue.get(p.venueId) ?? []), urlFor(p)]);
    const dayOf = new Map(withOverlay("gigDays", days).map((d) => [d.gigId, d]));
    const gigs = withOverlay("gigs", lastGV.gigs.filter(navGig));
    useGigs.setState({
      loaded: true,
      venues: venues.map((v) => toMapsVenue(v, byVenue.get(v.id))).sort((a, b) => a.name.localeCompare(b.name)),
      gigs: gigs.map((g) => toMapsGig(g, dayOf.get(g.id) ?? (overlay("gigDays", gigDayId(g.id)) as GigDay | undefined))),
    });
  };
  subs.push(gigsAndVenues.subscribe({ next: (v) => { lastGV = v; applyGV(); }, error: (e) => console.warn("[maps] sync", e) }));

  const trips = liveQuery(() => db.trips.toArray());
  subs.push(trips.subscribe({
    next: (rows: SuiteTrip[]) => setSharedTrips(rows.filter((t) => !t.deletedAt).map(toMapsTrip)),
    error: (e) => console.warn("[maps] sync", e),
  }));

  const vehicles = liveQuery(() => db.vehicles.toArray());
  let lastV: VehicleRecord[] | null = null;
  const applyV = () => {
    if (!lastV) return;
    const { vehicles: cars, trailers } = toMapsVehicles(withOverlay("vehicles", lastV) as VehicleRecord[]);
    if (!cars.length) return; // not seeded yet: keep the defaults
    const s = useVehicles.getState();
    useVehicles.setState({
      vehicles: cars,
      trailers,
      activeVehicleId: cars.some((v) => v.id === s.activeVehicleId) ? s.activeVehicleId : cars[0].id,
      activeTrailerId: s.activeTrailerId && trailers.some((t) => t.id === s.activeTrailerId) ? s.activeTrailerId : null,
    });
  };
  subs.push(vehicles.subscribe({ next: (rows) => { lastV = rows; applyV(); }, error: (e) => console.warn("[maps] sync", e) }));
  void db.settings.get("settings").then(seedVehicles);

  const off = onFlushed(() => { applyGV(); applyV(); });
  return () => { subs.forEach((s) => s.unsubscribe()); off(); useGigs.setState({ loaded: false }); };
}
