# FUNQTION Management

Custom, Funqtion-branded business tools for Team Funqtion (Gijs & Coen), Aarle-Rixtel. **FEEL THE MUSIQ.**

All apps live in this one repository and come together in one **Funqtion Hub**: a single page with a tile for every app. The same code runs as:

| Platform | How | Status |
|---|---|---|
| Web app | **https://gbom2009.github.io/FUNQTION-management-/** (published from `main` on every merge), or `npm run dev` locally | ✅ |
| Windows `.exe` | Built by GitHub Actions on every push (Tauri) | ✅ |
| iPhone / iPad | Now: install the web app via Safari → *Add to Home Screen*. Later: native app via `tauri ios build` (needs a Mac + Apple Developer account) | 🟡 |

## Apps

| # | App | Status |
|---|---|---|
| 01 | **Bookings & CRM** – enquiries, clients, pipeline, calendar, reminders | ✅ v0.1 |
| 02 | **Quotes & Invoices** – quotes with packages and optional extras, acceptance, deposit/final/cancellation invoices, credit notes, payments, reminders, branded PDFs | ✅ v0.1 ([plan](docs/quotes-invoices/PLAN.md)) |
| 03 | **Money & Accounting** – receipts with on-device OCR, bank import (incl. Revolut), matching, trips, profit per gig, Gijs/Coen split, investments, hours, VAT/year reports, accountant pack | ✅ v0.3 ([plan](docs/money-accounting/PLAN.md)) |
| 04 | **Contracts** – contracts from the accepted quote, riders, signing | ✅ ([plan](docs/contracts/PLAN.md)) |
| 05 | **Gear & Inventory** – register, QR labels, kits, packing lists, maintenance, laser checklist | ✅ v0.5 ([plan](docs/gear-inventory/PLAN.md)) |
| 06 | **Gig Day** – timeline, tasks, Booth mode, wrap-up | ✅ v0.9 ([plan](docs/gig-day/PLAN.md)) |
| 07–09 | **Library, Sets, Requests** | plan ([plan](docs/music/PLAN.md)) |
| 10 | **Lights** – DMX scenes, moment buttons, beat sync, laser safety | plan ([plan](docs/stage-and-clients/PLAN.md)) |
| 11 | **Promo** – Instagram calendar, media library, post drafts, consents, video briefs | ✅ v0.10 ([plan](docs/stage-and-clients/PLAN.md)) |
| 12 | **Press Kit** – public EPK pages for the website, PDF, SEO basics | ✅ v0.11 ([plan](docs/stage-and-clients/PLAN.md)) |
| 13 | **Client Portal** – private page per gig: quote, contract, invoices, music wishes | plan ([plan](docs/stage-and-clients/PLAN.md)) |
| 14 | **Feedback** – post-gig feedback form, testimonials, review prompt | plan ([plan](docs/stage-and-clients/PLAN.md)) |
| – | **Navigatie** (Maps, merged from FQ-maps) | ✅ v0.8 ([plan](docs/maps/PLAN.md)) |

## Getting the Windows exe

1. Open the repository on GitHub → **Actions** → **Desktop (Windows exe)**.
2. Open the latest run → **Artifacts** → download `Funqtion-windows-…`.
3. Inside: `Funqtion-portable.exe` (just run it), an installer (`…-setup.exe`) and an `.msi`.

To build one for a specific branch: **Run workflow** on that page. Pushing a tag like `v0.2.0` also creates a GitHub Release with the files attached.

## Development

```bash
npm install
npm run dev          # web app on http://localhost:5173
npm test             # unit tests (pipeline, conflicts, reminders, audit, backup)
npm run build        # production web build in dist/
npm run desktop:dev  # desktop window (needs Rust + platform WebView)
```

## Data

Local-first: everything is stored on the device (IndexedDB) and works offline. Until a self-hosted server exists, Gijs and Coen share data through **Settings → Data & backup**: export a backup (a ZIP including receipt photos, optionally encrypted with a passphrase) on one device and import it on the other (newest change per item wins). Note that the web app and the exe have separate storage. **Make regular backups**: financial records must be kept for 7 years.

## Docs

- [Bookings & CRM — functional plan](docs/bookings-crm/PLAN.md)
- [Quotes & Invoices — functional plan](docs/quotes-invoices/PLAN.md)
- [Money & Accounting — functional plan](docs/money-accounting/PLAN.md)
- [Music: Library, Sets & Requests (apps 7–9) — functional plan](docs/music/PLAN.md)
- [Lights, Promo, Press Kit, Client Portal & Feedback (apps 10–14) — functional plan](docs/stage-and-clients/PLAN.md)
- [Draft general terms (algemene voorwaarden)](docs/legal/ALGEMENE-VOORWAARDEN.md)
- [Architecture: how the apps fit together](docs/ARCHITECTURE.md)
