import { describe, expect, it } from 'vitest';
import { parseBuffer } from 'music-metadata';
import { keyScore, musicalKey, shiftedKey, toCamelot } from './keys';
import { cleanFields, normKey, parseFilename, similarity, tidyFilename } from './names';
import { audioRange, commentText, decodeComment, encodeComment, readId3, textFrame, writeId3, frameText } from './id3';
import { buildMarkers2, buildSession, cratePath, readCrate, readMarkers2, readSession, writeCrate, crateFileName } from './serato';
import { fileUrl, m3u, rekordboxXml } from './exports';
import { cutoffHz, detectBpm, detectKey, judgeQuality } from './analysis';
import { findDupes } from './dupes';

describe('keys', () => {
  it('reads every notation into Camelot', () => {
    expect(toCamelot('Am')).toBe('8A');
    expect(toCamelot('A minor')).toBe('8A');
    expect(toCamelot('C')).toBe('8B');
    expect(toCamelot('F#m')).toBe('11A');
    expect(toCamelot('Gbm')).toBe('11A');
    expect(toCamelot('Bb')).toBe('6B');
    expect(toCamelot('08A')).toBe('8A');
    expect(toCamelot('1m')).toBe('8A');   // Open Key
    expect(toCamelot('1d')).toBe('8B');
    expect(toCamelot('12A')).toBe('12A');
    expect(toCamelot('nonsense')).toBeUndefined();
    expect(musicalKey('8A')).toBe('Am');
    expect(musicalKey('2B')).toBe('F#');
  });
  it('scores harmonic mixes and knows what pitching does', () => {
    expect(keyScore('8A', '8A')).toBe(1);
    expect(keyScore('8A', '9A')).toBe(0.9);
    expect(keyScore('8A', '7A')).toBe(0.9);
    expect(keyScore('12A', '1A')).toBe(0.9);
    expect(keyScore('8A', '8B')).toBe(0.85);
    expect(keyScore('8A', '10A')).toBe(0.6);
    expect(keyScore('8A', '3B')).toBe(0.1);
    expect(shiftedKey('8A', 6)).toBe('3A');   // +1 semitone = +7 on the wheel
    expect(shiftedKey('8A', 2)).toBe('8A');
  });
});

describe('names', () => {
  it('cleans messy filenames', () => {
    expect(parseFilename('01. MARTIN GARRIX - ANIMALS (ORIGINAL MIX) [www.djsite.com].mp3')).toEqual({ artist: 'Martin Garrix', title: 'Animals', mix: undefined });
    expect(parseFilename('Snollebollekes_-_Links_Rechts_(Extended_Mix).mp3')).toMatchObject({ artist: 'Snollebollekes', title: 'Links Rechts', mix: 'Extended Mix' });
    expect(cleanFields({ artist: 'David Guetta', title: 'Titanium ft. Sia (Radio Edit)' }, 'x.mp3')).toEqual({ artist: 'David Guetta feat. Sia', title: 'Titanium', mix: 'Radio Edit' });
    expect(tidyFilename({ artist: 'AC/DC', title: 'T.N.T.', mix: undefined }, 'MP3')).toBe('ACDC - T.N.T..mp3');
  });
  it('matches the same song across spellings', () => {
    expect(normKey('Martin Garrix & Dua Lipa', 'Scared To Be Lonely (Brooks Remix)')).toBe(normKey('martin garrix', 'Scared to be Lonely'));
    expect(normKey('Beyoncé', 'Halo')).toBe('beyonce|halo');
    expect(similarity('dancing queen', 'dancin queen')).toBeGreaterThan(0.9);
  });
});

