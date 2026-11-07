import type { LabelPreset, LabelType, Paint } from '../../../core/types';
export type { LabelPreset, Paint };
import type { Bars } from './barcode';

// Label designs ("presets"): colours, QR module shape, Funqtion logo in the
// middle, corner brackets, which text lines to print. The QR code and barcode
// are drawn here as SVG from the raw module grid, so the PDF and the live
// preview in the app look exactly the same. Pure: no zxing, no pdfmake.

export const BLACK = '#000000';
export const WHITE = '#ffffff';
export const ORANGE = '#f68712';
export const PAINT: Record<Paint, string> = { black: BLACK, white: WHITE, orange: ORANGE };


const base = (id: string, name: string, size: LabelType, p: Partial<LabelPreset> = {}): LabelPreset => ({
  id, name, size, background: 'white', symbol: 'black', patch: false, modules: 'square', logo: false, frame: 'none',
  showCode: true, showName: true, showOwner: size === 'qr_large', showTagline: false, repeat: 2, barHeight: 'mid', ...p,
});

/** Built-in designs: plain (best for scanning) and Funqtion style (black label, orange code) per size. */
export const DEFAULT_PRESETS: LabelPreset[] = [
  base('qr_large', 'QR groot', 'qr_large'),
  base('qr_large_fq', 'QR groot · Funqtion', 'qr_large', { background: 'black', symbol: 'orange', modules: 'rounded', logo: true, frame: 'brackets', showTagline: true }),
  base('qr_small', 'QR klein', 'qr_small'),
  base('qr_small_fq', 'QR klein · Funqtion', 'qr_small', { background: 'black', symbol: 'orange', modules: 'rounded', logo: true }),
  base('barcode', 'Barcode (kabel)', 'barcode'),
  base('barcode_fq', 'Barcode · Funqtion', 'barcode', { background: 'black', symbol: 'black', patch: true, logo: true }),
];

export function presetsFrom(saved?: LabelPreset[]): LabelPreset[] {
  const list = saved?.length ? saved : DEFAULT_PRESETS;
  // Built-ins can be edited but never disappear.
  return [...list, ...DEFAULT_PRESETS.filter((d) => !list.some((x) => x.id === d.id))];
}

/** Which preset an item uses: its own choice, else the plain preset of its label size. */
export function presetFor(item: { labelPreset?: string; labelType?: LabelType }, fallbackSize: LabelType, presets: LabelPreset[]): LabelPreset {
  return presets.find((p) => p.id === item.labelPreset) ?? presets.find((p) => p.id === (item.labelType ?? fallbackSize)) ?? DEFAULT_PRESETS[0];
}

// ---------------------------------------------------------------------------
// Colours and scan safety

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

export function colors(p: LabelPreset) {
  const bg = PAINT[p.background];
  const ink = PAINT[p.symbol];
  const behind = p.patch ? WHITE : bg;            // what the code sits on
  const text = p.background === 'black' ? WHITE : BLACK;
  const accent = p.background === 'black' ? ORANGE : p.background === 'orange' ? BLACK : ORANGE;
  return { bg, ink, behind, text, accent, inverted: lum(ink) > lum(behind), ratio: contrast(ink, behind) };
}

export type PresetWarning = 'invisible' | 'lowContrast' | 'inverted' | 'dotsSmall';

/** What to tell the user before printing a design. */
export function presetWarnings(p0: LabelPreset): PresetWarning[] {
  const p = barcodeSafe(p0);
  const c = colors(p);
  const w: PresetWarning[] = [];
  if (c.ratio < 1.5) w.push('invisible');
  else if (c.ratio < 3) w.push('lowContrast');
  if (c.inverted && c.ratio >= 1.5) w.push('inverted');
  if (p.size === 'qr_small' && p.modules === 'dots') w.push('dotsSmall');
  return w;
}

// ---------------------------------------------------------------------------
// Logo

/** The Funqtion logo (public/logo.svg) recoloured for a background, as inner SVG + its viewBox. */
export function logoFor(svg: string, onColor: string): { inner: string; viewBox: string } {
  const viewBox = svg.match(/viewBox="([^"]+)"/)?.[1] ?? '0 0 100 100';
  let inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  if (onColor === WHITE) inner = inner.replace(/fill="#ffffff"/gi, `fill="${BLACK}"`);
  else if (onColor === ORANGE) inner = inner.replace(/fill="#ffffff"/gi, `fill="${BLACK}"`).replace(/fill="#f68712"/gi, `fill="${BLACK}"`);
  return { inner, viewBox };
}

function placeLogo(logo: { inner: string; viewBox: string }, x: number, y: number, size: number): string {
  const [vx, vy, vw, vh] = logo.viewBox.split(/[\s,]+/).map(Number);
  const s = size / Math.max(vw, vh);
  return `<g transform="translate(${x} ${y}) scale(${s}) translate(${-vx} ${-vy})">${logo.inner}</g>`;
}

// ---------------------------------------------------------------------------
// QR code

/** zxing symbol (0 = dark module) → square grid of booleans. */
export function matrixFromSymbol(sym: { width: number; height: number; data: ArrayLike<number> }): { size: number; dark: boolean[] } {
  const dark: boolean[] = [];
  for (let i = 0; i < sym.width * sym.height; i++) dark.push(sym.data[i] === 0);
  return { size: sym.width, dark };
}

const QUIET = 4;

