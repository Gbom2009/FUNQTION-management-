import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useTestDatabase } from '../../core/db';
import { setActor } from '../../core/repo';
import { ensureSeed } from '../../core/seed';
import { runTaskSync } from '../bookings/domain/taskSync';
import { addLocation, addStreamTrack, analyseTrack, scanLocation, tagsFromComment, writeTags } from './data';
import { memorySource } from './fs';
import { commentText, readId3, textFrame, commentFrame, frameText } from './domain/id3';
import { buildMarkers2 } from './domain/serato';

let n = 0;
beforeEach(async () => { useTestDatabase('library-' + n++); setActor('gijs'); await ensureSeed(); });
afterEach(async () => { await runTaskSync(); });

function frame(id: string, data: Uint8Array) {
  const len = data.length;
  return [...new TextEncoder().encode(id), (len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff, 0, 0, ...data];
}
/** Minimal MP3: ID3v2.3 tag + a few valid-looking MPEG frame headers + payload. */
function mp3(tags: Record<string, string>, opts: { comment?: string; cues?: boolean; audioSeed?: number } = {}) {
  const frames: number[] = [];
  for (const [id, v] of Object.entries(tags)) frames.push(...frame(id, textFrame(id, v).data));
  if (opts.comment) frames.push(...frame('COMM', commentFrame(opts.comment).data));
  if (opts.cues) frames.push(...frame('GEOB', buildMarkers2([{ index: 0, atMs: 64000, name: 'Drop' }])));
  const size = frames.length;
  const header = [0x49, 0x44, 0x33, 3, 0, 0, (size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f];
  const audio: number[] = [];
  for (let i = 0; i < 20; i++) { audio.push(0xff, 0xfb, 0x90, 0x64); for (let k = 0; k < 413; k++) audio.push((k * 7 + i + (opts.audioSeed ?? 0)) & 0xff); }
  return new Uint8Array([...header, ...frames, ...audio]);
}

describe('library scanning', () => {
  it('reads tags, our comment tags and Serato cues; links copies; marks missing files', async () => {
    const { db } = await import('../../core/db');
    const laptop = await addLocation({ name: 'MacBook Gijs', kind: 'laptop', owner: 'gijs', rootPath: '/Users/gijs/Music' });
    const usb = await addLocation({ name: 'USB Zwart', kind: 'usb', owner: 'gijs', rootPath: '/Volumes/USB Zwart' });
    const a = mp3({ TPE1: 'Martin Garrix', TIT2: 'Animals (Extended Mix)', TBPM: '128', TKEY: 'F#m' }, { comment: 'E8 · CLUB · BANGER · drop op 1:04', cues: true });
    const b = mp3({ TPE1: 'Snollebollekes', TIT2: 'Links Rechts' }, { audioSeed: 3 });
    const src = memorySource({ 'Club/a.mp3': a, 'NL/b.mp3': b, 'notes.txt': new Uint8Array([1]) }, 'Music', '/Users/gijs/Music');
    const r = await scanLocation(laptop, src);
    expect(r).toMatchObject({ added: 2, errors: [] });
    const tracks = await db.musicTracks.toArray();
    const animals = tracks.find((t) => t.title === 'Animals')!;
    expect(animals).toMatchObject({ artist: 'Martin Garrix', mix: 'Extended Mix', bpm: 128, key: '11A', energy: 8, crowd: ['club'], flags: ['banger'], comment: 'drop op 1:04', status: 'inbox' });
    expect(animals.hotCues).toEqual([{ index: 0, atMs: 64000, name: 'Drop', color: '#cc0000' }]);

    // The same file on a USB stick is a copy, not a new track.
    const stick = memorySource({ 'Music/Animals.mp3': a.slice() }, 'USB Zwart', '/Volumes/USB Zwart');
    expect((await scanLocation(usb, stick)).added).toBe(0);
    expect(await db.trackFiles.where('trackId').equals(animals.id).count()).toBe(2);

    // Rescan without changes: nothing re-read. Remove a file: it becomes missing.
    expect(await scanLocation(laptop, src)).toMatchObject({ added: 0, updated: 0 });
    delete src.files['NL/b.mp3'];
    await scanLocation(laptop, src);
    const missing = (await db.trackFiles.toArray()).filter((f) => f.missing);
    expect(missing.map((f) => f.path)).toEqual(['NL/b.mp3']);
    expect((await db.musicLocations.get(laptop.id))!.scanSummary).toMatchObject({ files: 1, missing: 1 });
  });

  it('writes our fields back into the MP3 and keeps Serato data', async () => {
    const { db } = await import('../../core/db');
    const loc = await addLocation({ name: 'MacBook', kind: 'laptop', owner: 'coen' });
    const src = memorySource({ 'a.mp3': mp3({ TPE1: 'X', TIT2: 'Y' }, { cues: true }) });
    await scanLocation(loc, src);
    const t = (await db.musicTracks.toArray())[0];
    const f = (await db.trackFiles.toArray())[0];
    expect(await writeTags({ ...t, title: 'Y', mix: 'VIP Edit', energy: 9, crowd: ['wedding'], moods: ['euphoric'], flags: ['singalong'], bpm: 126, key: '8A', comment: 'mooi' }, f, src)).toBe('ok');
    const tag = readId3(src.files['a.mp3'])!;
    expect(frameText(tag.frames.find((x) => x.id === 'TIT2'))).toBe('Y (VIP Edit)');
    expect(commentText(tag)).toBe('E9 · BRUILOFT · EUFORISCH · MEEZINGER · mooi');
    expect(tag.frames.some((x) => x.id === 'GEOB')).toBe(true);
    expect(tagsFromComment(commentText(tag))).toMatchObject({ energy: 9, crowd: ['wedding'], moods: ['euphoric'], flags: ['singalong'], rest: 'mooi' });
  });

  it('analyses missing BPM/key with an injected decoder, and adds stream-only tracks', async () => {
    const { db } = await import('../../core/db');
    const loc = await addLocation({ name: 'MacBook', kind: 'laptop', owner: 'gijs' });
    const src = memorySource({ 'x.mp3': mp3({ TPE1: 'A', TIT2: 'B' }) });
    await scanLocation(loc, src);
    const t = (await db.musicTracks.toArray())[0];
    const f = (await db.trackFiles.toArray())[0];
    const rate = 22050;
    const pcm = new Float32Array(rate * 40);
    const period = (60 / 124) * rate;
    for (let k = 0; k * period < pcm.length; k++) { const s = Math.round(k * period); for (let i = 0; i < 1500 && s + i < pcm.length; i++) pcm[s + i] += Math.sin((2 * Math.PI * 55 * i) / rate) * Math.exp(-i / 250); }
    for (let i = 0; i < pcm.length; i++) pcm[i] += 0.2 * (Math.sin((2 * Math.PI * 220 * i) / rate) + Math.sin((2 * Math.PI * 261.63 * i) / rate) + Math.sin((2 * Math.PI * 329.63 * i) / rate));
    await analyseTrack(t, f, src, async () => ({ pcm, rate }));
    const after = (await db.musicTracks.get(t.id))!;
    expect(Math.abs(after.bpm! - 124)).toBeLessThan(1.5);
    expect(after.key).toBe('8A');
    expect(after.energy).toBeGreaterThanOrEqual(1);
    const s = await addStreamTrack({ artist: 'Fred again..', title: 'Delilah', service: 'Beatport', key: 'Dm', bpm: 140 }, 'gijs');
    expect(s).toMatchObject({ source: 'stream', stream: { service: 'Beatport' }, key: '7A' });
  });
});
