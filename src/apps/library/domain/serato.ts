// Serato file formats we read and write. All tag-length-value: a 4-byte ASCII
// tag, a 4-byte big-endian length, then the data. Strings are UTF-16BE.
// - Crates (_Serato_/Subcrates/<name>.crate): we write new ones (Serato closed),
//   djay Pro reads them too.
// - "Serato Markers2" (GEOB frame in the file): hot cues, read-only for us.
// - History sessions (_Serato_/History/Sessions/*.session): what was loaded on a
//   deck and when. Field ids from community parsers ⚠️: verify on your Mac.

const enc = new TextEncoder();

function utf16be(s: string): Uint8Array {
  const out = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); out[i * 2] = c >> 8; out[i * 2 + 1] = c & 0xff; }
  return out;
}
const fromUtf16be = (b: Uint8Array) => new TextDecoder('utf-16be').decode(b);

function tlv(tag: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + data.length);
  out.set(enc.encode(tag), 0);
  new DataView(out.buffer).setUint32(4, data.length);
  out.set(data, 8);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const n = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export function* readTlv(b: Uint8Array): Generator<{ tag: string; data: Uint8Array }> {
  let o = 0;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  while (o + 8 <= b.length) {
    const tag = String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
    const len = dv.getUint32(o + 4);
    if (o + 8 + len > b.length) return;
    yield { tag, data: b.subarray(o + 8, o + 8 + len) };
    o += 8 + len;
  }
}

/**
 * A crate file. Paths are relative to the root of the drive the crate lives on,
 * without a leading slash ("Users/gijs/Music/a.mp3", or "Music/a.mp3" on a USB drive).
 */
export function writeCrate(paths: string[]): Uint8Array {
  const parts = [tlv('vrsn', utf16be('1.0/Serato ScratchLive Crate'))];
  for (const col of ['song', 'artist', 'bpm', 'key']) {
    parts.push(tlv('ovct', concat([tlv('tvcn', utf16be(col)), tlv('tvcw', utf16be('0'))])));
  }
  for (const p of paths) parts.push(tlv('otrk', tlv('ptrk', utf16be(p.replace(/^\/+/, '')))));
  return concat(parts);
}

export function readCrate(b: Uint8Array): string[] {
  const out: string[] = [];
  for (const t of readTlv(b)) {
    if (t.tag !== 'otrk') continue;
    for (const inner of readTlv(t.data)) if (inner.tag === 'ptrk') out.push(fromUtf16be(inner.data));
  }
  return out;
}

/** Crate file name for a (sub)crate: Serato uses "%%" between parent and child. */
export const crateFileName = (path: string[]) => `${path.map((p) => p.replace(/[\\/:*?"<>|%]/g, '')).join('%%')}.crate`;

/** Path stored in a crate for a file on macOS: relative to the volume root. */
export function cratePath(absPath: string): string {
  const m = /^\/Volumes\/[^/]+\/(.*)$/.exec(absPath);
  return (m ? m[1] : absPath).replace(/^\/+/, '');
}

// ---- Serato Markers2 (hot cues) ----------------------------------------------

/** Decode the GEOB "Serato Markers2" payload into hot cues. */
export function readMarkers2(geob: Uint8Array): { index: number; atMs: number; name?: string; color?: string }[] {
  // GEOB: encoding, mime\0, filename\0, description\0, data
  let o = 1;
  const skipZ = () => { while (o < geob.length && geob[o] !== 0) o++; o++; };
  skipZ(); skipZ();
  const descStart = o; skipZ();
  const desc = new TextDecoder('latin1').decode(geob.subarray(descStart, o - 1));
  if (desc !== 'Serato Markers2') return [];
  const data = geob.subarray(o);
  if (data[0] !== 1 || data[1] !== 1) return [];
  const b64 = new TextDecoder('latin1').decode(data.subarray(2)).replace(/[^A-Za-z0-9+/]/g, '');
  const pad = b64.length % 4 === 1 ? b64.slice(0, -1) : b64;
  const bin = Uint8Array.from(atob(pad + '='.repeat((4 - (pad.length % 4)) % 4)), (c) => c.charCodeAt(0));
  const cues: { index: number; atMs: number; name?: string; color?: string }[] = [];
  let p = 2; // version 1,1
  const dv = new DataView(bin.buffer);
  while (p < bin.length) {
    let q = p; while (q < bin.length && bin[q] !== 0) q++;
    const type = new TextDecoder('latin1').decode(bin.subarray(p, q));
    if (!type) break;
    const len = dv.getUint32(q + 1);
    const body = bin.subarray(q + 5, q + 5 + len);
    if (type === 'CUE' && body.length >= 13) {
      const bd = new DataView(body.buffer, body.byteOffset, body.byteLength);
      // 00 | index | position ms (u32) | 00 | colour RGB | 00 00 | name \0
      let e = 12; while (e < body.length && body[e] !== 0) e++;
      cues.push({
        index: body[1], atMs: bd.getUint32(2),
        color: `#${[body[7], body[8], body[9]].map((x) => x.toString(16).padStart(2, '0')).join('')}`,
        name: new TextDecoder('utf-8').decode(body.subarray(12, e)) || undefined,
      });
    }
    p = q + 5 + len;
  }
  return cues.sort((a, b) => a.index - b.index);
}

