import { services } from "../../config/services";
import { createThrottle } from "../../nav/throttle";
import type { Connector } from "./store";

/**
 * Open Charge Map client. Needs a free API key (openchargemap.org → My Profile
 * → API keys), from VITE_OCM_KEY or entered in Settings. Without a key the
 * layer stays off and the UI says why.
 */
export interface Charger {
  id: number;
  name: string;
  address?: string;
  lat: number;
  lon: number;
  maxKw: number;
  points: number;
  connectors: string[];
  cost?: string;
}

/** OCM ConnectionTypeIDs */
const CONNECTOR_IDS: Record<Exclude<Connector, "any">, number[]> = {
  type2: [25, 1036],
  ccs: [33],
};
const CONNECTOR_NAMES: Record<number, string> = { 25: "Type 2", 1036: "Type 2 (kabel)", 33: "CCS", 2: "CHAdeMO", 27: "Tesla" };

interface OcmPoi {
  ID: number;
  AddressInfo: { Title?: string; AddressLine1?: string; Town?: string; Latitude: number; Longitude: number };
  Connections?: { ConnectionTypeID?: number; PowerKW?: number }[];
  NumberOfPoints?: number;
  UsageCost?: string;
}

const queue = createThrottle(1000);

export class MissingKeyError extends Error { constructor() { super("Open Charge Map API key missing"); } }

export function ocmKey(userKey?: string): string {
  return (userKey?.trim() || services.openChargeMap.key || "").trim();
}

export function parsePois(pois: OcmPoi[]): Charger[] {
  return pois.map((p) => {
    const conns = p.Connections ?? [];
    return {
      id: p.ID,
      name: p.AddressInfo.Title ?? "Laadpunt",
      address: [p.AddressInfo.AddressLine1, p.AddressInfo.Town].filter(Boolean).join(", ") || undefined,
      lat: p.AddressInfo.Latitude,
      lon: p.AddressInfo.Longitude,
      maxKw: Math.max(0, ...conns.map((c) => c.PowerKW ?? 0)),
      points: p.NumberOfPoints ?? conns.length,
      connectors: [...new Set(conns.map((c) => CONNECTOR_NAMES[c.ConnectionTypeID ?? -1]).filter(Boolean))] as string[],
      cost: p.UsageCost || undefined,
    };
  });
}

export async function fetchChargers(
  bbox: [number, number, number, number], opts: { minKw: number; connector: Connector; key: string },
): Promise<Charger[]> {
  if (!opts.key) throw new MissingKeyError();
  const [w, s, e, n] = bbox;
  const u = new URL(`${services.openChargeMap.url}/poi`);
  u.searchParams.set("output", "json");
  u.searchParams.set("boundingbox", `(${n},${w}),(${s},${e})`);
  u.searchParams.set("maxresults", "250");
  u.searchParams.set("compact", "true");
  u.searchParams.set("verbose", "false");
  if (opts.minKw > 0) u.searchParams.set("minpowerkw", String(opts.minKw));
  if (opts.connector !== "any") u.searchParams.set("connectiontypeid", CONNECTOR_IDS[opts.connector].join(","));
  u.searchParams.set("key", opts.key);
  const r = await queue(() => fetch(u.toString()));
  if (r.status === 401 || r.status === 403) throw new MissingKeyError();
  if (!r.ok) throw new Error(`Open Charge Map ${r.status}`);
  return parsePois(await r.json());
}