/**
 * QR code as SVG (units = modules, incl. a 4-module quiet zone). The three finder
 * squares stay solid (rounded when the modules are rounded/dots) so phones lock on
 * fast; the logo needs error-correction level H, which the generator uses for it.
 */
export function qrArt(m: { size: number; dark: boolean[] }, p: LabelPreset, logoSvg?: string): string {
  const c = colors(p);
  const n = m.size;
  const W = n + QUIET * 2;
  const parts: string[] = [];
  if (p.patch) parts.push(`<rect x="0" y="0" width="${W}" height="${W}" rx="1.2" fill="${WHITE}"/>`);
  const inFinder = (x: number, y: number) => (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);
  // Logo ≈ 26 % of the width (odd), but it must stay clear of the alignment square that
  // QR version 2+ has near the bottom-right (it starts 9 modules from the edge).
  const want = Math.round(n * 0.26) | 1;
  const room = n >= 25 ? (n - 20) | 1 : want;
  const L = p.logo && logoSvg ? Math.max(3, Math.min(want, room)) : 0;
  const l0 = Math.floor((n - L) / 2);   // whole modules: the cleared area and its box line up exactly
  const inLogo = (x: number, y: number) => L > 0 && x >= l0 && x < l0 + L && y >= l0 && y < l0 + L;
  const mods: string[] = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (!m.dark[y * n + x] || inFinder(x, y) || inLogo(x, y)) continue;
    const X = x + QUIET; const Y = y + QUIET;
    if (p.modules === 'dots') mods.push(`<circle cx="${X + 0.5}" cy="${Y + 0.5}" r="0.42"/>`);
    else if (p.modules === 'rounded') mods.push(`<rect x="${X + 0.05}" y="${Y + 0.05}" width="0.9" height="0.9" rx="0.3"/>`);
    else mods.push(`<rect x="${X}" y="${Y}" width="1.02" height="1.02"/>`);
  }
  parts.push(`<g fill="${c.ink}">${mods.join('')}</g>`);
  const r = p.modules === 'square' ? 0 : 1.6;
  for (const [fx, fy] of [[0, 0], [n - 7, 0], [0, n - 7]]) {
    const X = fx + QUIET; const Y = fy + QUIET;
    parts.push(`<rect x="${X}" y="${Y}" width="7" height="7" rx="${r}" fill="${c.ink}"/>`,
      `<rect x="${X + 1}" y="${Y + 1}" width="5" height="5" rx="${r * 0.6}" fill="${c.behind}"/>`,
      `<rect x="${X + 2}" y="${Y + 2}" width="3" height="3" rx="${r * 0.4}" fill="${c.ink}"/>`);
  }
  if (L && logoSvg) {
    const X = l0 + QUIET; const Y = l0 + QUIET;
    parts.push(`<rect x="${X}" y="${Y}" width="${L}" height="${L}" rx="0.8" fill="${c.behind}"/>`);
    parts.push(placeLogo(logoFor(logoSvg, c.behind), X + 0.4, Y + 0.4, L - 0.8));
  }
  if (p.frame === 'brackets') {
    const a = 3.2; const s = 0.55; const o = 0.6; const e = W - o;
    parts.push(`<path d="M${o} ${o + a}V${o}H${o + a}M${e - a} ${o}H${e}V${o + a}M${e} ${e - a}V${e}H${e - a}M${o + a} ${e}H${o}V${e - a}" fill="none" stroke="${c.accent}" stroke-width="${s}"/>`);
  } else if (p.frame === 'line') {
    parts.push(`<rect x="0.4" y="0.4" width="${W - 0.8}" height="${W - 0.8}" rx="1" fill="none" stroke="${c.accent}" stroke-width="0.5"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}" viewBox="0 0 ${W} ${W}">${parts.join('')}</svg>`;
}

// ---------------------------------------------------------------------------
// Barcode

export const BAR_HEIGHT: Record<LabelPreset['barHeight'], number> = { low: 20, mid: 30, high: 40 };

/** Code 128 as SVG (units = modules), with a 10-module quiet zone on each side. */
export function barcodeArt(b: Bars, p0: LabelPreset): string {
  const p = barcodeSafe(p0);
  const c = colors(p);
  const h = BAR_HEIGHT[p.barHeight];
  const q = 10;
  const W = b.modules + q * 2;
  const rects = b.bars.map(([x, w]) => `<rect x="${x + q}" y="2" width="${w}" height="${h}"/>`).join('');
  const patch = p.patch ? `<rect x="0" y="0" width="${W}" height="${h + 4}" rx="1.5" fill="${WHITE}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h + 4}" viewBox="0 0 ${W} ${h + 4}" preserveAspectRatio="none">${patch}<g fill="${c.ink}">${rects}</g></svg>`;
}

/**
 * Barcode readers don't read light bars on a dark background, so barcodes always
 * print dark bars on a light background: on a black label they get a white panel.
 */
export function barcodeSafe(p: LabelPreset): LabelPreset {
  if (p.size !== 'barcode') return p;
  const symbol: Paint = p.symbol === 'white' ? 'black' : p.symbol;
  const probe = { ...p, symbol };
  return colors(probe).inverted || colors(probe).ratio < 3 ? { ...probe, symbol: 'black', patch: true } : probe;
}

/** Small stand-alone logo for barcode strips and previews. */
export function logoArt(p: LabelPreset, logoSvg: string): string {
  const c = colors(p);
  const logo = logoFor(logoSvg, c.bg);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">${placeLogo(logo, 0, 0, 40)}</svg>`;
}
