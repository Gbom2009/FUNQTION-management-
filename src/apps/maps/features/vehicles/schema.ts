import type { Trailer, Vehicle } from "./profiles";

/**
 * Field schema for the vehicle/trailer editors — one place that says what can
 * be entered, its unit and how it's used. The UI renders straight from this.
 */
type L = { nl: string; en: string };
export interface Field<T> {
  key: keyof T & string;
  label: L;
  type: "text" | "number" | "select" | "color" | "bool" | "textarea";
  unit?: string;
  step?: number;
  min?: number;
  max?: number;
  options?: { v: string | number; label: L }[];
  /** what the app does with it — shown as a hint */
  use?: L;
  /** span both columns */
  wide?: boolean;
}
export interface Group<T> { id: string; title: L; fields: Field<T>[] }

const l = (nl: string, en = nl): L => ({ nl, en });

export const VEHICLE_GROUPS: Group<Vehicle>[] = [
  {
    id: "id", title: l("Identiteit", "Identity"), fields: [
      { key: "name", label: l("Naam in de app", "Name in the app"), type: "text", wide: true },
      { key: "make", label: l("Merk", "Make"), type: "text" },
      { key: "model", label: l("Model / uitvoering", "Model / trim"), type: "text" },
      { key: "year", label: l("Bouwjaar", "Year"), type: "number", step: 1, min: 1950, max: 2100 },
      { key: "plate", label: l("Kenteken", "Plate"), type: "text", use: l("alleen voor jezelf (milieuzonecheck op milieuzones.nl)", "for your own reference") },
      { key: "category", label: l("Soort voertuig", "Vehicle type"), type: "select", options: [
        { v: "personenauto", label: l("Personenauto", "Car") }, { v: "bestelauto", label: l("Bestelauto", "Van") },
        { v: "camper", label: l("Camper") }, { v: "vrachtauto", label: l("Vrachtauto", "Truck") }, { v: "motor", label: l("Motor", "Motorbike") },
      ], use: l("bepaalt welke milieuzone-regels gelden", "decides which zone rules apply") },
      { key: "color", label: l("Kleur op de kaart", "Colour on the map"), type: "color" },
    ],
  },
  {
    id: "power", title: l("Aandrijving & milieu", "Powertrain & emissions"), fields: [
      { key: "fuel", label: l("Brandstof", "Fuel"), type: "select", options: [
        { v: "benzine", label: l("Benzine", "Petrol") }, { v: "diesel", label: l("Diesel") }, { v: "lpg", label: l("LPG") },
        { v: "elektrisch", label: l("Elektrisch", "Electric") }, { v: "phev-benzine", label: l("Plug-in hybride (benzine)", "Plug-in hybrid (petrol)") },
        { v: "phev-diesel", label: l("Plug-in hybride (diesel)", "Plug-in hybrid (diesel)") }, { v: "hybride", label: l("Hybride", "Hybrid") },
        { v: "waterstof", label: l("Waterstof", "Hydrogen") },
      ], use: l("milieuzones, EV-tips, verbruik", "zones, EV hints, consumption") },
      { key: "euroClass", label: l("Emissieklasse (Euro)", "Emission class (Euro)"), type: "select",
        options: [0, 1, 2, 3, 4, 5, 6].map((n) => ({ v: n, label: l(`Euro ${n}`) })), use: l("toegang tot diesel-milieuzones", "access to diesel zones") },
      { key: "powerKw", label: l("Vermogen", "Power"), type: "number", unit: "kW", step: 1 },
    ],
  },
  {
    id: "dims", title: l("Maten & gewicht", "Dimensions & weight"), fields: [
      { key: "lengthM", label: l("Lengte", "Length"), type: "number", unit: "m", step: 0.01, use: l("routering met aanhanger", "routing when towing") },
      { key: "widthM", label: l("Breedte incl. spiegels", "Width incl. mirrors"), type: "number", unit: "m", step: 0.01, use: l("smalle wegen vermijden", "avoid narrow roads") },
      { key: "heightM", label: l("Hoogte", "Height"), type: "number", unit: "m", step: 0.01, use: l("lage bruggen/tunnels vermijden + waarschuwen", "avoid + warn for low bridges") },
      { key: "weightKg", label: l("Leeggewicht", "Kerb weight"), type: "number", unit: "kg", step: 10 },
      { key: "maxMassKg", label: l("Toegestane max. massa", "Max permitted mass"), type: "number", unit: "kg", step: 10, use: l("rijbewijscheck B/B96/BE", "licence check") },
    ],
  },
  {
    id: "tow", title: l("Trekken", "Towing"), fields: [
      { key: "towBraked", label: l("Max. trekgewicht geremd", "Max towing, braked"), type: "number", unit: "kg", step: 10, use: l("controle aanhanggewicht", "trailer weight check") },
      { key: "towUnbraked", label: l("Max. trekgewicht ongeremd", "Max towing, unbraked"), type: "number", unit: "kg", step: 10 },
      { key: "noseWeightKg", label: l("Max. kogeldruk", "Max nose weight"), type: "number", unit: "kg", step: 5 },
    ],
  },
  {
    id: "energy", title: l("Energie & kosten", "Energy & cost"), fields: [
      { key: "tankL", label: l("Tankinhoud", "Tank size"), type: "number", unit: "l", step: 1, use: l("actieradius", "range") },
      { key: "fuelPer100", label: l("Verbruik brandstof", "Fuel consumption"), type: "number", unit: "l/100 km", step: 0.1 },
      { key: "fuelLevelPct", label: l("Tank nu", "Tank now"), type: "number", unit: "%", step: 5, min: 0, max: 100, use: l("waarschuwing als je niet aankomt", "warns if you won't make it") },
      { key: "batteryKwh", label: l("Accu (bruikbaar)", "Battery (usable)"), type: "number", unit: "kWh", step: 0.1 },
      { key: "kwhPer100", label: l("Verbruik elektrisch", "Electric consumption"), type: "number", unit: "kWh/100 km", step: 0.1 },
      { key: "evRangeKm", label: l("Elektrisch bereik (vol)", "Electric range (full)"), type: "number", unit: "km", step: 1, use: l("EV-modus-tips in de stad", "EV mode hints") },
      { key: "batteryLevelPct", label: l("Accu nu", "Battery now"), type: "number", unit: "%", step: 5, min: 0, max: 100 },
      { key: "fuelPrice", label: l("Brandstofprijs", "Fuel price"), type: "number", unit: "€/l", step: 0.01, use: l("kosten per rit", "cost per trip") },
      { key: "kwhPrice", label: l("Stroomprijs", "Electricity price"), type: "number", unit: "€/kWh", step: 0.01 },
    ],
  },
  {
    id: "speed", title: l("Snelheid & uitrusting", "Speed & accessories"), fields: [
      { key: "cruiseKmh", label: l("Kruissnelheid snelweg", "Motorway cruise"), type: "number", unit: "km/h", step: 5, use: l("realistische reistijden", "realistic ETAs") },
      { key: "topSpeedKmh", label: l("Topsnelheid", "Top speed"), type: "number", unit: "km/h", step: 5 },
      { key: "roofBoxCm", label: l("Dakkoffer / dakdrager (extra hoogte)", "Roof box (extra height)"), type: "number", unit: "cm", step: 1, use: l("telt op bij de hoogte", "added to height") },
      { key: "bikeRackCm", label: l("Fietsendrager (extra lengte)", "Bike rack (extra length)"), type: "number", unit: "cm", step: 1 },
    ],
  },
  { id: "notes", title: l("Notities", "Notes"), fields: [{ key: "notes", label: l("Notities", "Notes"), type: "textarea", wide: true }] },
];

