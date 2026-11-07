import { describe, expect, it } from 'vitest';
import { normKey } from '../../library/domain/names';
import { bpmScore, curveWarnings, DEFAULT_SET_TEMPLATES, energyCurve, fillChain, learn, score, suggest, type Cand } from './suggest';

const T = (id: string, p: Partial<Cand>): Cand => ({ id, artist: `A-${id}`, title: `T-${id}`, bpm: 128, key: '8A', energy: 6, crowd: [], flags: [], durationS: 240, source: 'unknown', ...p });

describe('scoring', () => {
  it('BPM: close, half/double time, too far', () => {
    expect(bpmScore(128, 126).s).toBe(1);
    expect(bpmScore(128, 122).s).toBe(0.6);
    expect(bpmScore(128, 64).s).toBe(0.7);
    expect(bpmScore(128, 100).s).toBe(0);
    expect(bpmScore(128, 125).pitch).toBe(2.4);
  });
  it('prefers harmonic, close-tempo, on-curve tracks and explains why', () => {
    const prev = T('p', { key: '8A', bpm: 126, energy: 6 });
    const pool = [
      T('good', { key: '9A', bpm: 127, energy: 7, crowd: ['wedding'] }),
      T('clash', { key: '3B', bpm: 127, energy: 7 }),
      T('slow', { key: '8A', bpm: 98, energy: 7 }),
      T('jump', { key: '8A', bpm: 126, energy: 10 }),
    ];
    const s = suggest(pool, { prev, section: { energyFrom: 6, energyTo: 8 }, progress: 0.5, eventType: 'wedding' });
    expect(s[0].track.id).toBe('good');
    expect(s[0].reasons.map((r) => r.k)).toEqual(expect.arrayContaining(['bpm', 'key', 'crowd']));
    expect(s.find((x) => x.track.id === 'clash')!.score).toBeLessThan(s[0].score);
  });
  it('filters do-not-plays (title or artist), used tracks and explicit at weddings', () => {
    const ctx = { blocked: new Set([normKey('A-X', 'Macarena'), 'artist:ski']), usedIds: new Set(['u']), explicitAllowed: false };
    expect(score(T('1', { artist: 'A-X', title: 'Macarena (Bayside Boys Mix)' }), ctx)).toBeNull();
    expect(score(T('2', { artist: 'Ski & Friends' }), ctx)).toBeNull();
    expect(score(T('u', {}), ctx)).toBeNull();
    expect(score(T('3', { flags: ['explicit'] }), ctx)).toBeNull();
    expect(score(T('4', {}), ctx)).not.toBeNull();
  });
  it('penalises the same artist and boosts what worked before', () => {
    const prev = T('p', {});
    const a = T('a', { artist: 'Same' }), b = T('b', {});
    const learned = { track: new Map([['b', 0.9]]), pair: new Map([['p|b', 0.95]]), requested: new Map([['b', 3]]) };
    const s = suggest([a, b], { prev, recentArtists: ['Same'], learned });
    expect(s[0].track.id).toBe('b');
    expect(s[0].reasons.some((r) => r.k === 'worked')).toBe(true);
    expect(s[0].reasons.some((r) => r.k === 'requested')).toBe(true);
  });
});

describe('filling a section', () => {
  it('builds a harmonic chain that climbs in energy without repeats', () => {
    const pool = [
      T('a', { key: '8A', bpm: 124, energy: 5 }), T('b', { key: '9A', bpm: 125, energy: 6 }), T('c', { key: '10A', bpm: 126, energy: 7 }),
      T('d', { key: '10A', bpm: 127, energy: 8 }), T('x', { key: '2B', bpm: 90, energy: 3 }), T('y', { key: '5B', bpm: 140, energy: 9 }),
    ];
    const chain = fillChain(pool, T('start', { key: '8A', bpm: 124, energy: 5 }), 4, { section: { energyFrom: 5, energyTo: 8 } });
    expect(chain).toHaveLength(4);
    expect(new Set(chain.map((c) => c.id)).size).toBe(4);
    expect(chain.some((c) => c.id === 'x')).toBe(false);
    expect(chain[chain.length - 1].energy).toBeGreaterThanOrEqual(chain[0].energy!);
  });
});

describe('energy curve', () => {
  it('maps items over time against the target and warns about dips', () => {
    const sections = [{ id: 's1', kind: 'peak' as const, label: 'Piek', minutes: 20, energyFrom: 8, energyTo: 9 }];
    const tracks = new Map([['a', T('a', { energy: 8 })], ['b', T('b', { energy: 4 })], ['c', T('c', { energy: 4 })]]);
    const pts = energyCurve(sections, [{ sectionId: 's1', trackId: 'a' }, { sectionId: 's1', trackId: 'b' }, { sectionId: 's1', trackId: 'c' }], tracks);
    expect(pts.map((p) => p.atMin)).toEqual([0, 4, 8]);
    expect(curveWarnings(pts).some((w) => w.kind === 'dip')).toBe(true);
  });
});

describe('learning', () => {
  it('per event type, smoothed, with transitions that worked twice', () => {
    const gigType = new Map([['g1', 'wedding' as const], ['g2', 'wedding' as const], ['g3', 'club' as const]]);
    const plays = [
      { gigId: 'g1', trackId: 'a', at: '1', reaction: 'good' as const }, { gigId: 'g1', trackId: 'b', at: '2', reaction: 'fire' as const },
      { gigId: 'g2', trackId: 'a', at: '1' }, { gigId: 'g2', trackId: 'b', at: '2', reaction: 'fire' as const },
      { gigId: 'g3', trackId: 'b', at: '1', reaction: 'empty' as const },
    ];
    const l = learn(plays, gigType, 'wedding');
    expect(l.track.get('b')).toBeCloseTo((2 + 1) / 4);
    expect(l.pair.get('a|b')).toBeCloseTo((2 + 1) / 4);
    expect(learn(plays, gigType, 'club').track.get('b')).toBeCloseTo(1 / 3);
  });
  it('templates cover every event type', () => {
    const covered = new Set(DEFAULT_SET_TEMPLATES.flatMap((t) => t.eventTypes));
    for (const e of ['wedding', 'village_festival', 'carnival', 'club', 'private_party', 'company', 'festival', 'other']) expect(covered.has(e as never)).toBe(true);
  });
});
