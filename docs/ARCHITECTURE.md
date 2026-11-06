# Architecture

## One repo, one hub, many apps

```
src/
  core/            shared by every app: data model, database, audit log, i18n (NL/EN),
                   session (Gijs/Coen + PIN), backup/merge, UI kit, brand styles
  hub/             the Funqtion Hub home screen + app registry (hub/apps.ts)
  apps/
    bookings/      App 01: Bookings & CRM
      domain/      pure logic with unit tests (pipeline, conflicts, reminders, templates, ics)
      pages/       screens
      components/  app-specific components
    <next-app>/    each future app gets its own folder
  settings/        suite-wide settings
  styles/          design tokens (from funqtion-site) + app styles
src-tauri/         native shell: Windows exe now, iOS/iPadOS later
.github/workflows  CI, Windows exe build, GitHub Pages deploy
```

### Adding a new app

1. Branch off `main` (e.g. `app/invoicing`).
2. Create `src/apps/<id>/` with its own `<Id>App.tsx` and routes.
3. Add its tables in `src/core/db.ts` as a new `this.version(n + 1).stores({...})` block. Existing tables are never redefined, so data from older versions upgrades automatically.
4. Put its types in `src/core/types.ts` (or a `types.ts` in the app folder) and reference shared records by id (`gigId`, `personId`, `organisationId`, `venueId`).
5. Write every change through `save()` / `patch()` from `src/core/repo.ts`, so the audit log covers it.
6. Register it in `src/hub/apps.ts` and add a route in `src/App.tsx`.
7. Merge to `main` → CI builds the web app and a new exe with all apps inside.

### How apps connect

The **gig** is the hub record. Future apps hang off `gigId`:

- Invoicing: copies `quote.lines` into an invoice, then sets the gig's `invoicedAt`/`paidAt` (shown in the pipeline).
- Contracts: created when a gig moves to *Confirmed*.
- Gig-day planner: reads `setSlots`, `contacts`, `venue`, `musicWishes`.
- Gear: packing lists per `eventType`. `setupRequired` and `venue.houseSound` decide what to bring.
- Navigation: reads `venue` addresses for today's gigs, writes back trips (km) for accounting.

## Data and sync

- **Now:** local-first IndexedDB (Dexie). Works offline in the browser, in the exe and on iPhone. Sharing between devices is done with JSON export/import (newest `updatedAt` wins per record).
- **Later (self-host):** every record already has a UUID, `createdAt/By`, `updatedAt/By` and a soft-delete flag, and every change is in the `audit` table. A small sync server (e.g. PocketBase or Postgres on a cheap EU VPS) can replicate these tables without any reshaping. The backup format is also the migration format.

## Desktop and mobile shell

[Tauri 2](https://tauri.app) hosts `dist/` in a native window. It produces a small Windows exe (WebView2, already on Windows 10/11). The same project can build an iOS/iPadOS app with `tauri ios init && tauri ios build` on a Mac with Xcode. Distribution to your own iPhone needs an Apple Developer account (TestFlight). Until then the PWA (Safari → Add to Home Screen) gives a full-screen, offline-capable app.

## Business rules (agreed)

- **VAT:** 0% by default (not VAT-registered). Change it in Settings → Business when that changes.
- **Options ("optie"):** supported, with a default expiry of 14 days (configurable).
- **Double bookings:** the same person can play two gigs on one day only if neither needs build-up (`setupRequired = false`) and there are at least 2 hours between them (configurable). Overlaps and blocked days are hard conflicts. Enquiries, options and sent quotes give soft warnings.
