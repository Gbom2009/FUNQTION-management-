import type { Vehicle } from "../vehicles/profiles";

/**
 * Dutch milieuzone rules per city, from milieuzones.nl (official national
 * overview), read 2026-11-06. Only what the site states; where it contradicts
 * itself the entry says so (`unclear`). Zero-emission zones (ZES, for vans and
 * trucks) are a separate regime — see opwegnaarzes.nl — and not covered here.
 * Update this file when the rules change.
 */
export const RULES_SOURCE = { url: "https://www.milieuzones.nl", checked: "2026-11-06" };
export const FINE_EUR = { car: 130, truck: 320 };

/** Minimum Euro class allowed for diesel, per vehicle category. undefined = category not restricted. */
export interface CityRules {
  city: string;
  dieselCarMin?: number;
  dieselVanMin?: number;
  truckMin?: number;
  busMin?: number;
  moped?: boolean;
  /** announced but not yet in force */
  planned?: { what: string; from: string };
  /** zero-emission zone for vans/trucks exists (separate rules) */
  zes?: boolean;
  unclear?: string;
}

const CITIES: CityRules[] = [
  { city: "Amsterdam", dieselCarMin: 5, truckMin: 6, busMin: 6, moped: true, unclear: "of de zone ook voor diesel-bestelauto's geldt staat niet duidelijk op milieuzones.nl" },
  { city: "Arnhem", dieselCarMin: 5, busMin: 6, zes: true },
  { city: "Den Haag", dieselCarMin: 4, moped: true, zes: true, unclear: "de site noemt ook een vrachtautozone in de kuststrook vanaf 1 januari 2026 — controleer bij de gemeente" },
  { city: "Utrecht", dieselCarMin: 5, busMin: 6, zes: true },
  { city: "Eindhoven", busMin: 6, zes: true, planned: { what: "diesel-personenauto's: emissieklasse 5 of hoger", from: "1 januari 2027" } },
  { city: "Rijswijk", truckMin: 6, busMin: 6 },
  { city: "Breda", truckMin: 6 },
  { city: "Delft", truckMin: 6 },
  { city: "Maastricht", zes: false, unclear: "de site zegt dat de vrachtautozone per 1 januari 2026 vervalt, maar noemt Maastricht elders nog" },
  { city: "Rotterdam Maasvlakte", truckMin: 6 },
  { city: "Rotterdam", zes: true },
  { city: "'s-Hertogenbosch", zes: true },
  { city: "Tilburg", zes: true },
  { city: "Haarlem", zes: true },
  { city: "Leiden", zes: true },
];

/** "Milieuzone Rotterdam Maasvlakte" → rules for that city (longest name wins). */
export function rulesForZone(zoneName: string): CityRules | undefined {
  const n = zoneName.toLowerCase();
  return [...CITIES].sort((a, b) => b.city.length - a.city.length).find((c) => n.includes(c.city.toLowerCase()));
}

export type Access = "allowed" | "banned" | "unknown" | "notApplicable";
export interface Verdict { access: Access; reason: string }

const isDiesel = (v: Vehicle) => v.fuel === "diesel" || v.fuel === "phev-diesel";

/** May this vehicle enter? Petrol, LPG and electric always may (milieuzones.nl). */
export function zoneVerdict(r: CityRules | undefined, v: Vehicle): Verdict {
  if (!r) return { access: "unknown", reason: "geen regels bekend voor deze zone" };
  const cat = v.category ?? "personenauto";
  if (cat === "motor") return { access: r.moped ? "unknown" : "notApplicable", reason: r.moped ? "deze zone heeft regels voor brom- en snorfietsen; motoren: check de gemeente" : "geldt niet voor motoren" };
  if (!v.fuel) return { access: "unknown", reason: "vul de brandstof van je auto in" };
  if (!isDiesel(v)) {
    if (cat === "vrachtauto" && r.truckMin !== undefined) return verdictByClass(v, r.truckMin, "vrachtauto's");
    return { access: "allowed", reason: "benzine, lpg en elektrisch mogen alle milieuzones in" };
  }
  const min = cat === "bestelauto" ? r.dieselVanMin : cat === "vrachtauto" ? r.truckMin : r.dieselCarMin;
  if (min === undefined) return { access: "notApplicable", reason: "deze zone geldt niet voor jouw soort voertuig" };
  return verdictByClass(v, min, cat === "bestelauto" ? "diesel-bestelauto's" : cat === "vrachtauto" ? "vrachtauto's" : "diesel-personenauto's");
}

function verdictByClass(v: Vehicle, min: number, what: string): Verdict {
  if (v.euroClass === undefined) return { access: "unknown", reason: `${what} moeten minimaal emissieklasse ${min} hebben; vul de emissieklasse in` };
  return v.euroClass >= min
    ? { access: "allowed", reason: `${what} vanaf emissieklasse ${min} mogen erin; jij hebt Euro ${v.euroClass}` }
    : { access: "banned", reason: `${what} onder emissieklasse ${min} mogen er niet in; jij hebt Euro ${v.euroClass}` };
}

/** Full spoken explanation for the "max" narration level (Dutch). */
export function describeZone(zoneName: string, r: CityRules | undefined, v: Vehicle, vehicleLabel: string): string {
  const parts: string[] = [];
  const verdict = zoneVerdict(r, v);
  if (!r) {
    parts.push(`Van ${zoneName} zijn geen regels bekend in de app. Kijk op milieuzones punt nl.`);
    return parts.join(" ");
  }
  const rules: string[] = [];
  if (r.dieselCarMin !== undefined) rules.push(`diesel-personenauto's hebben minimaal emissieklasse ${r.dieselCarMin} nodig`);
  if (r.dieselVanMin !== undefined) rules.push(`diesel-bestelauto's minimaal klasse ${r.dieselVanMin}`);
  if (r.truckMin !== undefined) rules.push(`vrachtauto's alleen met emissieklasse ${r.truckMin}`);
  if (r.busMin !== undefined) rules.push(`bussen alleen met emissieklasse ${r.busMin}`);
  if (r.moped) rules.push("er gelden ook regels voor brom- en snorfietsen");
  parts.push(rules.length ? `In deze zone geldt: ${rules.join(", ")}.` : "Deze milieuzone heeft geen beperkingen voor personenauto's.");
  parts.push("Benzine, lpg en elektrische auto's mogen altijd naar binnen.");
  if (r.zes) parts.push("Voor bestel- en vrachtauto's geldt hier daarnaast een zero-emissiezone.");
  if (r.planned) parts.push(`Vanaf ${r.planned.from} komt er een regel voor ${r.planned.what}.`);
  parts.push(`Handhaving gebeurt met camera's die je kenteken controleren; de boete is ${FINE_EUR.car} euro.`);
  const v2 = verdict.access === "allowed" ? `Jouw ${vehicleLabel} mag erin.` : verdict.access === "banned" ? `Let op: jouw ${vehicleLabel} mag deze zone niet in.` : `Of jouw auto erin mag, kan de app niet bepalen: ${verdict.reason}.`;
  parts.push(v2);
  return parts.join(" ");
}
