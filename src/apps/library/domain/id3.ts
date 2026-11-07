// A minimal ID3v2.3/2.4 reader/writer that keeps every frame it doesn't own
// byte-for-byte. That matters: Serato stores cues, loops, beatgrid and
// overview in GEOB frames inside the file; a tag editor that drops unknown
// frames wipes them. We only replace the text frames we edit + COMM.

export interface Id3Frame { id: string; flags: [number, number]; data: Uint8Array }
export interface Id3Tag { version: 3 | 4; flags: number; frames: Id3Frame[]; size: number /* incl. header */ }

const td = new TextDecoder('latin1');

function synchsafe(b: Uint8Array, o: number) { return ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f); }
function toSynchsafe(n: number) { return [(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]; }
const be32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const toBe32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

/** Size of the ID3v2 tag at the start of the file (0 when there is none). */
export function id3Size(b: Uint8Array): number {
  if (b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return 0;
  const footer = b[5] & 0x10 ? 10 : 0;
  return 10 + synchsafe(b, 6) + footer;
}

/** Byte range of the audio (without ID3v2 at the start and ID3v1 at the end): the base of the audio hash. */
export function audioRange(b: Uint8Array, format: string): [number, number] {
  if (format !== 'mp3') return [0, b.length];
  const start = id3Size(b);
  let end = b.length;
  if (end - start > 128 && b[end - 128] === 0x54 && b[end - 127] === 0x41 && b[end - 126] === 0x47) end -= 128; // "TAG"
  return [start, end];
}

export function readId3(b: Uint8Array): Id3Tag | null {
  const size = id3Size(b);
  if (!size) return null;
  const version = b[3];
  if (version !== 3 && version !== 4) return null;
  const flags = b[5];
  if (flags & 0x80) return null; // unsynchronised tags: leave alone (rare, we refuse to write)
  let o = 10;
  if (flags & 0x40) o += version === 4 ? synchsafe(b, 10) : be32(b, 10) + 4; // extended header
  const end = 10 + synchsafe(b, 6);
  const frames: Id3Frame[] = [];
  while (o + 10 <= end) {
    if (b[o] === 0) break; // padding
    const id = td.decode(b.subarray(o, o + 4));
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const len = version === 4 ? synchsafe(b, o + 4) : be32(b, o + 4);
    if (o + 10 + len > end) break;
    frames.push({ id, flags: [b[o + 8], b[o + 9]], data: b.slice(o + 10, o + 10 + len) });
    o += 10 + len;
  }
  return { version, flags, frames, size };
}

/** Text of a text frame (T***), any encoding. */
export function frameText(f?: Id3Frame): string | undefined {
  if (!f || !f.data.length) return undefined;
  return decodeText(f.data[0], f.data.subarray(1)).replace(/\0+$/, '').split('\0')[0];
}

function decodeText(enc: number, d: Uint8Array): string {
  if (enc === 0) return td.decode(d);
  if (enc === 3) return new TextDecoder('utf-8').decode(d);
  if (enc === 1) {
    if (d[0] === 0xfe && d[1] === 0xff) return new TextDecoder('utf-16be').decode(d.subarray(2));
    if (d[0] === 0xff && d[1] === 0xfe) return new TextDecoder('utf-16le').decode(d.subarray(2));
    return new TextDecoder('utf-16le').decode(d);
  }
  return new TextDecoder('utf-16be').decode(d);
}

/** UTF-16 with BOM (encoding 1): readable by every ID3 reader, v2.3 and v2.4. */
function utf16(s: string): number[] {
  const out = [0xff, 0xfe];
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); out.push(c & 0xff, c >> 8); }
  return out;
}

export function textFrame(id: string, value: string): Id3Frame {
  return { id, flags: [0, 0], data: new Uint8Array([1, ...utf16(value)]) };
}

/** COMM frame (language "eng", empty description). */
export function commentFrame(text: string): Id3Frame {
  return { id: 'COMM', flags: [0, 0], data: new Uint8Array([1, 0x65, 0x6e, 0x67, ...utf16(''), 0, 0, ...utf16(text)]) };
}

