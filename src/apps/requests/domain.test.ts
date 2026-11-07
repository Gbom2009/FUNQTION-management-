import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import type { Track } from '../../core/types';
import { normKey } from '../library/domain/names';
import { fitsNow, libraryIndex, matchQueue, pauseWindows, sessionCode, sortQueue, type QueueItem } from './domain';

// The server's helper library (pb_hooks/lib/requests.js) is plain CommonJS.
const lib = createRequire(import.meta.url)('../../../server/requests/pb_hooks/lib/requests.js');

const tr = (id: string, p: Partial<Track>) => ({ id, artist: 'X', title: 'Y', moods: [], crowd: [], flags: [], cueNotes: [], status: 'ok', ...p }) as Track;
const q = (id: string, p: Partial<QueueItem>): QueueItem => ({ id, artist: 'A', title: 'B', normKey: '', status: 'new', votes: 1, inLibrary: false, priority: false, created: '2026-01-01', ...p });

describe('requests: DJ side', () => {
  const lib1 = [tr('t1', { artist: 'ABBA', title: 'Dancing Queen', bpm: 101, key: '9B', energy: 7 }), tr('t2', { artist: 'The Killers', title: 'Mr. Brightside', bpm: 148, key: '1B', energy: 8 })];
  it('matches requests to the library and to what fits now', () => {
    const now = tr('n', { bpm: 100, key: '9B', energy: 6 });
    const m = matchQueue([q('1', { artist: 'Abba', title: 'Dancing Queen (Remastered 2001)' }), q('2', { artist: 'Killers', title: 'Mr Brightside' }), q('3', { artist: 'Nobody', title: 'Unknown' })], lib1, now);
    expect(m.map((x) => x.match)).toEqual(['fits_now', 'in_library', 'not_in_library']);
    expect(m[1].track?.id).toBe('t2');
    expect(fitsNow(lib1[1], now)).toBe(false);
  });
  it('sorts: accepted, the couple, votes, fits now', () => {
    const items = [q('a', { votes: 5 }), q('b', { votes: 1, priority: true }), q('c', { status: 'accepted', votes: 0 }), q('d', { status: 'played', votes: 9 }), q('e', { votes: 5 })]
      .map((x) => ({ ...x, match: x.id === 'e' ? 'fits_now' as const : 'in_library' as const }));
    expect(sortQueue(items).map((x) => x.id)).toEqual(['c', 'b', 'e', 'a', 'd']);
  });
  it('pause windows from Gig Day moments, codes, library index without paths', () => {
    const w = pauseWindows([{ kind: 'moment', label: 'Openingsdans', plannedAt: '2026-12-12T20:00:00.000Z' }, { kind: 'set_start', label: 'x', plannedAt: '2026-12-12T20:10:00.000Z' }]);
    expect(w).toEqual([{ from: '2026-12-12T19:58:00.000Z', to: '2026-12-12T20:08:00.000Z', label: 'Openingsdans' }]);
    expect(sessionCode(() => 0.5)).toMatch(/^FQ[A-Z2-9]{3}$/);
    expect(libraryIndex([tr('t', { artist: 'A', title: 'B', mix: 'VIP' })])).toEqual([['A', 'B (VIP)', 't']]);
  });
});

describe('requests: server helpers (pb_hooks/lib)', () => {
  it('uses exactly the hub\'s normalisation', () => {
    for (const [a, t] of [['Martin Garrix & Dua Lipa', 'Scared To Be Lonely (Brooks Remix)'], ['Beyoncé', 'Halo'], ['The Killers', 'Mr. Brightside'], ['Snollebollekes ft. X', 'Links Rechts']]) {
      expect(lib.normKey(a, t)).toBe(normKey(a, t));
    }
  });
  it('filters bad words (also l33t), links, and walls of emoji', () => {
    expect(lib.hasBadWords('K4nker nummer')).toBe(true);
    expect(lib.hasBadWords('fuck')).toBe(true);
    expect(lib.hasBadWords('Kankerbende')).toBe(true); // compound words: caught by the squashed check
    expect(lib.hasBadWords('Dancing Queen')).toBe(false);
    expect(lib.hasBadWords('Shakira - Hips don\'t lie')).toBe(false);
    expect(lib.hasLink('check www.spam.nl')).toBe(true);
    expect(lib.cleanText('heyyyyyyy\n\n  🔥🔥🔥🔥🔥🔥', 50)).toBe('heyyy 🔥🔥🔥');
  });
  it('rate limits, pauses, blocks, searches the index', () => {
    let hits: number[] = [];
    for (let i = 0; i < 3; i++) { const r = lib.allowHit(hits, 1000 + i, 60000, 3); expect(r.ok).toBe(true); hits = r.hits; }
    expect(lib.allowHit(hits, 2000, 60000, 3).ok).toBe(false);
    expect(lib.allowHit(hits, 70000, 60000, 3).ok).toBe(true);
    expect(lib.isPaused('open', { pauseWindows: [{ from: '2026-01-01T20:00:00Z', to: '2026-01-01T20:10:00Z', label: 'Speeches' }] }, Date.parse('2026-01-01T20:05:00Z'))).toBe('Speeches');
    expect(lib.isPaused('paused', {}, 0)).toBe(true);
    expect(lib.isBlocked('Snollebollekes & X', 'Links Rechts', ['artist:snollebollekes'])).toBe(true);
    expect(lib.isBlocked('Los del Rio', 'Macarena (Remix)', [normKey('Los del Rio', 'Macarena')])).toBe(true);
    expect(lib.searchIndex([['ABBA', 'Dancing Queen', 't'], ['Queen', 'Bohemian Rhapsody', 'q']], 'queen', 5).length).toBe(2);
    expect(lib.searchIndex([['ABBA', 'Dancing Queen', 't']], 'qu', 5)).toEqual([]);
  });
});