/** Build a Markers2 GEOB payload (used by the tests to check the reader). */
export function buildMarkers2(cues: { index: number; atMs: number; name?: string; color?: [number, number, number] }[]): Uint8Array {
  const entries: number[] = [1, 1];
  for (const c of cues) {
    const name = enc.encode(c.name ?? '');
    const body = [0, c.index, (c.atMs >>> 24) & 0xff, (c.atMs >>> 16) & 0xff, (c.atMs >>> 8) & 0xff, c.atMs & 0xff, 0, ...(c.color ?? [204, 0, 0]), 0, 0, ...name, 0];
    entries.push(...enc.encode('CUE'), 0, (body.length >>> 24) & 0xff, (body.length >>> 16) & 0xff, (body.length >>> 8) & 0xff, body.length & 0xff, ...body);
  }
  entries.push(0);
  const b64 = btoa(String.fromCharCode(...entries));
  const head = [0, ...enc.encode('application/octet-stream'), 0, 0, ...enc.encode('Serato Markers2'), 0, 1, 1];
  return new Uint8Array([...head, ...enc.encode(b64)]);
}

// ---- History sessions ---------------------------------------------------------

export interface SeratoPlay { path?: string; title?: string; artist?: string; bpm?: string; key?: string; startedAt?: number; endedAt?: number; deck?: number }

const FIELD = { path: 2, title: 6, artist: 7, bpm: 15, key: 51, start: 28, end: 29, deck: 31 } as const;

/** Rows of a Serato history session ("oent" → "adat" → numbered fields). Unknown fields are ignored. */
export function readSession(b: Uint8Array): SeratoPlay[] {
  const out: SeratoPlay[] = [];
  for (const t of readTlv(b)) {
    if (t.tag !== 'oent') continue;
    for (const a of readTlv(t.data)) {
      if (a.tag !== 'adat') continue;
      const row: SeratoPlay = {};
      const dv = new DataView(a.data.buffer, a.data.byteOffset, a.data.byteLength);
      let o = 0;
      while (o + 8 <= a.data.length) {
        const id = dv.getUint32(o), len = dv.getUint32(o + 4);
        const v = a.data.subarray(o + 8, o + 8 + len);
        const str = () => fromUtf16be(v).replace(/\0+$/, '');
        const num = () => (len === 4 ? new DataView(v.buffer, v.byteOffset, 4).getUint32(0) : undefined);
        if (id === FIELD.path) row.path = str();
        else if (id === FIELD.title) row.title = str();
        else if (id === FIELD.artist) row.artist = str();
        else if (id === FIELD.bpm) row.bpm = str();
        else if (id === FIELD.key) row.key = str();
        else if (id === FIELD.start) row.startedAt = num();
        else if (id === FIELD.end) row.endedAt = num();
        else if (id === FIELD.deck) row.deck = num();
        o += 8 + len;
      }
      if (row.path || row.title) out.push(row);
    }
  }
  return out.sort((x, y) => (x.startedAt ?? 0) - (y.startedAt ?? 0));
}

/** Build a session file (tests, and to check the reader against your Mac's files). */
export function buildSession(rows: SeratoPlay[]): Uint8Array {
  const field = (id: number, data: Uint8Array) => { const h = new Uint8Array(8); const dv = new DataView(h.buffer); dv.setUint32(0, id); dv.setUint32(4, data.length); return concat([h, data]); };
  const u32 = (n: number) => { const x = new Uint8Array(4); new DataView(x.buffer).setUint32(0, n); return x; };
  const parts = [tlv('vrsn', utf16be('1.0/Serato Scratch LIVE Review'))];
  for (const r of rows) {
    const f: Uint8Array[] = [];
    if (r.path) f.push(field(FIELD.path, utf16be(r.path + '\0')));
    if (r.title) f.push(field(FIELD.title, utf16be(r.title + '\0')));
    if (r.artist) f.push(field(FIELD.artist, utf16be(r.artist + '\0')));
    if (r.startedAt) f.push(field(FIELD.start, u32(r.startedAt)));
    if (r.endedAt) f.push(field(FIELD.end, u32(r.endedAt)));
    if (r.deck) f.push(field(FIELD.deck, u32(r.deck)));
    parts.push(tlv('oent', tlv('adat', concat(f))));
  }
  return concat(parts);
}