export function commentText(tag: Id3Tag | null): string | undefined {
  const f = tag?.frames.find((x) => x.id === 'COMM');
  if (!f) return undefined;
  const enc = f.data[0];
  const body = f.data.subarray(4);
  const wide = enc === 1 || enc === 2;
  let i = 0;
  if (wide) { while (i + 1 < body.length && !(body[i] === 0 && body[i + 1] === 0 && i % 2 === 0)) i += 2; i += 2; }
  else { while (i < body.length && body[i] !== 0) i++; i++; }
  return decodeText(enc, body.subarray(i)).replace(/\0+$/, '');
}

export interface TagEdit { title?: string; artist?: string; album?: string; genre?: string; bpm?: number; key?: string; year?: number; label?: string; comment?: string }

const TEXT_IDS: Record<Exclude<keyof TagEdit, 'comment'>, string> = { title: 'TIT2', artist: 'TPE1', album: 'TALB', genre: 'TCON', bpm: 'TBPM', key: 'TKEY', year: 'TYER', label: 'TPUB' };

/**
 * New file bytes with the edited fields. Every other frame (GEOB from Serato,
 * APIC artwork, PRIV, …) is copied unchanged; the audio is untouched.
 * Returns null for tags we refuse to rewrite (unsynchronised).
 */
export function writeId3(file: Uint8Array, edit: TagEdit): Uint8Array | null {
  const old = readId3(file);
  if (id3Size(file) && !old) return null;
  const version: 3 | 4 = old?.version ?? 3;
  const owned = new Set<string>();
  const add: Id3Frame[] = [];
  for (const [k, id] of Object.entries(TEXT_IDS) as [keyof typeof TEXT_IDS, string][]) {
    const v = edit[k];
    if (v === undefined) continue;
    const ids = id === 'TYER' ? ['TYER', 'TDRC'] : [id];
    ids.forEach((x) => owned.add(x));
    if (v !== '' && v !== null) add.push(textFrame(version === 4 && id === 'TYER' ? 'TDRC' : id, String(k === 'bpm' ? Math.round(v as number) : v)));
  }
  if (edit.comment !== undefined) { owned.add('COMM'); if (edit.comment) add.push(commentFrame(edit.comment)); }
  const kept = (old?.frames ?? []).filter((f) => !owned.has(f.id) && !(f.id === 'COMM' && owned.has('COMM')));
  const frames = [...add, ...kept];
  const body: number[] = [];
  for (const f of frames) {
    const len = f.data.length;
    body.push(...new TextEncoder().encode(f.id), ...(version === 4 ? toSynchsafe(len) : toBe32(len)), f.flags[0], f.flags[1]);
    for (let i = 0; i < len; i++) body.push(f.data[i]);
  }
  const padding = 1024;
  const size = body.length + padding;
  const header = [0x49, 0x44, 0x33, version, 0, 0, ...toSynchsafe(size)];
  const audio = file.subarray(id3Size(file));
  const out = new Uint8Array(10 + size + audio.length);
  out.set(header, 0);
  out.set(body, 10);
  out.set(audio, 10 + size);
  return out;
}

// ---- Our tags in the comment field --------------------------------------------

const PREFIX_RE = /^\s*(?:E(\d{1,2})\s*·\s*)?((?:[A-Z][A-Z-]+\s*·\s*)*)/;

/** "E7 · BRUILOFT · BANGER · <your comment>": visible and searchable in Serato and djay. */
export function encodeComment(p: { energy?: number; words: string[]; rest?: string }): string {
  const parts = [p.energy ? `E${p.energy}` : '', ...p.words.map((w) => w.toUpperCase().replace(/\s+/g, '-'))].filter(Boolean);
  const rest = (p.rest ?? '').trim();
  return parts.length ? `${parts.join(' · ')} ·${rest ? ` ${rest}` : ''}` : rest;
}

export function decodeComment(c?: string): { energy?: number; words: string[]; rest: string } {
  if (!c) return { words: [], rest: '' };
  const m = PREFIX_RE.exec(c);
  if (!m || (!m[1] && !m[2])) return { words: [], rest: c.trim() };
  const words = (m[2] ?? '').split('·').map((w) => w.trim()).filter(Boolean);
  return { energy: m[1] ? Number(m[1]) : undefined, words, rest: c.slice(m[0].length).trim() };
}
