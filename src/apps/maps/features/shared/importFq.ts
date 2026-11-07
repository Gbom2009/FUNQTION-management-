import { db } from "../../../../core/db";
import { getActor, save } from "../../../../core/repo";
import type { Gig as SuiteGig, GigDay, Trip as SuiteTrip, Venue as SuiteVenue, VehicleRecord, VenuePhoto } from "../../../../core/types";
import type { Gig, Venue } from "../gigs/store";
import type { Trip } from "../stats/tripLog";
import { useTrips } from "../stats/tripLog";
import type { Trailer, Vehicle } from "../vehicles/profiles";
import { haversine } from "../../nav/geo";
import { gigChanges, gigDayId, suiteTripFrom, vehicleRecord, venueChanges } from "./mapping";

/**
 * One-time import of the data the stand-alone FQ-maps app kept on a device
 * (its localStorage keys fq-gigs, fq-trips, fq-vehicles). The user confirms
 * every venue and gig match before anything is written.
 */

export interface FqExport {
  venues: Venue[];
  gigs: Gig[];
  trips: Trip[];
  vehicles: Vehicle[];
  trailers: Trailer[];
}

/** Paste/file content: `{ "fq-gigs": "<json>", ... }` (values may also be objects). */
export function parseFqExport(text: string): FqExport {
  const raw = JSON.parse(text) as Record<string, unknown>;
  const state = (k: string): Record<string, unknown> => {
    let v = raw[k];
    if (typeof v === "string") v = JSON.parse(v);
    const o = (v ?? {}) as { state?: Record<string, unknown> };
    return o.state ?? (o as Record<string, unknown>);
  };
  const gigs = state("fq-gigs"), trips = state("fq-trips"), veh = state("fq-vehicles");
  const arr = <T>(v: unknown) => (Array.isArray(v) ? (v as T[]) : []);
  const out: FqExport = {
    venues: arr<Venue>(gigs.venues).map((v) => ({ ...v, photos: arr<string>(v.photos) })),
    gigs: arr<Gig>(gigs.gigs),
    trips: arr<Trip>(trips.trips),
    vehicles: arr<Vehicle>(veh.vehicles),
    trailers: arr<Trailer>(veh.trailers),
  };
  if (!out.venues.length && !out.gigs.length && !out.trips.length && !out.vehicles.length) throw new Error("no_fq_data");
  return out;
}