/** A small MP3-like file: ID3 tag with a Serato GEOB frame + fake audio frames. */
function fakeMp3(frames: Uint8Array[], audio = new Uint8Array(4000).fill(0xab)) {
  const body = frames.flatMap((f) => [...f]);
  const size = body.length;
  const ss = [(size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f];
  return new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, ...ss, ...body, ...audio]);
}
function rawFrame(id: string, data: Uint8Array) {
  const n = data.length;
  return new Uint8Array([...new TextEncoder().encode(id), (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff, 0, 0, ...data]);
}

describe('ID3 writer', () => {
  it('rewrites our fields and keeps Serato GEOB data byte-for-byte', async () => {
    const geob = buildMarkers2([{ index: 0, atMs: 32500, name: 'Drop', color: [204, 0, 0] }, { index: 2, atMs: 1000 }]);
    const t = textFrame('TIT2', 'old title');
    const file = fakeMp3([rawFrame('TIT2', t.data), rawFrame('GEOB', geob), rawFrame('PRIV', new Uint8Array([1, 2, 3]))]);
    const out = writeId3(file, { title: 'Animals', artist: 'Martin Garrix', bpm: 128, key: '8A', comment: encodeComment({ energy: 8, words: ['club', 'banger'], rest: 'mixt goed na Tremor' }) })!;
    const tag = readId3(out)!;
    expect(frameText(tag.frames.find((f) => f.id === 'TIT2'))).toBe('Animals');
    expect(tag.frames.find((f) => f.id === 'GEOB')!.data).toEqual(geob);
    expect(tag.frames.find((f) => f.id === 'PRIV')!.data).toEqual(new Uint8Array([1, 2, 3]));
    expect(tag.frames.filter((f) => f.id === 'TIT2')).toHaveLength(1);
    expect(decodeComment(commentText(tag))).toEqual({ energy: 8, words: ['CLUB', 'BANGER'], rest: 'mixt goed na Tremor' });
    // audio untouched → same audio hash range content
    const [a0, a1] = audioRange(file, 'mp3'); const [b0, b1] = audioRange(out, 'mp3');
    expect(out.subarray(b0, b1)).toEqual(file.subarray(a0, a1));
    // a standard reader sees the new tags too
    const meta = await parseBuffer(out, { mimeType: 'audio/mpeg' }, { skipPostHeaders: true, duration: false });
    expect(meta.common.title).toBe('Animals');
    expect(meta.common.artist).toBe('Martin Garrix');
    expect(meta.common.bpm).toBe(128);
    // and Serato's cues are still readable
    expect(readMarkers2(tag.frames.find((f) => f.id === 'GEOB')!.data)).toEqual([
      { index: 0, atMs: 32500, name: 'Drop', color: '#cc0000' }, { index: 2, atMs: 1000, name: undefined, color: '#cc0000' },
    ]);
  });
  it('adds a tag to a file without one, and leaves comments without our prefix alone', () => {
    const out = writeId3(new Uint8Array(500).fill(0xff), { title: 'X' })!;
    expect(frameText(readId3(out)!.frames[0])).toBe('X');
    expect(decodeComment('gewoon een notitie')).toEqual({ words: [], rest: 'gewoon een notitie' });
    expect(encodeComment({ words: [], rest: 'notitie' })).toBe('notitie');
  });
});

describe('Serato files', () => {
  it('writes and reads crates', () => {
    const paths = ['Users/gijs/Music/a.mp3', 'Music/Bruiloft/b é.mp3'];
    expect(readCrate(writeCrate(paths))).toEqual(paths);
    expect(cratePath('/Volumes/USB Zwart/Music/x.mp3')).toBe('Music/x.mp3');
    expect(cratePath('/Users/gijs/Music/x.mp3')).toBe('Users/gijs/Music/x.mp3');
    expect(crateFileName(['Funqtion', 'Bruiloft Lisa & Tom'])).toBe('Funqtion%%Bruiloft Lisa & Tom.crate');
  });
  it('reads history sessions', () => {
    const b = buildSession([
      { path: '/Users/gijs/Music/b.mp3', title: 'B', artist: 'Y', startedAt: 1765580000, deck: 2 },
      { path: '/Users/gijs/Music/a.mp3', title: 'A', artist: 'X', startedAt: 1765579000, endedAt: 1765579200, deck: 1 },
    ]);
    const rows = readSession(b);
    expect(rows.map((r) => r.title)).toEqual(['A', 'B']);
    expect(rows[0]).toMatchObject({ artist: 'X', deck: 1, endedAt: 1765579200 });
  });
});

describe('exports', () => {
  const t = { id: 't1', absPath: '/Users/gijs/Music/A & B.mp3', artist: 'A & B', title: 'Song', mix: 'Extended Mix', bpm: 128, key: '8A', durationS: 312, hotCues: [{ index: 0, atMs: 32500, name: 'Drop', color: '#cc0000' }] };
  it('Rekordbox XML with hot cues and a playlist', () => {
    const xml = rekordboxXml([t], [{ name: 'Bruiloft', trackIds: ['t1'] }]);
    expect(xml).toContain('Name="Song (Extended Mix)" Artist="A &amp; B"');
    expect(xml).toContain('Tonality="Am"');
    expect(xml).toContain('Location="file://localhost/Users/gijs/Music/A%20%26%20B.mp3"');
    expect(xml).toContain('<POSITION_MARK Name="Drop" Type="0" Start="32.500" Num="0" Red="204" Green="0" Blue="0"/>');
    expect(xml).toContain('<NODE Name="Bruiloft" Type="1" KeyType="0" Entries="1">');
    expect(fileUrl('C:\\Music\\x.mp3')).toBe('file://localhost/C:/Music/x.mp3');
  });
  it('M3U, relative for a stick', () => {
    expect(m3u([{ ...t, absPath: '/Volumes/USB/Music/a.mp3' }], '/Volumes/USB')).toBe('#EXTM3U\n#EXTINF:312,A & B - Song (Extended Mix)\nMusic/a.mp3\n');
  });
});

describe('analysis', () => {
  const rate = 22050;
  it('finds the tempo of a 128 BPM kick pattern', () => {
    const pcm = new Float32Array(rate * 30);
    const period = (60 / 128) * rate;
    for (let b = 0; b * period < pcm.length; b++) {
      const s = Math.round(b * period);
      for (let i = 0; i < 2000 && s + i < pcm.length; i++) pcm[s + i] += Math.sin((2 * Math.PI * 60 * i) / rate) * Math.exp(-i / 300);
    }
    const r = detectBpm(pcm, rate)!;
    expect(Math.abs(r.bpm - 128)).toBeLessThan(1.5);
  });
  it('hears A minor and C major', () => {
    const tone = (freqs: number[]) => {
      const pcm = new Float32Array(rate * 10);
      for (let i = 0; i < pcm.length; i++) for (const f of freqs) pcm[i] += Math.sin((2 * Math.PI * f * i) / rate) / freqs.length;
      return pcm;
    };
    expect(detectKey(tone([220, 261.63, 329.63, 110, 440]), rate)!.key).toBe('8A');   // A C E, A in the bass
    expect(detectKey(tone([261.63, 329.63, 392, 130.81, 523.25]), rate)!.key).toBe('8B'); // C E G
  });
  it('spots a fake 320 by its frequency cut-off', () => {
    const sr = 44100;
    const pcm = new Float32Array(sr * 4);
    for (let i = 0; i < pcm.length; i++) pcm[i] = Math.sin(2 * Math.PI * 1000 * i / sr) + 0.3 * Math.sin(2 * Math.PI * 15000 * i / sr);
    const c = cutoffHz(pcm, sr);
    expect(c).toBeGreaterThan(14500);
    expect(c).toBeLessThan(16500);
    expect(judgeQuality({ format: 'mp3', bitrate: 320, cutoff: c })).toBe('transcode_suspect');
    expect(judgeQuality({ format: 'mp3', bitrate: 128 })).toBe('low');
    expect(judgeQuality({ format: 'mp3', bitrate: 320, cutoff: 19800 })).toBe('ok');
  });
});

describe('duplicates', () => {
  it('same audio across tracks, and the same version in two formats', () => {
    const tracks = [
      { id: 'a', artist: 'X', title: 'Song', durationS: 200 }, { id: 'b', artist: 'x', title: 'song', durationS: 201 },
      { id: 'c', artist: 'Y', title: 'Other', durationS: 180 }, { id: 'd', artist: 'Y', title: 'Other', durationS: 400 },
      { id: 'e', artist: 'Z', title: 'Z1' }, { id: 'f', artist: 'Q', title: 'Q1' },
    ];
    const files = [
      { id: 'fa', trackId: 'a', audioHash: 'h1', format: 'mp3', bitrate: 320, sizeBytes: 1 },
      { id: 'fb', trackId: 'b', audioHash: 'h2', format: 'wav', sizeBytes: 9 },
      { id: 'fe', trackId: 'e', audioHash: 'h3', format: 'mp3', bitrate: 128, sizeBytes: 1 },
      { id: 'ff', trackId: 'f', audioHash: 'h3', format: 'mp3', bitrate: 320, sizeBytes: 1 },
    ];
    const g = findDupes(tracks, files);
    expect(g.find((x) => x.kind === 'same_audio')).toMatchObject({ trackIds: ['e', 'f'], keepFileId: 'ff' });
    expect(g.find((x) => x.kind === 'same_version')).toMatchObject({ trackIds: ['a', 'b'], keepFileId: 'fb' });
    expect(g.some((x) => x.trackIds.includes('c'))).toBe(false); // radio edit vs extended: not dupes
  });
});
