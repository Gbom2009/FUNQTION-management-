// Musical keys ↔ Camelot. DJ software writes keys in many notations: "Am",
// "A minor", "8A", Open Key "1m", "Abm"/"G#m". Everything is stored as Camelot.

const PC: Record<string, number> = { C: 0, 'B#': 0, 'C#': 1, DB: 1, D: 2, 'D#': 3, EB: 3, E: 4, FB: 4, F: 5, 'E#': 5, 'F#': 6, GB: 6, G: 7, 'G#': 8, AB: 8, A: 9, 'A#': 10, BB: 10, B: 11, CB: 11 };
const NAMES_MAJOR = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const NAMES_MINOR = ['Cm', 'C#m', 'Dm', 'D#m', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm'];

/** Camelot number (1–12) of a major key with this tonic (pitch class 0 = C). */
const majorNumber = (pc: number) => ((((pc * 7) % 12) + 7) % 12) + 1;

export function camelotFromPitch(pc: number, minor: boolean): string {
  const n = majorNumber(minor ? (pc + 3) % 12 : pc);
  return `${n}${minor ? 'A' : 'B'}`;
}

/** Any common notation → Camelot ("8A"), or undefined. */
export function toCamelot(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const s = raw.trim();
  let m = /^0?(1[0-2]|[1-9])\s*([ABab])$/.exec(s);
  if (m) return `${Number(m[1])}${m[2].toUpperCase()}`;
  m = /^(1[0-2]|[1-9])\s*([dmDM])$/.exec(s); // Open Key: 1d = C (8B), 1m = Am (8A)
  if (m) {
    const n = ((Number(m[1]) - 1 + 7) % 12) + 1;
    return `${n}${m[2].toLowerCase() === 'd' ? 'B' : 'A'}`;
  }
  m = /^([A-Ga-g])\s*([#♯b♭]?)\s*(m|min|minor|maj|major|M)?$/.exec(s.replace(/\s+/g, ' '));
  if (m) {
    const acc = m[2] === '♯' ? '#' : m[2] === '♭' ? 'b' : m[2];
    const pc = PC[(m[1] + acc).toUpperCase()];
    if (pc == null) return undefined;
    const minor = !!m[3] && /^m(in(or)?)?$/.test(m[3]);
    return camelotFromPitch(pc, minor);
  }
  return undefined;
}

export function parseCamelot(c?: string): { n: number; minor: boolean } | undefined {
  const m = c ? /^(1[0-2]|[1-9])([AB])$/.exec(c) : null;
  return m ? { n: Number(m[1]), minor: m[2] === 'A' } : undefined;
}

/** Camelot → musical name ("8A" → "Am"), for exports that want it. */
export function musicalKey(c?: string): string | undefined {
  const p = parseCamelot(c);
  if (!p) return undefined;
  const majorPc = [...Array(12).keys()].find((pc) => majorNumber(pc) === p.n)!;
  return p.minor ? NAMES_MINOR[(majorPc + 9) % 12] : NAMES_MAJOR[majorPc];
}

/** Key after pitching by `pct` percent (keylock off): ±6% ≈ ±1 semitone. */
export function shiftedKey(c: string | undefined, pct: number): string | undefined {
  const p = parseCamelot(c);
  if (!p) return c;
  const semis = Math.round(12 * Math.log2(1 + pct / 100));
  if (!semis) return c;
  // one semitone up = +7 on the Camelot wheel
  const n = ((((p.n - 1 + semis * 7) % 12) + 12) % 12) + 1;
  return `${n}${p.minor ? 'A' : 'B'}`;
}

/**
 * Harmonic compatibility (0–1): same key 1, ±1 0.9, relative major/minor 0.85,
 * +2 "energy boost" 0.6, diagonal (±1 and switch) 0.5, else 0.1.
 */
export function keyScore(a?: string, b?: string): number {
  const x = parseCamelot(a), y = parseCamelot(b);
  if (!x || !y) return 0.5; // unknown: neutral
  const d = (((y.n - x.n) % 12) + 12) % 12; // 0..11 clockwise
  const step = Math.min(d, 12 - d);
  if (x.minor === y.minor) return step === 0 ? 1 : step === 1 ? 0.9 : d === 2 ? 0.6 : 0.1;
  return step === 0 ? 0.85 : step === 1 ? 0.5 : 0.1;
}

/** The standard Camelot wheel colours (key chip only). */
export const CAMELOT_COLORS = ['#56f1da', '#7df29a', '#a6ef6c', '#d6e75e', '#f6c96b', '#f7a07d', '#f584a3', '#e780c8', '#c582ea', '#9a8df6', '#76a9f6', '#5dcff1'];
export const keyColor = (c?: string) => { const p = parseCamelot(c); return p ? CAMELOT_COLORS[p.n - 1] : undefined; };