const norm = (s?: string) => (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** Suggested suite venue for an FQ-maps venue: same name, or within 150 m. "" = create a new venue. */
export function suggestVenue(v: Venue, suite: SuiteVenue[]): string {
  const alive = suite.filter((s) => !s.deletedAt);
  const byName = alive.find((s) => norm(s.name) === norm(v.name));
  if (byName) return byName.id;
  const p = v.loadInDoor ?? v.address;
  if (p) {
    const near = alive
      .filter((s) => s.lat != null && s.lng != null)
      .map((s) => ({ s, m: haversine([p.lon, p.lat], [s.lng!, s.lat!]) }))
      .sort((a, b) => a.m - b.m)[0];
    if (near && near.m < 150) return near.s.id;
  }
  return "";
}

/** Suggested suite gig: same date and (matched) venue, else same date and similar title. "" = skip. */
export function suggestGig(g: Gig, suite: SuiteGig[], venueMatch: Record<string, string>): string {
  const sameDay = suite.filter((s) => !s.deletedAt && s.date === g.date);
  const venue = g.venueId ? venueMatch[g.venueId] : undefined;
  return (venue && sameDay.find((s) => s.venueId === venue)?.id)
    || sameDay.find((s) => norm(s.title).includes(norm(g.title)) || norm(g.title).includes(norm(s.title)))?.id
    || (sameDay.length === 1 ? sameDay[0].id : "");
}

export interface ImportPlan {
  data: FqExport;
  /** FQ-maps venue id → suite venue id, "" = create new, "skip" = leave out */
  venues: Record<string, string>;
  /** FQ-maps gig id → suite gig id, "" = skip */
  gigs: Record<string, string>;
}

export interface ImportResult { venuesNew: number; venuesUpdated: number; gigs: number; trips: number; tripsSkipped: number; simulated: number; vehicles: number }

const dataUrlToBlob = async (d: string) => (await fetch(d)).blob();

/** Write a confirmed plan to the shared database. Safe to run twice (trips de-duplicate, vehicles upsert). */
export async function applyFqImport(plan: ImportPlan): Promise<ImportResult> {
  const res: ImportResult = { venuesNew: 0, venuesUpdated: 0, gigs: 0, trips: 0, tripsSkipped: 0, simulated: 0, vehicles: 0 };
  const venueId: Record<string, string> = {};

  for (const v of plan.data.venues) {
    const target = plan.venues[v.id] ?? "";
    if (target === "skip") continue;
    const cur = target ? await db.venues.get(target) : undefined;
    const fields = venueChanges({ ...v }, cur);
    // Don't overwrite what Bookings already has; fill the gaps.
    const fill: Partial<SuiteVenue> = {};
    for (const [k, val] of Object.entries(fields) as [keyof SuiteVenue, unknown][]) {
      if (val !== undefined && (cur?.[k] === undefined || cur?.[k] === "")) (fill as Record<string, unknown>)[k] = val;
    }
    const saved = cur
      ? await save<SuiteVenue>("venues", { ...cur, ...fill })
      : await save<SuiteVenue>("venues", { ...fill, name: v.name || "Venue" } as SuiteVenue);
    venueId[v.id] = saved.id;
    if (cur) res.venuesUpdated++; else res.venuesNew++;
    const hasPhotos = (await db.venuePhotos.where("venueId").equals(saved.id).count()) > 0;
    if (!hasPhotos) for (const d of v.photos.filter((p) => p.startsWith("data:"))) {
      const blob = await dataUrlToBlob(d);
      await save<VenuePhoto>("venuePhotos", { venueId: saved.id, blob, mime: blob.type || "image/jpeg" });
    }
  }

  const gigId: Record<string, string> = {};
  for (const g of plan.data.gigs) {
    const target = plan.gigs[g.id];
    if (!target) continue;
    gigId[g.id] = target;
    const suite = await db.gigs.get(target);
    if (!suite) continue;
    const { day } = gigChanges({ setupBufferMin: g.setupBufferMin, trafficMarginPct: g.trafficMarginPct, route: g.route });
    const cur = await db.gigDays.where("gigId").equals(target).first();
    await save<GigDay>("gigDays", { ...(cur ?? { id: gigDayId(target), gigId: target }), ...day, ...(cur?.route ? { route: cur.route, travelMinutes: cur.travelMinutes } : {}) } as GigDay);
    if (!suite.setupTime && g.loadIn) await save<SuiteGig>("gigs", { ...suite, setupTime: g.loadIn });
    res.gigs++;
  }

  const existing = await db.trips.toArray();
  const seen = new Set(existing.map((t) => t.id));
  const seenStart = new Set(existing.filter((t) => t.startedAt).map((t) => Date.parse(t.startedAt!)));
  const actor = getActor();
  const driver = actor === "system" ? "gijs" : actor;
  const sim: Trip[] = [];
  for (const t of plan.data.trips) {
    if (t.simulated) { sim.push(t); continue; }
    if (seen.has(t.id) || seenStart.has(t.startedAt)) { res.tripsSkipped++; continue; }
    const gig = t.gigId ? gigId[t.gigId] : undefined;
    const title = gig ? (await db.gigs.get(gig))?.title : undefined;
    await save<SuiteTrip>("trips", suiteTripFrom({ ...t, gigId: gig }, { id: t.id, driver, gigTitle: title }));
    res.trips++;
  }
  if (sim.length) {
    const have = new Set(useTrips.getState().simTrips.map((t) => t.id));
    const add = sim.filter((t) => !have.has(t.id));
    useTrips.setState((s) => ({ simTrips: [...add, ...s.simTrips].slice(0, 500) }));
    res.simulated = add.length;
  }

  for (const v of plan.data.vehicles) { await save<VehicleRecord>("vehicles", vehicleRecord("car", v)); res.vehicles++; }
  for (const t of plan.data.trailers) { await save<VehicleRecord>("vehicles", vehicleRecord("trailer", t)); res.vehicles++; }
  return res;
}

/** What to run in the old FQ-maps (DevTools console) to copy its data. */
export const FQ_EXPORT_SNIPPET =
  `copy(JSON.stringify(Object.fromEntries(["fq-gigs","fq-trips","fq-vehicles"].map(k=>[k,localStorage.getItem(k)]))))`;
