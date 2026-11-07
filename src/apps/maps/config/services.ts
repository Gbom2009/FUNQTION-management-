/**
 * ALL external endpoints live here so they can be swapped for self-hosted ones.
 * Override any of them via .env (VITE_*). Never hardcode API keys elsewhere.
 */
const env = import.meta.env;

export const services = {
  /** OpenFreeMap vector tiles (no key). Dev only — use PMTiles packs offline. */
  tiles: {
    tilejson: env.VITE_TILES_TILEJSON ?? "https://tiles.openfreemap.org/planet",
    glyphs: env.VITE_TILES_GLYPHS ?? "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    attribution:
      '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
  },
  /** Valhalla routing — public demo for dev; self-host later. */
  valhalla: env.VITE_VALHALLA_URL ?? "https://valhalla1.openstreetmap.de",
  /** PDOK Locatieserver (NL geocoding). */
  pdok: env.VITE_PDOK_URL ?? "https://api.pdok.nl/bzk/locatieserver/search/v3_1",
  /** Photon (komoot) — fallback outside NL. */
  photon: env.VITE_PHOTON_URL ?? "https://photon.komoot.io",
  /** Open Charge Map — needs a free key, optional. */
  openChargeMap: {
    url: env.VITE_OCM_URL ?? "https://api.openchargemap.io/v3",
    key: env.VITE_OCM_KEY ?? "",
  },
  /** Identifies us to public services, per their usage policies. */
  userAgent: "FunqtionMaps/0.1 (personal navigation app)",
} as const;

/** Home base: Aarle-Rixtel. Used as the default map centre. */
export const HOME: [number, number] = [5.6386, 51.5097];
