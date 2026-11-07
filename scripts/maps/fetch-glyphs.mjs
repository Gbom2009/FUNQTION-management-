// Bundles the MapLibre glyph ranges our style uses, so map labels work offline.
// Noto Sans — SIL Open Font License. Source: OpenFreeMap font server (one-off, 6 small files).
// Run once:  npm run data:glyphs
import { mkdirSync, writeFileSync } from "node:fs";

const FONTS = ["Noto Sans Regular", "Noto Sans Bold"];
// Basic Latin + Latin-1, Latin Extended-A/B (ë, ĳ, ś…), General Punctuation (– … ’ €)
const RANGES = ["0-255", "256-511", "8192-8447"];

for (const font of FONTS) {
  const dir = new URL(`../../public/maps/fonts/${font}/`, import.meta.url);
  mkdirSync(dir, { recursive: true });
  for (const range of RANGES) {
    const url = `https://tiles.openfreemap.org/fonts/${encodeURIComponent(font)}/${range}.pbf`;
    const r = await fetch(url, { headers: { "User-Agent": "FunqtionMaps/0.1 (glyph bundle build)" } });
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    writeFileSync(new URL(`${range}.pbf`, dir), buf);
    console.log(`${font}/${range}.pbf ${(buf.length / 1024).toFixed(0)} KB`);
  }
}
