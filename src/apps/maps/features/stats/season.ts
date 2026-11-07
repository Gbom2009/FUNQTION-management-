import type { Trip } from "./tripLog";
import type { Gig, Venue } from "../gigs/store";
import { haversine } from "../../nav/geo";

export interface SeasonStats {
  year: number;
  trips: number;
  km: number;
  hours: number;
  gigs: number;
  towKm: number;
  furthest?: { name: string; km: number };
}

/** Season (calendar year) totals. Furthest gig = venue furthest (straight line) from home. */
export function seasonStats(trips: Trip[], gigs: Gig[], venues: Venue[], year: number, home: [number, number]): SeasonStats {
  const inYear = trips.filter((t) => new Date(t.startedAt).getFullYear() === year);
  const gigIds = new Set(inYear.map((t) => t.gigId).filter(Boolean) as string[]);
  // gigs in this year also count if they happened without a logged trip
  for (const g of gigs) if (g.date.startsWith(String(year))) gigIds.add(g.id);

  let furthest: SeasonStats["furthest"];
  for (const id of gigIds) {
    const g = gigs.find((x) => x.id === id);
    const v = venues.find((x) => x.id === g?.venueId);
    const p = v?.loadInDoor ?? v?.address;
    if (!p) continue;
    const km = haversine(home, [p.lon, p.lat]) / 1000;
    if (!furthest || km > furthest.km) furthest = { name: v!.name, km: Math.round(km) };
  }
  const sum = (f: (t: Trip) => number) => inYear.reduce((a, t) => a + f(t), 0);
  return {
    year,
    trips: inYear.length,
    km: Math.round(sum((t) => t.km)),
    hours: Math.round(sum((t) => (t.endedAt - t.startedAt) / 3.6e6) * 10) / 10,
    gigs: gigIds.size,
    towKm: Math.round(sum((t) => (t.trailer ? t.km : 0))),
    furthest,
  };
}

export function seasonYears(trips: Trip[], gigs: Gig[], now = new Date()): number[] {
  const ys = new Set<number>([now.getFullYear()]);
  trips.forEach((t) => ys.add(new Date(t.startedAt).getFullYear()));
  gigs.forEach((g) => { const y = Number(g.date.slice(0, 4)); if (y) ys.add(y); });
  return [...ys].sort((a, b) => b - a);
}
