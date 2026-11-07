# Gear list (temporary)

> **PARTLY TEMPORARY.** The rows marked *Standaard set (bevestigd)* are the confirmed standard set-up (all-in-one DJ controller, light bar with lights and the Laserworld DS-1000 Mk III laser, 2 tops, 1 sub, DJ booth, light & sound rack). Everything marked `TEMP placeholder` is a guess for a typical Funqtion set-up, so the Gear app has something to build and test with. It is **not** your real inventory: names are generic, and brands, models, serial numbers, dates, prices and most owners are empty or `unknown`. Replace it when Gijs and Coen have compiled the real list (send it in any form: a spreadsheet, a photo of a handwritten list, a WhatsApp message; Claude converts it).

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
| `owner` | `gijs` / `coen` / `shared` / `unknown` | Ownership is mixed: some gear is Gijs's, some Coen's, some shared. `unknown` = still to fill in. |
| `home_location` | `home_gijs` / `home_coen` / `unknown` | Gear lives at both homes. |

The app imports this file with *Gear → Instellingen → Startlijst importeren* (or on the empty Gear home screen). Import is by `code`: existing codes are skipped, so re-importing a longer list only adds the new items.
| `transport` | `trailer` / `car` | Gigs go by personal car + trailer. Valuable and fragile things (controller, laptop, laser, headphones, USBs) go in the car. |
| `weight_kg` | number | For the trailer's load total and load order. |
| `container` | code of a container, or empty | Where it's normally packed. |
| `purchase_date` | `yyyy-mm-dd` | Approximate is fine (`2023-01-01`). |
| `purchase_price_eur`, `replacement_value_eur` | number, e.g. `1249.00` | Replacement value = what it costs new today. |
| `electrical` | `class1` (earthed plug) / `class2` (double insulated) / `none` | For safety tests later. |
| `power_w` | number | Power draw, for the power budget per gig. |
| `kits` | `standard`, `dj_controller`, `dj_usb`, `dj_light`, `always`, `outdoor` (several: separate with `;`) | `standard` = the usual full set-up. For venues with their own sound it varies per venue: `dj_controller` = controller only, `dj_usb` = only USB sticks (+ headphones), `dj_light` = controller + a bit of light. `always` = goes to every gig. In the app you pick the set-up per gig. |
| `notes` | text | Rows still marked `TEMP placeholder` have not been checked against the real gear. |

## For Claude (when updating)

- Replace the placeholder rows with the real list; keep the header and column order.
- Keep codes stable for items that already have printed labels; give new items the next free code.
- Split identical unique items into one row each (each gets its own label and serial).
- Remove the "TEMPORARY" note above once nothing is marked `TEMP placeholder` anymore, and update the decisions block in `PLAN.md`.
