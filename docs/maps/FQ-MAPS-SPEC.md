# CLAUDE.md — Funqtion Maps ("FQ Nav")

You are building a personal, Team Funqtion–branded navigation app for Gijs (DJ duo Team Funqtion, Aarle-Rixtel, NL — tagline **FEEL THE MUSIQ**).
Read this whole file before writing code. Work in the phases at the bottom, and stop for a check-in at the end of each phase.

---

## 1. Goal

One codebase that ships as:

1. **Windows `.exe`** — test build. No real GPS on a PC, so it must include a route simulator.
2. **iPhone + iPad app** — the real end result, sideloaded (not App Store).

Two top-level modes:

- **Drive mode** — glanceable, huge touch targets, minimal UI, works on an iPad mini on a Quad Lock mount and on an iPhone.
- **Plan mode** — full UI for planning gig days, multi-stop routes, venues, vehicles and trailers.

Default UI language: **Dutch**, with an English toggle.

---

## 2. Stack (decided — don't swap without asking)

| Layer | Choice | Why |
|---|---|---|
| Shell | **Tauri 2** | One codebase → Windows `.exe` + iOS app |
| UI | **React + TypeScript + Vite** | Fast iteration, Gijs's site is web tech too |
| Styling | **Tailwind** with brand tokens as CSS variables | Single source of truth for Funqtion colors |
| Map renderer | **MapLibre GL JS** | Vector tiles, rotation, 3D tilt for drive mode |
| Base tiles | **OpenFreeMap** (no key) for dev; style JSON customised to brand | Free, vector |
| Offline tiles | **PMTiles** region packs (Protomaps) | Gig regions offline |
| Routing | **Valhalla** (public demo server for dev, self-host option later) | Supports `auto` AND `truck` costing with length/width/height/weight → trailer routing |
| Geocoding NL | **PDOK Locatieserver** | Free, excellent Dutch addresses |
| Geocoding fallback | **Photon** (komoot) | Outside NL |
| EV chargers (optional) | Open Charge Map API | PHEV charging stops |
| Voice | Web Speech API (`speechSynthesis`), `nl-NL` voice | Works in WKWebView |
| State | Zustand | Light |
| Storage | Tauri `store` plugin / SQLite plugin | Venues, vehicles, trip log |
| Device | Tauri plugins: geolocation, keep-awake (or equivalent), haptics where available | |

Rules:
- Use current stable versions; check docs before pinning anything.
- Respect the public services' usage policies: throttle geocoding (debounce + max 1 req/s), cache routes, set a proper User-Agent, never bulk-download tiles from public servers.
- All API endpoints live in `src/config/services.ts` so they can be swapped for self-hosted ones.

---

## 3. Branding — Team Funqtion

