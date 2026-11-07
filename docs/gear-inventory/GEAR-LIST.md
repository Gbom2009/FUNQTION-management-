# Gear list (temporary)

> **TEMPORARY.** `gear-list.csv` is a placeholder for a typical Funqtion set-up, so the Gear app has something to build and test with. It is **not** your real inventory: names are generic, and brands, models, serial numbers, dates, prices and most owners are empty or `unknown`. Replace it when Gijs and Coen have compiled the real list (send it in any form: a spreadsheet, a photo of a handwritten list, a WhatsApp message; Claude converts it).

The Gear app (App 5) will import this file on first start (CSV import, see `PLAN.md` §4 MVP). After that the app's own database is the source of truth; this file is only the starting point and a backup-friendly overview.

## Columns

| Column | Values | Notes |
|---|---|---|
| `code` | `FQ-0001` … | Unique. Printed under the QR label. Never reuse a code. |
| `kind` | `unique` / `counted` / `container` | See `PLAN.md` §0.1: unique = own tag; counted = quantity, no tag per piece; container = case/bag, scanning it ticks off what's inside. |
| `name` | text (Dutch is fine) | What you call it at a gig. |
| `category` | `decks`, `mixers`, `laptops`, `headphones`, `speakers`, `subs`, `monitors`, `lighting`, `lasers`, `effects`, `dmx`, `power`, `audio_cables`, `stands`, `cases`, `furniture`, `tools`, `small` | Matches the seeded categories in `PLAN.md` §2.3. |
| `brand`, `model`, `serial` | text | Serial numbers matter for insurance and theft reports. |
| `quantity` | number | `1` for unique items and containers. |
| `owner` | `gijs` / `coen` / `shared` / `unknown` | `unknown` = still to decide. |
| `home_location` | `home_gijs` / `home_coen` / `van` | Gear lives at both homes and goes to gigs in a van. |
| `container` | code of a container, or empty | Where it's normally packed. |
| `purchase_date` | `yyyy-mm-dd` | Approximate is fine (`2023-01-01`). |
| `purchase_price_eur`, `replacement_value_eur` | number, e.g. `1249.00` | Replacement value = what it costs new today. |
| `electrical` | `class1` (earthed plug) / `class2` (double insulated) / `none` | For safety tests later. |
| `power_w` | number | Power draw, for the power budget per gig. |
| `kits` | `dj_only`, `sound_small`, `sound_big`, `light_basic`, `laser`, `always` (several: separate with `;`) | Which standard set-up it belongs to. |
| `notes` | text | Rows still marked `TEMP placeholder` have not been checked against the real gear. |

## For Claude (when updating)

- Replace the placeholder rows with the real list; keep the header and column order.
- Keep codes stable for items that already have printed labels; give new items the next free code.
- Split identical unique items into one row each (each gets its own label and serial).
- Remove the "TEMPORARY" note above once nothing is marked `TEMP placeholder` anymore, and update the decisions block in `PLAN.md`.
