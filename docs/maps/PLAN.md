# Funqtion Maps in the Hub — Merge Plan

> Gijs's decision (Nov 2026): **FQ-maps moves into this repo** and becomes the hub's **Navigatie** app (`/maps`), sharing the database with apps 1–6. Gigs and venues are entered **once**, in the suite. The Instagram handle everywhere is **@funqtionofficial**.
> Source: [github.com/Gbom2009/FQ-maps](https://github.com/Gbom2009/FQ-maps) (Tauri 2 + React + MapLibre, ~15k lines, 175 files, phases 1–5 done). **Status: steps 1–5 built** (Maps v0.8.0, Gig Day v0.9.0). See "What was built" at the end and `docs/ARCHITECTURE.md` → Navigatie.

## 1. What changes for the user

- One app: the Funqtion Hub gets a **Navigatie** tile (the placeholder `navigation` entry in `hub/apps.ts` becomes live). Same login, same theme, same backups.
- One Windows exe and, later, one iPhone/iPad app instead of two.
- **No hand-over codes or links between your own apps any more.** Gig Day's "Route" button opens Maps inside the hub with the gig's stops planned (home → pick-up → loading entrance) and the trailer attached. Drive time, arrival and km land straight in the shared database:
  - drive time → the Gig Day timeline
  - arrival → the gig log
  - km → App 3 `trips`
- What FQ-maps does today stays:
  - search (PDOK/Photon)
  - Valhalla routes with trailer-aware truck routing and tow speed caps
  - drive mode with the Dutch voice (system or Piper), speed limits, speed cameras (NL/BE), the safety lock, the simulator
  - offline region packs, milieuzones/EV hints, chargers
  - the waveform route, Setlist stats and the Instagram story export
  
  The route QR/`.fqroute`/`.gpx` hand-over stays too, for iPad → iPhone and for sharing a route with someone else.

## 2. Data: one source

| FQ-maps today (zustand → localStorage) | In the hub | Notes |
|---|---|---|
| `fq-gigs.venues` (address pin, **load-in door**, **trailer parking**, contact, notes, photos as data URLs) | App 1 `venues` + Gig Day's venue extensions: `loadingEntrance {lat,lng,note}`, `trailerParking {lat,lng,note}`; photos → `venuePhotos` (Blobs); contact → a person linked as day contact / venue manager | Pin-picking on the map writes these fields. |
| `fq-gigs.gigs` (title, date, load-in time, set-up buffer, traffic margin, last route) | App 1 `gigs` + Gig Day `gigDays` (load-in step in the timeline, `travelMinutes`, `trafficMarginPct`) | FQ-maps' Gigs tab becomes a view of the suite's gigs (no separate gig editor). |
| `fq-trips` (km, times, car, trailer, gigId, arrived, simulated) | App 3 `trips` (`source: 'nav'`, `driver`, `gigId`, `km`, `vehicleId`, `trailerId`, `startedAt/endedAt`, `simulated`) | One trip list for mileage, Setlist stats and the story export. Simulated trips never count for mileage. |
| GPS tracks (own IndexedDB `tracks`) | Dexie table `tracks` (per trip, polyline) | Heatmap; excluded from backups by default (large), opt-in. |
| `fq-vehicles` (cars + trailers with all specs) | Dexie `vehicles` (shared) | The **DJ gear trailer** is the one App 5 knows: its maximum mass (750 kg) and empty weight then come from here instead of Gear settings. |
| Device preferences: voice, guidance level, map settings, drive state, offline packs, PHEV settings, language/theme | stay **per device** (localStorage / Cache Storage), prefixed `fq-maps-*` | They're about this phone/iPad, not shared data. Language and theme follow the hub's settings. |

**Migrating what's already in FQ-maps on your devices:** the old app runs on a different origin, so the hub can't read its storage directly. A one-time **import**:
1. In the current FQ-maps, export the data (a small "Exporteer alles" JSON of the `fq-*` keys; this one change is made in the FQ-maps repo, or the JSON can be copied once from its storage).
2. In Hub → Navigatie → Instellingen → **Importeer FQ-maps-gegevens**:
   - venues are matched to suite venues by name/address (you confirm each match)
   - gigs are matched by date and venue
   - trips go to App 3 (de-duplicated)
   - vehicles and trailers are copied
   
   After that, the old app can be archived.

## 3. Code: how it moves

1. **Keep its history:** add FQ-maps with `git subtree` (or a plain copy plus a link to the old repo) under `src/apps/maps/`. The old repo is archived afterwards.
2. **Align versions** (the bigger part of the work): FQ-maps runs on **React 19, Vite 8, TypeScript 7, Vitest 5, Tailwind v4**; the suite on React 18, Vite 6, TypeScript 5.9, Vitest 3. Recommended: **upgrade the suite** (React 19 is mostly drop-in; Dexie's React hooks support it), run all suite tests and the Playwright flows, then add Maps.
3. **CSS isolation:** the suite uses its own CSS tokens; FQ-maps uses Tailwind v4.
   - Tailwind's base reset (preflight) must not leak into the other apps: Maps imports only Tailwind's theme and utilities, scoped under a `.fq-maps` root.
   - Both use the same brand tokens (taken from `funqtion-site`), so colours and fonts match. FQ-maps' `--fq-*` tokens are mapped onto the suite's.
4. **State:** zustand stays inside Maps for live UI state (plan, drive session). Gigs, venues, trips and vehicles read/write through the suite's `db` + `save()` (audit log, backups). Thin adapters replace `features/gigs/store.ts`, `features/stats/tripLog.ts` and `features/vehicles/store.ts`.
5. **Loading:** Maps is **lazy-loaded** (its own route chunk), so the other apps stay fast:
   - MapLibre, PMTiles and the map style load only when you open Maps
   - Piper (the neural voice, ONNX runtime + 60–80 MB voice model) loads only after its download in Settings, as today
   - the PWA precaches the Maps code but not voice models or tile packs (cached on use)
6. **Static data:** `public/data/milieuzones.geojson`, `nl-be.geojson` and the map glyph fonts move to `public/maps/`; the `data:*` scripts move to `scripts/maps/`.
7. **Tests:** FQ-maps' tests (nav, guidance, drive, tts, handoff, phase 4/5) run in the suite's Vitest. The DOM-based ones keep `happy-dom` via a per-file environment.
8. **Desktop/iOS shell:** one `src-tauri` for everything. FQ-maps' shell currently only adds the log plugin, and location comes from the webview, so the merge adds no native requirements. Background notifications and background location (FQ-maps' Phase 6) are then done once for the whole hub.
9. **Fixes on the way:**
   - the story export's handle **@funqtion1 → @funqtionofficial**
   - one i18n system (Maps' `nl.json`/`en.json` become typed keys in the suite's `nl.ts`/`en.ts`)
   - the services config (`config/services.ts`) stays as the single place for external endpoints

## 4. Order of work (when you say "build")

1. Upgrade the suite to React 19 / Vite 8 / TS 7 / Vitest 5 → all 118 tests + Playwright flows green, exe built.
2. Bring in FQ-maps under `src/apps/maps/` with its own tests green, as a lazy-loaded hub app; CSS scoped.
3. Shared data: vehicles, trips, tracks tables (Dexie version bump); adapters for gigs/venues/trips/vehicles; pin-picking writes to suite venues; Gigs tab shows suite gigs.
4. The FQ-maps import (one-time migration).
5. Gig Day (app 6) builds on it: "Route" opens Maps in-app; drive time, arrival and km flow back directly.

## 5. Risks and checks

- **Version upgrade** may surface small breaking changes (React 19 types, Vite 8 config). Mitigation: step 1 is its own PR with all checks.
- **Bundle size / memory on an iPad mini in drive mode**: Maps stays lazy-loaded and the drive screen unchanged; test on the device.
- **Public services' usage policies** (Valhalla demo server, Overpass, PDOK, OpenFreeMap) are unchanged by the merge; the hub must keep FQ-maps' throttling and User-Agent.
- **Licences:** OpenStreetMap (ODbL) attribution stays visible on the map; Natural Earth, milieuzones data and Piper voices (CC0/varied) keep their attribution in Settings → Over.

## 6. What was built (v0.8.0) and where it differs from the plan

- **Step 1** (PR #13): React 19.3, Vite 8.3, TypeScript 7.0, Vitest 5.1. No app code changes were needed.
- **Step 2:** the code is a **plain copy** with a link to the old repo, not a `git subtree` (the available clone had a single squashed commit, so there was no history to keep). No splash inside the hub; the Maps logo leads back to the hub. Maps' strings moved into `nl.ts`/`en.ts` as `maps.*` keys.
- **Step 3:** as planned, plus:
  - arrival is stored on the gig day (`gigDays.arrivedAt`) until Gig Day's log exists
  - simulated drives never leave the device, which is simpler and safer than filtering them out of mileage everywhere
  - Setlist now shows **all** App 3 trips (also manual/venue ones), so the season stats match the mileage
  - In Maps you can't create, rename or delete gigs, or delete venues; links go to Bookings.
- **Step 4:** there's no "Exporteer alles" button in the old app yet (that repo can't be pushed from here). Instead, the import screen shows a one-line console command that copies the `fq-*` data, and it also accepts a saved JSON file. GPS tracks from the old app aren't imported.
- **Story export:** the handle is now **@funqtionofficial**.

**Still to do:**
- Test drive mode on the iPad mini and iPhone (memory, GPS, voice) inside the hub.
- Archive the old FQ-maps repo once the import has been done on every device.
- Optional: opt-in GPS tracks in backups.
