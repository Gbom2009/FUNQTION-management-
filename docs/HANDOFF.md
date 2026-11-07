# Handoff: what isn't in the original prompts

Short report for the next Claude Code session on this repo. The original prompts asked for **plans** for apps 1–3. Everything below came up *later* in the conversation (answers, decisions, state and gotchas) and isn't visible from those prompts. Read this before changing anything.

## 1. Decisions made by Gijs (they override the plans)

| Topic | Decision |
|---|---|
| Delivery | Build and **merge** each app (not just plan it). One repo, one **Funqtion Hub** page with all apps. Web app now. A **Windows exe on every push**. iPhone/iPad app later (Tauri iOS, or the PWA for now). |
| Storage | **Local-first, no server** ("localhost"). IndexedDB via Dexie. A self-hosted/home server (PocketBase + Tailscale) is "maybe later, undecided". |
| Legal / tax | **Not registered** (no KvK, no VAT); plans to register within ~3 years. Business mode = `private` (no VAT on documents). KOR/VAT modes exist but are off. |
| Language & brand | **Dutch + English** UI. Brand tokens, logo and fonts are copied from the public repo `Gbom2009/funqtion-site` (orange `#f68712`, JetBrains Mono, Archivo Black). |
| Bookings | "Optie" (hold) stage included. **Double booking:** same person, same day only if **no build-up** and **≥ 2 h** between gigs. |
| Money | Bank probably **Revolut**. Profit split **50/50 but adjustable** (dated rules, fixed % or by lineup). Both have **jobs**, so hours tracking is light. |
| Sensitive data | The **IBAN** is entered by the user on the device (Settings), never in code or on GitHub. They own a domain, which isn't used yet. |
| Contracts | Built in local mode (v0.4.0). Quote + contract **per event type** (together / after quote / none). **Softer consumer cancellation scale**. **Automatic countersigning**. Photo/video **opt-out**. Details at the top of `docs/contracts/PLAN.md`. |
| Gear (app 5) | **One gig phone** per gig (no sync yet). Both phones are **iPhones** → QR only. Gear at **both homes**; transport by **personal car + trailer** (no van). Gig phone chosen **per gig**. Ownership **mixed** (Gijs / Coen / shared). Standard set: all-in-one controller, light bar with Gijs's **Laserworld DS-1000 Mk III (class 4)**, 2 tops, 1 sub, DJ booth, light & sound rack. **A4** weatherproof labels. Safety tests **off for now**. Rentals **rare**. **No business insurance** yet. Temporary gear list: `docs/gear-inventory/gear-list.csv` (replace when Gijs sends the real list; format in `GEAR-LIST.md`). |
| Gear details | Trailer **750 kg** max (no own registration), no trailer lock, **hitch lock** when unattended, never left loaded overnight. DJ-only set-ups vary per venue (controller / USB / controller + light). Laser above heads; audience scanning only at private parties **with permission** (recorded per gig). **Gear tree** (cases in cases); load by case, unload item by item; labels QR large / QR small / barcode per item; handheld scanner support (v0.6.0). Label designs incl. Funqtion style (black/orange, logo in the QR) with live preview (v0.7.0). |
| Terms | Gijs asked for draft general terms: `docs/legal/ALGEMENE-VOORWAARDEN.md` and `src/apps/invoicing/terms.ts`. **Draft, not legally reviewed.** |

## 2. Still unanswered / to do

- **GitHub Pages:** the workflow publishes to the `gh-pages` branch, but Pages must be enabled once by Gijs: Settings → Pages → *Deploy from a branch* → `gh-pages` / root. As of the last check, `has_pages` was false.
- **Default branch** may still be the `claude/...` branch. Ask Gijs to set it to `main`.
- **Navigation app:** how it's built is unknown (asked twice). Trips use manual km plus a per-venue memory.
- **Existing gear list** (for investments/assets) and **real price list** not given. The seeded prices (e.g. €150/h DJ set) are placeholders.
- Items marked ⚖️ in the plans (9% vs 21% VAT for DJ sets, VAT on cancellation fees, deductions) need an accountant **once they register**.
- App 4 (Contracts) is built in local mode. Not done: online signing relay, automatic e-mail, the remaining open questions in `docs/contracts/PLAN.md` §11 (rider contents, insurance, legal names, lawyer review). Existing devices keep their stored terms text: App 2 settings shows a button to take over version 2026-12. App 5 (Gear & Inventory) is built in local mode (v0.5.0). Its gear list `docs/gear-inventory/gear-list.csv` is still partly a placeholder, and the rack contents (`RACK-CONTENTS.md`) are open; update both when Gijs sends them. App 6 (Gig Day) has a functional plan in `docs/gig-day/PLAN.md` (no code yet; open questions in §9, incl. how the navigation app is built and whether to build the sync server now). Apps 7–8 (portal, navigation link) aren't started. No sync server yet.

## 3. Conventions in the code

- Every write goes through `save()` / `patch()` in `src/core/repo.ts`. That's what keeps the audit log ("who changed what") complete.
- **Dexie versions are add-only** (`src/core/db.ts`, currently v1–v3). New tables go in a new `version(n)` block. Add them to `DATA_TABLES` for backup/merge.
- **i18n:** `src/core/i18n/nl.ts` is the typed source. `en.ts` must have every key (`tsc` enforces this).
- Money in **cents**. Dates are local `yyyy-mm-dd`, times `HH:mm` (an end time earlier than the start time means the next day).
- **Invoice numbers:** gapless, **one series per member** (`F2026-G-0001`, `F2026-C-0001`) because there's no server. Finalised invoices are immutable; corrections are credit notes.
- **Contract versions and signatures are immutable** (guarded in `repo.ts`). Changes after signing are addenda.
- `runTaskSync()` returns the in-flight run; tests that trigger it should `await runTaskSync()` in `afterEach` before the next test swaps the database.
- **Reports are computed, never stored** (`src/apps/money/domain/ledger.ts`).
- **OCR:** Tesseract assets are copied to `public/ocr` (gitignored) by `scripts/copy-ocr.mjs` (runs before dev/build/test). pdfmake and OCR are lazy-loaded.
- **Backups v2:** a ZIP with receipt photos, optionally AES-GCM encrypted. v1 JSON still imports.
- **Checks before every PR:** `npm run typecheck`, `npm test` (65 tests), `npm run build`, `cargo check` in `src-tauri`, plus a Playwright run of the main flow. Merge only after CI and the exe build are green.
- **Git:** work on the designated branch. After a PR is merged, restart the branch from `origin/main` (fast-forward push; force-push is blocked). Commit and PR attribution lines are required by the environment.

## 4. Known limitations

- No server, so no online quote acceptance, payment links, "viewed" tracking or automatic e-mail. Acceptance and payments are recorded by hand. Messages go out via share sheet, mailto or WhatsApp links.
- The web app and the exe have **separate storage**. Sharing between devices is done with backup export/import.
- OCR was tested on rendered receipts only, not on real phone photos. PDF receipts aren't OCR'd.
- The exe is built in CI but was never opened on a real Windows machine by Claude.

## 5. Gotchas already hit

- OCR misreads "21%" as "214". The parser now derives the rate from the amounts.
- A global `sed` on `Cargo.lock` changed other crates' versions. Only edit the `funqtion` package entry.
- `git push` sometimes returns GitHub 500 errors. Retry with backoff.
- The old Actions-based Pages deploy failed because Pages wasn't enabled. That's why it was switched to `gh-pages`.
