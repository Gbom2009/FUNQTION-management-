# FUNQTION Management

Custom, Funqtion-branded business tools for Team Funqtion (Gijs & Coen), Aarle-Rixtel. **FEEL THE MUSIQ.**

All apps live in this one repository and come together in one **Funqtion Hub**: a single page with a tile for every app. The same code runs as:

| Platform | How | Status |
|---|---|---|
| Web app | `npm run dev` locally, or GitHub Pages from `main` | ✅ |
| Windows `.exe` | Built by GitHub Actions on every push (Tauri) | ✅ |
| iPhone / iPad | Now: install the web app via Safari → *Add to Home Screen*. Later: native app via `tauri ios build` (needs a Mac + Apple Developer account) | 🟡 |

## Apps

| # | App | Status |
|---|---|---|
| 01 | **Bookings & CRM** – enquiries, clients, pipeline, calendar, reminders | ✅ v0.1 |
| 02 | **Quotes & Invoices** – quotes with packages and optional extras, acceptance, deposit/final/cancellation invoices, credit notes, payments, reminders, branded PDFs | ✅ v0.1 ([plan](docs/quotes-invoices/PLAN.md)) |
| 03 | **Money & Accounting** – receipts with on-device OCR, bank import (incl. Revolut), matching, trips, profit per gig, Gijs/Coen split, investments, hours, VAT/year reports, accountant pack | ✅ v0.3 ([plan](docs/money-accounting/PLAN.md)) |
| 04 | Contracts | planned |
| 05 | Gig-day planner | planned |
| 06 | Gear | planned |
| 07 | Client portal | planned |
| 08 | Navigation (link to the existing app) | planned |

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
- [Draft general terms (algemene voorwaarden)](docs/legal/ALGEMENE-VOORWAARDEN.md)
- [Architecture: how the apps fit together](docs/ARCHITECTURE.md)
