import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { LabelPreset } from '../../../core/types';
import { DEFAULT_PRESETS, colors, logoFor, matrixFromSymbol, presetFor, presetWarnings, presetsFrom, qrArt, barcodeArt, PAINT } from './labelArt';
import { barsFromSvg } from './barcode';

type W = typeof import('zxing-wasm/writer');
type R = typeof import('zxing-wasm/reader');
let W: W; let R: R;
beforeAll(async () => {
  W = await import('zxing-wasm/writer');
  R = await import('zxing-wasm/reader');
  await W.prepareZXingModule({ overrides: { wasmBinary: readFileSync('node_modules/zxing-wasm/dist/writer/zxing_writer.wasm') as unknown as ArrayBuffer }, fireImmediately: true });
  await R.prepareZXingModule({ overrides: { wasmBinary: readFileSync('node_modules/zxing-wasm/dist/reader/zxing_reader.wasm') as unknown as ArrayBuffer }, fireImmediately: true });
});

const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));

/**
 * Tiny rasteriser for the shapes our label SVGs use (rects, circles, fills), so the
 * test reads exactly what we draw. The logo itself is left out: its backing box is
 * drawn, which is what the code has to survive.
 */
function raster(svg: string, bg: string, k = 6) {
  const [, w, h] = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)!.map(Number) as unknown as [string, number, number];
  const pad = 8; // extra margin around the symbol (the rest of the label)
  const width = Math.ceil((w + pad * 2) * k); const height = Math.ceil((h + pad * 2) * k);
  const data = new Uint8ClampedArray(width * height * 4);
  const [br, bgc, bb] = hex(bg);
  for (let i = 0; i < width * height; i++) { data[i * 4] = br; data[i * 4 + 1] = bgc; data[i * 4 + 2] = bb; data[i * 4 + 3] = 255; }
  const paint = (x0: number, y0: number, x1: number, y1: number, col: string, inside: (px: number, py: number) => boolean = () => true) => {
    const [r, g, b] = hex(col);
    for (let y = Math.max(0, Math.floor((y0 + pad) * k)); y < Math.min(height, Math.ceil((y1 + pad) * k)); y++) {
      for (let x = Math.max(0, Math.floor((x0 + pad) * k)); x < Math.min(width, Math.ceil((x1 + pad) * k)); x++) {
        if (!inside(x / k - pad, y / k - pad)) continue;
        const o = (y * width + x) * 4; data[o] = r; data[o + 1] = g; data[o + 2] = b;
      }
    }
  };
  const body = svg.replace(/<g transform="translate[\s\S]*?<\/g>(?=<path|<\/svg>|$)/, '');
  let fill = '#000000';
  for (const m of body.matchAll(/<g fill="([^"]+)">|<\/g>|<rect ([^>]*)\/>|<circle ([^>]*)\/>/g)) {
    if (m[1]) { fill = m[1]; continue; }
    if (m[0] === '</g>') { fill = '#000000'; continue; }
    const a = (n: string) => Number((m[2] ?? m[3]).match(new RegExp(`${n}="([\\d.-]+)"`))?.[1] ?? 0);
    const own = (m[2] ?? m[3]).match(/fill="([^"]+)"/)?.[1] ?? fill;
    if (own === 'none') continue;
    if (m[2]) paint(a('x'), a('y'), a('x') + a('width'), a('y') + a('height'), own);
    else { const cx = a('cx'); const cy = a('cy'); const r = a('r'); paint(cx - r, cy - r, cx + r, cy + r, own, (px, py) => (px - cx) ** 2 + (py - cy) ** 2 <= r * r); }
  }
  return { data, width, height, colorSpace: 'srgb' } as ImageData;
}

const variant = (p: Partial<LabelPreset>): LabelPreset => ({ ...DEFAULT_PRESETS[0], ...p });

