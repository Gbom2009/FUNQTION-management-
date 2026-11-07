import type { Licence, Trailer, Vehicle } from "./profiles";

/**
 * Turns the car/trailer data into decisions (pure, tested):
 * routing dimensions, legal towing checks, range and cost estimates.
 */

/** Height including roof box. */
export function effectiveHeight(v: Vehicle): number | undefined {
  if (v.heightM === undefined) return undefined;
  return round2(v.heightM + (v.roofBoxCm ?? 0) / 100);
}
/** Length including bike rack. */
export function effectiveLength(v: Vehicle): number | undefined {
  if (v.lengthM === undefined) return undefined;
  return round2(v.lengthM + (v.bikeRackCm ?? 0) / 100);
}
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Valhalla `auto` costing extras from the car (no trailer). */
export function autoCosting(v: Vehicle): Record<string, number> {
  const o: Record<string, number> = {};
  const h = effectiveHeight(v);
  if (h) o.height = h;
  if (v.widthM) o.width = v.widthM;
  if (v.cruiseKmh) o.top_speed = v.cruiseKmh;
  else if (v.topSpeedKmh) o.top_speed = Math.min(v.topSpeedKmh, 140);
  return o;
}

export type CheckLevel = "error" | "warn" | "info";
export interface Check { level: CheckLevel; key: string; params?: Record<string, string | number> }

/** Trailer weight the check uses: actual load if known, else its max mass. */
export function trailerMass(t: Trailer): number | undefined {
  return t.weightKg ?? t.maxMassKg;
}

/**
 * Legal/technical towing checks (NL). Not legal advice — the UI says so.
 * - weight vs the car's braked/unbraked towing capacity
 * - licence: B allows a heavy trailer only if car MTM + trailer MTM ≤ 3500 kg;
 *   B96 (code 96) up to 4250 kg; BE up to a 3500 kg trailer.
 */
export function towChecks(v: Vehicle, t: Trailer, licence: Licence): Check[] {
  const out: Check[] = [];
  const mass = trailerMass(t);
  const braked = t.braked ?? (mass !== undefined ? mass > 750 : undefined);
  if (mass !== undefined) {
    const cap = braked ? v.towBraked : v.towUnbraked;
    if (cap !== undefined && mass > cap) out.push({ level: "error", key: "check.overTow", params: { mass, cap } });
    if (braked === false && mass > 750) out.push({ level: "error", key: "check.unbraked750", params: { mass } });
  } else {
    out.push({ level: "info", key: "check.noTrailerMass" });
  }
  if (v.towBraked === undefined && v.towUnbraked === undefined) out.push({ level: "info", key: "check.noTowCap" });

  const trailerMtm = t.maxMassKg ?? mass;
  if (trailerMtm !== undefined && trailerMtm > 750 && licence !== "BE") {
    if (v.maxMassKg === undefined) {
      out.push({ level: "warn", key: "check.licenceUnknown" });
    } else {
      const combo = v.maxMassKg + trailerMtm;
      const limit = licence === "B96" ? 4250 : 3500;
      if (combo > limit) out.push({ level: "error", key: "check.licence", params: { combo, limit, licence } });
    }
  }
  if (licence === "BE" && trailerMtm !== undefined && trailerMtm > 3500) out.push({ level: "error", key: "check.be3500", params: { mass: trailerMtm } });
  if (v.noseWeightKg === undefined) out.push({ level: "info", key: "check.noNose" });
  return out;
}

/** Towing raises consumption; ~35 % is a common rule of thumb for a box trailer. */
export const TOW_FACTOR = 1.35;

export interface RangeInfo {
  /** km on the fuel currently in the tank */
  fuelKm?: number;
  /** km on the battery charge */
  evKm?: number;
  totalKm?: number;
  /** undefined = not enough data */
  enough?: boolean;
}

export function rangeFor(v: Vehicle, routeKm: number, towing: boolean): RangeInfo {
  const f = towing ? TOW_FACTOR : 1;
  const fuelKm = v.tankL && v.fuelPer100 && v.fuelLevelPct !== undefined
    ? Math.round(((v.tankL * v.fuelLevelPct) / 100 / v.fuelPer100) * 100 / f) : undefined;
  const evFull = v.evRangeKm ?? (v.batteryKwh && v.kwhPer100 ? (v.batteryKwh / v.kwhPer100) * 100 : undefined);
  const evKm = evFull !== undefined && v.batteryLevelPct !== undefined ? Math.round((evFull * v.batteryLevelPct) / 100 / f) : undefined;
  const totalKm = fuelKm === undefined && evKm === undefined ? undefined : (fuelKm ?? 0) + (evKm ?? 0);
  return { fuelKm, evKm, totalKm, enough: totalKm === undefined ? undefined : totalKm >= routeKm * 1.1 };
}

export interface CostInfo { euro: number; electricKm: number; fuelL: number; kwh: number }

/**
 * Trip energy + cost estimate. PHEVs spend their electric range first —
 * on the urban part when it fits, otherwise wherever it lasts.
 */
export function tripCost(v: Vehicle, routeKm: number, towing: boolean): CostInfo | undefined {
  const f = towing ? TOW_FACTOR : 1;
  const electric = v.fuel === "elektrisch";
  const plugin = v.fuel === "phev-benzine" || v.fuel === "phev-diesel";
  const evAvail = electric ? routeKm : plugin
    ? Math.min(routeKm, ((v.evRangeKm ?? 0) * (v.batteryLevelPct ?? 100)) / 100 / f) : 0;
  const fuelKm = routeKm - evAvail;
  const fuelL = v.fuelPer100 ? (fuelKm * v.fuelPer100 * f) / 100 : 0;
  const kwh = v.kwhPer100 ? (evAvail * v.kwhPer100 * f) / 100 : 0;
  if (!fuelL && !kwh) return undefined;
  const euro = fuelL * (v.fuelPrice ?? 0) + kwh * (v.kwhPrice ?? 0);
  return { euro: Math.round(euro * 100) / 100, electricKm: Math.round(evAvail), fuelL: Math.round(fuelL * 10) / 10, kwh: Math.round(kwh * 10) / 10 };
}

/** Short spoken description of the car, e.g. "Range Rover Sport P440e, plug-in benzine, Euro 6". */
export function describeVehicle(v: Vehicle, lang: "nl" | "en"): string {
  const fuelNl: Record<string, string> = {
    benzine: "benzine", diesel: "diesel", lpg: "lpg", elektrisch: "volledig elektrisch", "phev-benzine": "plug-in hybride op benzine",
    "phev-diesel": "plug-in hybride op diesel", hybride: "hybride", waterstof: "waterstof",
  };
  const fuelEn: Record<string, string> = {
    benzine: "petrol", diesel: "diesel", lpg: "LPG", elektrisch: "fully electric", "phev-benzine": "petrol plug-in hybrid",
    "phev-diesel": "diesel plug-in hybrid", hybride: "hybrid", waterstof: "hydrogen",
  };
  const parts = [v.name];
  if (v.fuel) parts.push((lang === "nl" ? fuelNl : fuelEn)[v.fuel]);
  if (v.euroClass !== undefined) parts.push(`Euro ${v.euroClass}`);
  return parts.join(", ");
}
