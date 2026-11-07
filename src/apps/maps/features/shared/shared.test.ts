import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useTestDatabase } from "../../../../core/db";
import { save, setActor } from "../../../../core/repo";
import { ensureSeed } from "../../../../core/seed";
import { runTaskSync } from "../../../bookings/domain/taskSync";
import { blankGig, createGig } from "../../../bookings/data";
import type { Trip as SuiteTrip, Venue as SuiteVenue, VehicleRecord } from "../../../../core/types";
import { trailerWeights } from "../../../gear/domain/gear";
import { gigChanges, toMapsGig, toMapsTrip, toMapsVehicles, toMapsVenue, vehicleRecord, venueChanges } from "./mapping";
import { flushWrites } from "./writer";
import { startSharedSync } from "./sync";
import { useGigs } from "../gigs/store";
import { recordTrip, useTrips } from "../stats/tripLog";
import { useVehicles } from "../vehicles/store";

const base = { createdAt: "2026-01-01T00:00:00Z", createdBy: "gijs" as const, updatedAt: "2026-01-01T00:00:00Z", updatedBy: "gijs" as const };

describe("mapping (pure)", () => {
  it("suite venue ↔ Maps venue: address, load-in door, trailer parking", () => {
    const v: SuiteVenue = { ...base, id: "v1", name: "De Zwaan", street: "Dorpsstraat 1", postcode: "5735 AA", city: "Aarle-Rixtel", lat: 51.5, lng: 5.6, loadingEntrance: { lat: 51.501, lng: 5.601 } };
    const m = toMapsVenue(v, ["blob:x"]);
    expect(m.address).toMatchObject({ name: "Dorpsstraat 1", detail: "5735 AA Aarle-Rixtel", lat: 51.5, lon: 5.6 });
    expect(m.loadInDoor).toEqual({ lat: 51.501, lon: 5.601 });
    expect(m.photos).toEqual(["blob:x"]);
    // Picking a parking pin and clearing the door
    expect(venueChanges({ trailerParking: { lat: 1, lon: 2 }, loadInDoor: undefined })).toEqual({ trailerParking: { lat: 1, lng: 2 }, loadingEntrance: undefined });
    // A new address only fills the written address when Bookings has none
    const a = { id: "p", name: "Kerkstraat 3", detail: "Helmond", lat: 51.4, lon: 5.65, source: "pdok" as const };
    expect(venueChanges({ address: a }, { street: "Dorpsstraat 1", city: "Aarle-Rixtel" })).toEqual({ lat: 51.4, lng: 5.65 });
    expect(venueChanges({ address: a }, {})).toMatchObject({ street: "Kerkstraat 3", city: "Helmond" });
  });

  it("gig: load-in from set-up time, buffers in the gig day, route → travel minutes", () => {
    const g = toMapsGig({ ...blankGig("gijs"), id: "g1", title: "Kermis", date: "2026-11-20", setupTime: "17:30" } as never);
    expect(g).toMatchObject({ loadIn: "17:30", setupBufferMin: 60, trafficMarginPct: 15 });
    const c = gigChanges({ loadIn: "17:00", trafficMarginPct: 20, route: { seconds: 1810, meters: 30000, fromName: "Thuis", towing: true, computedAt: 1 } });
    expect(c.gig).toEqual({ setupTime: "17:00" });
    expect(c.day).toMatchObject({ trafficMarginPct: 20, travelMinutes: 31 });
  });

  it("trips: App 3 km doubles for round trips; nav trips keep their times", () => {
    const t: SuiteTrip = { ...base, id: "t1", date: "2026-05-01", driver: "gijs", from: "", to: "Venue", purpose: "", km: 20, roundTrip: true, source: "venue" };
    expect(toMapsTrip(t)).toMatchObject({ km: 40, destination: "Venue", arrived: true });
    const nav = toMapsTrip({ ...t, km: 31.4, roundTrip: false, source: "nav", startedAt: "2026-05-01T16:00:00.000Z", endedAt: "2026-05-01T16:40:00.000Z" });
    expect(nav.endedAt - nav.startedAt).toBe(40 * 60_000);
  });

  it("vehicles round-trip and the gear trailer feeds Gear's payload", () => {
    const rec = vehicleRecord("trailer", { id: "dj-gear", name: "DJ gear trailer", maxMassKg: 750, emptyKg: 210 });
    const { trailers } = toMapsVehicles([{ ...base, ...rec }] as VehicleRecord[]);
    expect(trailers[0]).toMatchObject({ id: "dj-gear", maxMassKg: 750, emptyKg: 210 });
    expect(trailerWeights({ gearTrailerMaxKg: 750 }, rec)).toEqual({ gearTrailerMaxKg: 750, gearTrailerEmptyKg: 210, fromMaps: true });
    expect(trailerWeights({ gearTrailerMaxKg: 750, gearTrailerEmptyKg: 180 }, undefined)).toMatchObject({ gearTrailerEmptyKg: 180, fromMaps: false });
  });
});

