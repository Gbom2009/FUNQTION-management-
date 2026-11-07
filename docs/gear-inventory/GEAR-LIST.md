# Gear list (temporary)

> **PARTLY TEMPORARY.** The rows marked *Standaard set (bevestigd)* are the confirmed standard set-up (all-in-one DJ controller, light bar with lights and the Laserworld DS-1000 Mk III laser, 2 tops, 1 sub, DJ booth, light & sound rack). Everything marked `TEMP placeholder` is a guess for a typical Funqtion set-up, so the Gear app has something to build and test with. It is **not** your real inventory: names are generic, and brands, models, serial numbers, dates, prices and most owners are empty or `unknown`. Replace it when Gijs and Coen have compiled the real list (send it in any form: a spreadsheet, a photo of a handwritten list, a WhatsApp message; Claude converts it).

> 🔒 **Privacy: this repository is public.** This file may only hold the **structure** of the set-up: codes, generic names, categories, kits, which case things sit in, transport and labels. **Never put serial numbers, purchase dates, prices or replacement values in it** (a public list of what you own and what it's worth is a theft risk). Enter those in the app, or put them in a private CSV on your own device (same columns, e.g. `gear-private.csv`; the name pattern `*private*.csv` is git-ignored) and load it with *Gear → Instellingen → Importeer bestand*. A test (`src/apps/gear/domain/privacy.test.ts`) fails the build if these columns are filled in here.

The Gear app (App 5) will import this file on first start (CSV import, see `PLAN.md` §4 MVP). After that the app's own database is the source of truth; this file is only the starting point and a backup-friendly overview.

## Columns

| Column | Values | Notes |
|---|---|---|
| `code` | `FQ-0001` … (existing), new items get tree codes like `FQ-04.2-7` | Unique. Printed under the QR label. Never reuse a code. Codes made in the app follow the case tree (case number + own number) and end in a check character; see `docs/ARCHITECTURE.md`. Rows in this file may keep the old `FQ-0001` style. |
| `kind` | `unique` / `counted` / `container` | See `PLAN.md` §0.1: unique = own tag; counted = quantity, no tag per piece; container = case/bag, scanning it ticks off what's inside. |
| `name` | text (Dutch is fine) | What you call it at a gig. |
| `category` | `decks`, `mixers`, `laptops`, `headphones`, `speakers`, `subs`, `monitors`, `lighting`, `lasers`, `effects`, `dmx`, `power`, `audio_cables`, `stands`, `cases`, `furniture`, `tools`, `small` | Matches the seeded categories in `PLAN.md` §2.3. |
| `brand`, `model`, `serial` | text | Brand and model are fine here. **`serial` stays empty in this file** (private CSV / app only). Serial numbers matter for insurance and theft reports. |
| `quantity` | number | `1` for unique items and containers. |
| `owner` | `gijs` / `coen` / `shared` / `unknown` | Ownership is mixed: some gear is Gijs's, some Coen's, some shared. `unknown` = still to fill in. |
| `home_location` | `home_gijs` / `home_coen` / `unknown` | Gear lives at both homes. |

The app imports this file with *Gear → Instellingen → Startlijst importeren* (or on the empty Gear home screen). Import is by `code`: new codes are added; for existing items only empty fields are filled in (brand, serial, the case it sits in, label…). Nothing you edited in the app is overwritten, and items you took out of a kit are not put back.
| `transport` | `trailer` / `car` | Gigs go by personal car + trailer. Valuable and fragile things (controller, laptop, laser, headphones, USBs) go in the car. |
| `weight_kg` | number | For the trailer's load total and load order. |
| `container` | code of a container, or empty | Where it's normally packed. Containers can sit in containers (a tree): e.g. `FQ-0001` (XDJ-AZ) and `FQ-0014` (its power cable) sit in `FQ-0009` (the flight case). |
| `purchase_date` | `yyyy-mm-dd` | **Empty in this file** (private CSV / app only). Approximate is fine (`2023-01-01`). |
| `purchase_price_eur`, `replacement_value_eur` | number, e.g. `1249.00` | **Empty in this file** (private CSV / app only). Replacement value = what it costs new today. |
| `electrical` | `class1` (earthed plug) / `class2` (double insulated) / `none` | For safety tests later. |
| `power_w` | number | Power draw, for the power budget per gig. |
| `kits` | `standard`, `dj_controller`, `dj_usb`, `dj_light`, `always`, `outdoor` (several: separate with `;`) | `standard` = the usual full set-up. For venues with their own sound it varies per venue: `dj_controller` = controller only, `dj_usb` = only USB sticks (+ headphones), `dj_light` = controller + a bit of light. `always` = goes to every gig. In the app you pick the set-up per gig. |
| `label` | a design: `qr_large`, `qr_large_fq`, `qr_small`, `qr_small_fq`, `barcode`, `barcode_fq` or your own design's id (optional) | Label design (`_fq` = Funqtion style: black label, orange code, logo). Empty = automatic: barcode for cables, large QR for cases and big gear, small QR otherwise. |
| `notes` | text | Rows still marked `TEMP placeholder` have not been checked against the real gear. |

## For Claude (when updating)

- Replace the placeholder rows with the real list; keep the header and column order.
- **Public repo: leave `serial`, `purchase_date`, `purchase_price_eur` and `replacement_value_eur` empty here.** If Gijs sends serials or values, write them to a private CSV for him to import on his device (or tell him to type them in the app), never into this file.
- Keep codes stable for items that already have printed labels. For new rows either give the next free old-style code (`FQ-0051`) or leave the code to the app (it then assigns a tree code with check character when the item is created there).
- Split identical unique items into one row each (each gets its own label and serial).
- Remove the "TEMPORARY" note above once nothing is marked `TEMP placeholder` anymore, and update the decisions block in `PLAN.md`.