**Source of truth, in this order:**
1. Gijs's website repo: `github.com/gbom2009/funqtion-site` — extract the exact colors, fonts and logo files from its CSS/Tailwind config and assets.
2. `VIDEO-BRAND.md` (Dutch brand style guide, used for the Remotion promo videos — ask Gijs for the path if it's not in this repo).
3. Only if neither is available, use the **placeholder palette** below and flag clearly that it's a placeholder.

Put the final values in `src/theme/tokens.css`:

```css
:root {
  /* REPLACE with values from funqtion-site / VIDEO-BRAND.md */
  --fq-bg:        #0A0A0F;  /* placeholder: near-black stage */
  --fq-surface:   #15151F;
  --fq-text:      #F5F5F7;
  --fq-muted:     #8A8AA0;
  --fq-primary:   #8B5CF6;  /* placeholder: brand main accent */
  --fq-secondary: #22D3EE;  /* placeholder: second accent */
  --fq-warn:      #FACC15;
  --fq-danger:    #F43F5E;
  --fq-route:     var(--fq-primary);
  --fq-font-display: "REPLACE", system-ui, sans-serif;
  --fq-font-body:    "REPLACE", system-ui, sans-serif;
}
```

Brand rules:
- Dark-first. A light "day" theme exists but stays on-brand (same accents).
- The route line is the hero: brand-colored, glowing, subtly pulsing (see "Waveform route" below).
- Funqtion logo on splash screen and Plan-mode header only. **Never** in Drive mode except a tiny mark.
- Customize the MapLibre style JSON: dark base, muted roads, brand-colored labels for POIs we care about (venues, chargers). Keep it readable — legibility beats style.
- App icon + splash: generated from the Funqtion logo (`src-tauri/icons`, iOS asset catalog).
- Voice-line copy can have Funqtion flavour, but instructions must stay unambiguous.

---

## 4. Drive mode

Hard UX rules:
- Minimum touch target 64 pt; key numbers readable at arm's length.
- Landscape (iPad on mount) and portrait (iPhone) layouts.
- Screen stays awake while navigating.
- **Safety lock:** above 10 km/h, Plan-mode screens and text input are disabled; only big buttons (mute, recenter, end route, next stop) work.
- Map in heading-up, tilted 3D follow camera; auto-zoom by speed.
- Auto day/night theme by sunrise/sunset.

HUD elements:
- Next maneuver card ("**Next drop**"): arrow, distance, street name, lane hints when Valhalla returns them.
- Current speed + speed limit (OSM `maxspeed` via Valhalla `trace_attributes` or edge info). Turns `--fq-danger` when over.
- ETA, remaining time, remaining km.
- **Tow badge** when a trailer profile is active.

Voice:
- Dutch TTS, prompts at sensible distances (e.g. 2 km / 500 m / 100 m on motorways, shorter in town).
- Mute toggle always visible.

Rerouting:
- Off-route detection (distance from route polyline + heading), reroute with the active vehicle/trailer profile.

---

## 5. Plan mode

- Search (PDOK first, Photon fallback), long-press to drop a pin.
- Multi-stop routes with drag-to-reorder.
- Route options: fastest, avoid motorways, avoid tolls/ferries, trailer-aware.
- Compare up to 3 alternatives.
- "Start in Drive mode" button → hands the route over.

---

## 6. Feature set (Funqtion extras)

### 6.1 Vehicle & trailer profiles
- Vehicles (pre-filled names, Gijs fills specs): **Range Rover Sport P440e**, **Jeep Grand Cherokee 4xe**, room for a future **VW Golf**.
- Trailers: **DJ gear trailer**, **boat trailer** — user enters length, width, height, weight.
- When a trailer is attached, route with Valhalla `truck` costing using combined dimensions (avoids low bridges, weight limits, too-narrow roads where data exists).
- **Tow speed cap:** configurable per road class. Defaults for NL car+trailer: 90 km/h on autosnelweg/autoweg, 80 elsewhere outside built-up areas, 50 inside — show a note that the user must verify these for their combination. HUD uses the lower of the posted limit and the tow cap.
- Extra warnings in tow mode: steep descents, sharp turns, narrow streets (best effort from available data).

### 6.2 Gig Day mode
- Create a gig: venue, date, **load-in time**, setup buffer (default 60 min).
- App computes **leave-by time** from route duration + buffer + optional traffic margin, and sends a local notification.
- Venue cards: separate pins for the **address** and the **load-in door**, trailer parking spot, contact person, notes, photos.
- "Share ETA" → native share sheet with a pre-written message (e.g. to Coen): "Onderweg met de trailer, ETA 17:42 🎧".

### 6.3 PHEV smart hints (both cars are plug-in hybrids)
- Load NL **milieuzone** boundaries (bundle a GeoJSON; document the source) and alert before entering one.
- Suggest "Switch to EV mode" before urban stretches / zones, if battery-range setting allows. Pure hint — no car integration.
- Optional charger layer (Open Charge Map) with filters.

### 6.4 Waveform route (signature look)
- Route line rendered with a subtle animated pulse that travels along the route, like a waveform/beat.
- Calm and slow in Drive mode (no distraction), more expressive in Plan mode. Respects iOS "Reduce Motion".

### 6.5 Tour stats ("Setlist")
- Trip log: date, km, duration, vehicle, trailer, linked gig.
- Season stats: total km, gigs, furthest gig, km towed, a heatmap of driven roads.
- **Story export:** 1080×1920 PNG in full Funqtion style (logo, "FEEL THE MUSIQ", route silhouette, stats) for Instagram (@funqtion1).

### 6.6 Plan on iPad → drive on iPhone
- Export the planned route as a QR code (compressed JSON: stops + profile + options). Scan on the other device → identical route. No server needed.
- Also export/import `.gpx` and `.fqroute` (JSON) files.

### 6.7 Offline region packs
- Download a PMTiles extract for a region (e.g. Noord-Brabant) for offline map display.
- Cache the last computed routes so an active route survives losing signal.

### 6.8 Simulator (required for the .exe)
- Dev panel: replay any route or `.gpx` as fake GPS at 0.5×–8× speed, with injected GPS noise and a "go off-route" button to test rerouting.
- Hidden in iOS release builds unless a dev toggle is on.

### 6.9 Stretch (only after Phase 5, ask first)
- **Convoy mode:** see each other's live position when Gijs and Coen drive separately (needs a tiny relay server — propose options).
- **OBD2 dashboard tab** for the iPad mini: BLE OBD2 adapter (ELM327-compatible) → speed, rpm, coolant temp, battery state. Investigate Tauri BLE plugin feasibility on iOS first.
- Now-playing strip (only if feasible without App Store entitlements).

---

## 7. Project template

```
funqtion-maps/
├─ CLAUDE.md
├─ README.md                    # build + sideload instructions (write this)
├─ package.json
├─ vite.config.ts
├─ tailwind.config.ts           # maps to CSS vars in tokens.css
├─ index.html
├─ src/
│  ├─ main.tsx
│  ├─ App.tsx                   # mode router: Drive | Plan | Settings
│  ├─ config/
│  │  └─ services.ts            # ALL external endpoints + keys
│  ├─ theme/
│  │  ├─ tokens.css             # Funqtion brand tokens
│  │  └─ mapStyle.ts            # branded MapLibre style (day/night)
│  ├─ map/
│  │  ├─ MapView.tsx
│  │  ├─ followCamera.ts
│  │  └─ waveformRoute.ts       # animated route layer
│  ├─ nav/
│  │  ├─ valhalla.ts            # route, reroute, costing (auto/truck)
│  │  ├─ geocode.ts             # PDOK → Photon fallback, throttled
│  │  ├─ guidance.ts            # maneuver progression, off-route detection
│  │  ├─ voice.ts               # nl-NL TTS prompts
│  │  └─ speed.ts               # limits + tow cap
│  ├─ location/
│  │  ├─ provider.ts            # interface: real | simulated
│  │  ├─ realGps.ts             # Tauri geolocation
│  │  └─ simulator.ts           # route/GPX replay
│  ├─ modes/
│  │  ├─ drive/                 # HUD, maneuver card, safety lock
│  │  └─ plan/                  # search, stops, alternatives
│  ├─ features/
│  │  ├─ vehicles/              # vehicle + trailer profiles
│  │  ├─ gigs/                  # gig day, venues, leave-by, share ETA
│  │  ├─ phev/                  # milieuzones, EV hints, chargers
│  │  ├─ stats/                 # trip log, heatmap, story export
│  │  ├─ handoff/               # QR + .fqroute/.gpx
│  │  └─ offline/               # PMTiles packs
│  ├─ i18n/ (nl.json, en.json)
│  └─ store/                    # Zustand + persistence
├─ public/data/milieuzones.geojson
├─ src-tauri/                   # Tauri 2 config, icons, iOS project
└─ .github/workflows/
   └─ build-windows.yml         # builds the .exe on windows-latest
```

Key interface — everything nav-related consumes `LocationProvider`, never the GPS directly:

```ts
export interface Fix { lat: number; lon: number; speedKmh: number; heading: number; accuracyM: number; t: number; }
export interface LocationProvider {
  start(onFix: (f: Fix) => void): void;
  stop(): void;
  readonly kind: "real" | "simulated";
}
```

---

## 8. Builds & sideloading

**Windows `.exe` (testing)**
- Gijs develops on a Mac. Don't rely on cross-compiling: add a GitHub Actions workflow on `windows-latest` that runs `tauri build` and uploads the `.exe`/installer as an artifact. Also support a local Windows build if he's on a PC.
- Simulator on by default in this build.

**iPhone / iPad (end result)**
- Build on the Mac with Xcode via Tauri's iOS target.
- Sideload options to document in README.md:
  - Xcode + free Apple ID: works, but the app expires after 7 days and must be re-installed.
  - Paid Apple Developer account: install for a year via Xcode/ad-hoc.
  - AltStore / SideStore: auto-refresh of the 7-day signature.
- Info.plist: location usage strings (Dutch + English), keep screen awake while navigating, iPad multitasking/landscape support.
- Note in README: **CarPlay is not realistic** for a sideloaded app (it requires an Apple-granted navigation entitlement) — the iPad mini mount is the dashboard.

---

## 9. Phases (check in with Gijs after each)

1. **Skeleton** — Tauri + React + MapLibre running on Mac dev, branded tokens pulled from funqtion-site, mode switcher, branded map style.
2. **Plan core** — search, pins, multi-stop, Valhalla routes, alternatives.
3. **Drive core + simulator** — follow camera, HUD, maneuvers, Dutch voice, off-route + reroute, safety lock. Windows `.exe` via GitHub Actions. ← first testable build.
4. **Funqtion features** — vehicle/trailer profiles + truck routing + tow cap, Gig Day, venue cards, share ETA, waveform route.
5. **PHEV + extras** — milieuzones, EV hints, chargers, offline packs, QR handoff, tour stats + story export.
6. **iOS** — iPhone + iPad layouts, real GPS, permissions, icons/splash, sideload instructions, on-device test drive checklist.
7. **Stretch** — only with approval.

## 10. Working rules
- Small commits, one feature per commit, conventional commit messages.
- Write a short test for guidance math (off-route distance, maneuver progression, leave-by calculation, tow-cap logic).
- Never hardcode API keys; use `.env` + `services.ts`.
- If a public service rate-limits or a data source is missing, degrade gracefully and tell Gijs, don't silently fake data.
- Ask before adding paid services or a backend.