export const TRAILER_GROUPS: Group<Trailer>[] = [
  {
    id: "id", title: l("Aanhanger", "Trailer"), fields: [
      { key: "name", label: l("Naam", "Name"), type: "text", wide: true },
      { key: "type", label: l("Soort", "Type"), type: "select", options: [
        { v: "gesloten", label: l("Gesloten (bagage/gear)", "Box") }, { v: "open", label: l("Open", "Open") }, { v: "boot", label: l("Boottrailer", "Boat") },
        { v: "caravan", label: l("Caravan") }, { v: "paarden", label: l("Paardentrailer", "Horse") }, { v: "overig", label: l("Overig", "Other") },
      ] },
      { key: "plate", label: l("Kenteken", "Plate"), type: "text" },
      { key: "axles", label: l("Aantal assen", "Axles"), type: "number", step: 1, min: 1, max: 3 },
      { key: "braked", label: l("Geremd", "Braked"), type: "bool", use: l("bepaalt welk trekgewicht geldt", "decides which towing limit applies") },
    ],
  },
  {
    id: "dims", title: l("Maten & gewicht", "Dimensions & weight"), fields: [
      { key: "lengthM", label: l("Lengte incl. dissel", "Length incl. drawbar"), type: "number", unit: "m", step: 0.01 },
      { key: "widthM", label: l("Breedte", "Width"), type: "number", unit: "m", step: 0.01 },
      { key: "heightM", label: l("Hoogte", "Height"), type: "number", unit: "m", step: 0.01, use: l("lage bruggen/tunnels", "low bridges") },
      { key: "emptyKg", label: l("Leeggewicht", "Empty weight"), type: "number", unit: "kg", step: 10 },
      { key: "maxMassKg", label: l("Toegestane max. massa", "Max permitted mass"), type: "number", unit: "kg", step: 10, use: l("rijbewijscheck", "licence check") },
      { key: "weightKg", label: l("Gewicht nu (beladen)", "Weight now (loaded)"), type: "number", unit: "kg", step: 10, use: l("routering + trekgewichtcheck", "routing + towing check") },
    ],
  },
  { id: "notes", title: l("Notities", "Notes"), fields: [{ key: "notes", label: l("Notities", "Notes"), type: "textarea", wide: true }] },
];
