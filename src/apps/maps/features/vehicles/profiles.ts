import { effectiveHeight, effectiveLength } from "./apply";

/**
 * Vehicle + trailer profiles and tow logic (pure, tested).
 * Dimensions in metres, weights in kg. Undefined = not filled in yet.
 */
export type VehicleCategory = "personenauto" | "bestelauto" | "camper" | "vrachtauto" | "motor";
export type Fuel = "benzine" | "diesel" | "lpg" | "elektrisch" | "phev-benzine" | "phev-diesel" | "hybride" | "waterstof";

/**
 * Everything the app can know about a car. All optional: the app uses what is
 * filled in and says when it is estimating. Dimensions in m, weights in kg.
 */
export interface Vehicle {
  id: string;
  name: string;
  // identity
  make?: string;
  model?: string;
  year?: number;
  plate?: string;
  /** puck colour on the map */
  color?: string;
  category?: VehicleCategory;
  // powertrain & environment
  fuel?: Fuel;
  /** Euro emission class 0–6 (RDW "emissieklasse") */
  euroClass?: number;
  powerKw?: number;
  // dimensions & weights
  lengthM?: number;
  /** width incl. mirrors */
  widthM?: number;
  heightM?: number;
  /** kerb/operating weight */
  weightKg?: number;
  /** max permitted mass (toegestane maximum massa) */
  maxMassKg?: number;
  // towing
  towBraked?: number;
  towUnbraked?: number;
  noseWeightKg?: number;
  // energy & cost
  tankL?: number;
  /** l/100 km (combustion mode) */
  fuelPer100?: number;
  batteryKwh?: number;
  /** kWh/100 km (electric mode) */
  kwhPer100?: number;
  /** pure-electric range */
  evRangeKm?: number;
  /** last known fill levels, 0–100 % (for range checks) */
  fuelLevelPct?: number;
  batteryLevelPct?: number;
  fuelPrice?: number;
  kwhPrice?: number;
  // speed & accessories
  topSpeedKmh?: number;
  /** preferred cruising speed on motorways — used for ETAs */
  cruiseKmh?: number;
  roofBoxCm?: number;
  bikeRackCm?: number;
  notes?: string;
}

export type TrailerType = "gesloten" | "open" | "boot" | "caravan" | "paarden" | "overig";

export interface Trailer {
  id: string;
  name: string;
  type?: TrailerType;
  plate?: string;
  /** body + drawbar */
  lengthM?: number;
  widthM?: number;
  heightM?: number;
  emptyKg?: number;
  /** max permitted mass of the trailer */
  maxMassKg?: number;
  /** current loaded weight */
  weightKg?: number;
  braked?: boolean;
  axles?: number;
  notes?: string;
}

/** Driving licence held — limits what may be towed. */
export type Licence = "B" | "B96" | "BE";

/** Tow speed caps per road type (km/h). */
export interface TowCaps { motorway: number; rural: number; urban: number }

/** NL car + trailer defaults. The user must verify these for their combination. */
export const NL_TOW_DEFAULTS: TowCaps = { motorway: 90, rural: 80, urban: 50 };

export const DEFAULT_VEHICLES: Vehicle[] = [
  // Only facts that are certain are pre-filled; the rest is yours to enter.
  { id: "rr-p440e", name: "Range Rover Sport P440e", make: "Land Rover", model: "Range Rover Sport P440e", category: "personenauto", fuel: "phev-benzine", color: "#f68712" },
  { id: "jeep-4xe", name: "Jeep Grand Cherokee 4xe", make: "Jeep", model: "Grand Cherokee 4xe", category: "personenauto", fuel: "phev-benzine", color: "#f0f0f0" },
  { id: "vw-golf", name: "VW Golf", make: "Volkswagen", model: "Golf", category: "personenauto" },
];

export const DEFAULT_TRAILERS: Trailer[] = [
  { id: "dj-gear", name: "DJ gear trailer", type: "gesloten" },
  { id: "boat", name: "Boottrailer", type: "boot" },
];

/** Fallbacks when a field is empty — conservative typical values, flagged in the UI. */
const FALLBACK = {
  car: { lengthM: 4.9, widthM: 2.0, heightM: 1.8, weightKg: 2500 },
  trailer: { lengthM: 4.0, widthM: 2.0, heightM: 2.0, weightKg: 1500 },
};

export interface TruckDims {
  lengthM: number;
  widthM: number;
  heightM: number;
  /** tonnes, as Valhalla wants */
  weightT: number;
  /** which values came from fallbacks instead of the profile */
  estimated: string[];
}

/** Combined dimensions of car + trailer for Valhalla `truck` costing. */
export function combinedDims(v: Vehicle, t: Trailer): TruckDims {
  const estimated: string[] = [];
  // accessories count: roof box adds height, bike rack adds length; trailer uses its load (or max mass)
  const car = { ...v, heightM: effectiveHeight(v), lengthM: effectiveLength(v) };
  const tr = { ...t, weightKg: t.weightKg ?? t.maxMassKg ?? t.emptyKg };
  const pick = <K extends keyof typeof FALLBACK.car>(obj: Vehicle | Trailer, k: K, which: "car" | "trailer") => {
    const val = (which === "car" ? car : tr)[k] ?? obj[k];
    if (val === undefined || !(val > 0)) { estimated.push(`${which}.${k}`); return FALLBACK[which][k]; }
    return val;
  };
  const cl = pick(v, "lengthM", "car"), cw = pick(v, "widthM", "car"), ch = pick(v, "heightM", "car"), cwt = pick(v, "weightKg", "car");
  const tl = pick(t, "lengthM", "trailer"), tw = pick(t, "widthM", "trailer"), th = pick(t, "heightM", "trailer"), twt = pick(t, "weightKg", "trailer");
  return {
    lengthM: round1(cl + tl),
    widthM: round1(Math.max(cw, tw)),
    heightM: round1(Math.max(ch, th)),
    weightT: round1((cwt + twt) / 1000),
    estimated,
  };
}
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Tow cap for a road. Road class tells motorway; a posted limit ≤ 50
 * is treated as built-up area (NL "bebouwde kom").
 */
export function towCapFor(caps: TowCaps, roadClass?: string, postedKmh?: number): number {
  if (roadClass === "motorway" || roadClass === "trunk") return caps.motorway;
  if (postedKmh !== undefined && postedKmh <= 50) return caps.urban;
  if (roadClass === "residential" || roadClass === "service_other" || roadClass === "living_street") return caps.urban;
  return caps.rural;
}
