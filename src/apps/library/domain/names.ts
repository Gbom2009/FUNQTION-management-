// Clean-up of names: parse messy filenames, normalise artist/title, suggest a
// tidy filename, and a normalised key for matching (library ↔ requests ↔ history).

const JUNK = [
  /\[(free download|free dl|out now|premiere)[^\]]*\]/gi,
  /\((free download|free dl|out now|premiere)[^)]*\)/gi,
  /\b(www\.)?[a-z0-9-]+\.(com|net|org|nl|ru|to|io|fm)\b/gi,
  /\b(320|256|192|128)\s?kbps\b/gi,
  /\[(hq|hd|official( video| audio)?|lyrics?)\]/gi,
  /\((hq|hd|official( video| audio| music video)?|lyrics?( video)?|audio)\)/gi,
  /_+/g,
];

export function stripJunk(s: string): string {
  let out = s;
  for (const re of JUNK) out = out.replace(re, re.source === '_+' ? ' ' : '');
  return out.replace(/\[\s*\]|\(\s*\)/g, '').replace(/\s{2,}/g, ' ').replace(/\s+([)\]])/g, '$1').replace(/([([])\s+/g, '$1').trim();
}

const SMALL = new Set(['a', 'an', 'and', 'de', 'het', 'een', 'en', 'van', 'the', 'of', 'in', 'on', 'op', 'to', 'vs', 'feat', 'ft', 'x']);

/** "DJ SNAKE - TURN DOWN FOR WHAT" → "DJ Snake - Turn Down for What". Leaves mixed case alone. */
export function tidyCase(s: string): string {
  const letters = s.replace(/[^A-Za-z]/g, '');
  const upper = letters && letters === letters.toUpperCase();
  const lower = letters && letters === letters.toLowerCase();
  if (!upper && !lower) return s;
  return s.toLowerCase().split(' ').map((w, i) => {
    if (/^(dj|mc|uk|usa|ac\/dc|abba|vip|edm|ii|iii|iv)$/i.test(w)) return w.toUpperCase();
    if (i > 0 && SMALL.has(w)) return w;
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ');
}

export interface ParsedName { artist: string; title: string; mix?: string; featuring?: string }

/** Split a title into title + mix: "Song (Extended Mix)" → { title: "Song", mix: "Extended Mix" }. */
export function splitMix(title: string): { title: string; mix?: string } {
  const m = /^(.*?)\s*[([]([^)\]]*(mix|edit|remix|version|vip|bootleg|rework|dub|instrumental|acapella|radio|extended|club|intro|clean|dirty)[^)\]]*)[)\]]\s*$/i.exec(title);
  if (!m) return { title: title.trim() };
  const mix = m[2].trim();
  return { title: m[1].trim(), mix: /^original mix$/i.test(mix) ? undefined : mix };
}

/** Move "feat." out of the title into the artist field. */
export function moveFeat(artist: string, title: string): { artist: string; title: string } {
  const re = /\s*[([]?\s*(?:feat\.?|ft\.?|featuring)\s+([^()[\]]+)[)\]]?/i;
  const m = re.exec(title);
  if (!m) return { artist, title };
  const feat = m[1].trim();
  const a = new RegExp(`\\b${feat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(artist) ? artist : `${artist} feat. ${feat}`;
  return { artist: a.replace(/\s+(?:ft\.?|featuring)\s+/i, ' feat. '), title: title.replace(re, '').trim() };
}

/** Best guess from a filename such as "01. Artist - Title (Extended Mix) [www.site.com].mp3". */
export function parseFilename(name: string): ParsedName {
  const base = name.replace(/^.*[\\/]/, '').replace(/\.[a-z0-9]{2,4}$/i, '');
  const clean = stripJunk(base).replace(/^\d{1,3}\s*[.\-_)]\s*/, '');
  const dash = clean.split(/\s+[-–—]\s+/);
  let artist = '', title = clean;
  if (dash.length >= 2) { artist = dash[0]; title = dash.slice(1).join(' - '); }
  const sm = splitMix(title);
  const f = moveFeat(artist, sm.title);
  return { artist: tidyCase(f.artist.trim()), title: tidyCase(f.title), mix: sm.mix ? tidyCase(sm.mix) : undefined };
}

/** Tags + filename → cleaned fields (tags win, filename fills gaps). */
export function cleanFields(tag: { artist?: string; title?: string }, filename: string): ParsedName {
  const fromFile = parseFilename(filename);
  const artist0 = stripJunk(tag.artist ?? '') || fromFile.artist;
  const title0 = stripJunk(tag.title ?? '') || fromFile.title;
  const sm = splitMix(title0);
  const f = moveFeat(artist0, sm.title);
  return { artist: tidyCase(f.artist), title: tidyCase(f.title), mix: sm.mix ? tidyCase(sm.mix) : fromFile.mix };
}

const ILLEGAL = /[\\/:*?"<>|]/g;
/** "Artist - Title (Mix).ext" with characters every file system accepts (FAT32/exFAT sticks too). */
export function tidyFilename(t: { artist: string; title: string; mix?: string }, ext: string): string {
  const core = `${t.artist || 'Unknown'} - ${t.title || 'Untitled'}${t.mix ? ` (${t.mix})` : ''}`.replace(ILLEGAL, '').replace(/\s{2,}/g, ' ').trim();
  return `${core.slice(0, 180)}.${ext.toLowerCase()}`;
}

/** Normalised "artist|title" for matching: lower-case, no accents, no feat./mix/punctuation. */
export function normKey(artist: string, title: string): string {
  const n = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s*[([].*?[)\]]/g, '').replace(/\b(feat|ft|featuring)\.?\b.*$/, '')
    .replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\b(the|de|het)\b/g, '').replace(/\s+/g, ' ').trim();
  const firstArtist = n(artist.split(/\s*(?:,|&| x | vs\.? | and )\s*/i)[0] ?? artist);
  return `${firstArtist}|${n(title)}`;
}

/** Levenshtein similarity 0–1 (for fuzzy request matching). */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0]; prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, last + (a[i - 1] === b[j - 1] ? 0 : 1));
      last = tmp;
    }
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}