let n = 0;
let stop: (() => void) | undefined;
beforeEach(async () => { useTestDatabase("maps-" + n++); setActor("coen"); await ensureSeed(); });
afterEach(async () => { stop?.(); stop = undefined; await flushWrites(); await runTaskSync(); });
const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

describe("Maps on the shared database", () => {
  it("shows suite gigs and venues, writes pins, load-in, buffers and real trips back", async () => {
    const { db } = await import("../../../../core/db");
    const venue = await save<SuiteVenue>("venues", { name: "Zaal Kanters", city: "Lieshout", lat: 51.52, lng: 5.6 });
    const gig = await createGig({ ...blankGig("gijs"), title: "Bruiloft", date: "2026-12-12", setupTime: "16:00", venueId: venue.id, stage: "confirmed" });
    stop = startSharedSync();
    await tick();
    expect(useGigs.getState().venues.find((v) => v.id === venue.id)?.address?.detail).toBe("Lieshout");
    expect(useGigs.getState().gigs.find((g) => g.id === gig.id)).toMatchObject({ title: "Bruiloft", loadIn: "16:00" });

    // Pin-picking the load-in door on the map
    useGigs.getState().startPicking(venue.id, "loadInDoor");
    useGigs.getState().finishPicking({ lat: 51.521, lon: 5.601 });
    useGigs.getState().updateGig(gig.id, { loadIn: "15:30", setupBufferMin: 75 });
    await flushWrites();
    expect((await db.venues.get(venue.id))?.loadingEntrance).toEqual({ lat: 51.521, lng: 5.601 });
    expect((await db.gigs.get(gig.id))?.setupTime).toBe("15:30");
    expect(await db.gigDays.where("gigId").equals(gig.id).first()).toMatchObject({ setupBufferMin: 75 });
    expect((await db.audit.where("rowId").equals(venue.id).toArray()).some((a) => a.actor === "coen" && "loadingEntrance" in a.changes)).toBe(true);

    // A real drive becomes an App 3 trip (nav), a simulated one stays on the device.
    recordTrip({ startedAt: Date.parse("2026-12-12T14:30:00"), endedAt: Date.parse("2026-12-12T15:10:00"), km: 24.6, vehicle: "Range Rover Sport P440e", vehicleId: "rr-p440e", trailer: "DJ gear trailer", trailerId: "dj-gear", gigId: gig.id, gigTitle: "Bruiloft", destination: "Zaal Kanters", arrived: true });
    recordTrip({ startedAt: Date.parse("2026-12-11T10:00:00"), endedAt: Date.parse("2026-12-11T10:20:00"), km: 12, arrived: true, simulated: true });
    await tick();
    const trips = (await db.trips.toArray()).filter((t) => !t.deletedAt);
    expect(trips).toHaveLength(1);
    expect(trips[0]).toMatchObject({ source: "nav", driver: "coen", km: 24.6, roundTrip: false, gigId: gig.id, date: "2026-12-12", trailerId: "dj-gear", purpose: "Bruiloft" });
    expect(useTrips.getState().trips.map((t) => t.km).sort()).toEqual([12, 24.6]);
  });

  it("seeds the shared cars and trailers once, with Gear's trailer weight", async () => {
    const { db } = await import("../../../../core/db");
    stop = startSharedSync();
    await tick(100);
    const rows = await db.vehicles.toArray();
    expect(rows.filter((r) => r.kind === "car").length).toBeGreaterThan(0);
    expect(rows.find((r) => r.id === "dj-gear")?.spec.maxMassKg).toBe(750);
    useVehicles.getState().updateTrailer("dj-gear", { emptyKg: 220 });
    await flushWrites();
    expect((await db.vehicles.get("dj-gear"))?.spec.emptyKg).toBe(220);
  });
});