describe('label designs', () => {
  it('has plain and Funqtion designs per size, keeps built-ins and picks the item preset', () => {
    expect(DEFAULT_PRESETS.map((p) => p.id)).toEqual(['qr_large', 'qr_large_fq', 'qr_small', 'qr_small_fq', 'barcode', 'barcode_fq']);
    const own = { ...DEFAULT_PRESETS[1], id: 'custom_x', name: 'Mine' };
    const list = presetsFrom([own]);
    expect(list.map((p) => p.id)).toContain('qr_small');
    expect(presetFor({ labelPreset: 'custom_x' }, 'qr_small', list).name).toBe('Mine');
    expect(presetFor({ labelType: 'barcode' }, 'qr_small', list).id).toBe('barcode');
    expect(presetFor({}, 'qr_small', list).id).toBe('qr_small');
  });
  it('warns about invisible, low-contrast and inverted codes', () => {
    expect(presetWarnings(variant({ background: 'black', symbol: 'black' }))).toContain('invisible');
    expect(presetWarnings(variant({ background: 'black', symbol: 'orange' }))).toContain('inverted');
    expect(presetWarnings(variant({ background: 'orange', symbol: 'black' }))).toEqual([]);
    expect(presetWarnings(variant({ background: 'black', symbol: 'black', patch: true }))).toEqual([]);
    expect(presetWarnings(variant({ size: 'barcode', background: 'black', symbol: 'white' }))).toEqual([]); // made safe automatically
    expect(colors(DEFAULT_PRESETS[1])).toMatchObject({ bg: PAINT.black, ink: PAINT.orange, accent: PAINT.orange, inverted: true });
  });
  it('recolours the logo for the background', () => {
    const logo = readFileSync('public/logo.svg', 'utf8');
    expect(logoFor(logo, '#ffffff').inner).not.toContain('fill="#ffffff"');
    expect(logoFor(logo, '#f68712').inner).not.toMatch(/fill="#f68712"/i);
    expect(logoFor(logo, '#000000').inner).toContain('fill="#f68712"');
  });

  const cases: [string, Partial<LabelPreset>][] = [
    ['plain', {}],
    ['funqtion: orange on black, rounded, logo, brackets', { background: 'black', symbol: 'orange', modules: 'rounded', logo: true, frame: 'brackets' }],
    ['white dots on black with logo', { background: 'black', symbol: 'white', modules: 'dots', logo: true }],
    ['black on orange', { background: 'orange', symbol: 'black', modules: 'rounded' }],
    ['black on a white patch on a black label', { background: 'black', symbol: 'black', patch: true, logo: true }],
  ];
  for (const [name, p] of cases) {
    it(`QR design scans: ${name}`, async () => {
      const preset = variant(p);
      for (const code of ['FQ-0001', 'FQ-0042', 'FQ-0103', 'FQ-9999', 'FQ-12345']) {
        const sym = await W.writeBarcode(code, { format: 'QRCode', scale: 1, addQuietZones: false, ecLevel: preset.logo ? 'H' : 'M' });
        const svg = qrArt(matrixFromSymbol(sym.symbol), preset, '<svg viewBox="0 0 10 10"><rect width="10" height="10" fill="#f68712"/></svg>');
        const read = await R.readBarcodes(raster(svg, colors(preset).bg), { formats: ['QRCode'], tryInvert: true });
        expect(read[0]?.text).toBe(code);
      }
    });
  }
  for (const [name, p] of [['plain', {}], ['white patch on black', { background: 'black', symbol: 'black', patch: true }], ['orange bars on black (made safe: white panel)', { background: 'black', symbol: 'orange' }]] as [string, Partial<LabelPreset>][]) {
    it(`barcode design scans: ${name}`, async () => {
      const preset = variant({ ...p, size: 'barcode' });
      const sym = await W.writeBarcode('FQ-0042', { format: 'Code128', scale: 1, addQuietZones: false });
      const svg = barcodeArt(barsFromSvg(sym.svg), preset);
      const read = await R.readBarcodes(raster(svg, colors(preset).bg, 3), { formats: ['Code128'], tryInvert: true });
      expect(read[0]?.text).toBe('FQ-0042');
    });
  }
});
