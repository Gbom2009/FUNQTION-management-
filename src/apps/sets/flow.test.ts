import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useTestDatabase } from '../../core/db';
import { save, setActor } from '../../core/repo';
import { ensureSeed } from '../../core/seed';
import type { Track } from '../../core/types';
import { runTaskSync } from '../bookings/domain/taskSync';
import { blankGig, createGig } from '../bookings/data';
import { buildSession } from '../library/domain/serato';
import { addItems, blockKey, createPlanForGig, importSeratoHistory, learnedFor, matchWish, moveItem, recordPlay, setReaction } from './data';
import { isBlocked } from './domain/suggest';

let n = 0;
beforeEach(async () => { useTestDatabase('sets-' + n++); setActor('gijs'); await ensureSeed(); });
afterEach(async () => { await runTaskSync(); });

const tr = (p: Partial<Track>) => save<Track>('musicTracks', { artist: 'X', title: 'Y', moods: [], crowd: [], flags: [], owner: 'gijs', status: 'ok', source: 'unknown', cueNotes: [], ...p } as Track);

describe('set plans', () => {
  it('builds a plan from a wedding gig: template, performers, must-plays, moments, blocks', async () => {
    const { db } = await import('../../core/db');
    const perfect = await tr({ artist: 'Ed Sheeran', title: 'Perfect', bpm: 95, key: '1B' });
    const mrb = await tr({ artist: 'The Killers', title: 'Mr. Brightside', bpm: 148, key: '1B' });
    const gig = await createGig({
      ...blankGig('gijs'), title: 'Bruiloft Lisa & Tom', date: '2026-12-12', eventType: 'wedding', stage: 'confirmed',
      setSlots: [{ id: 's1', start: '20:00', end: '22:30', performers: ['gijs'] }, { id: 's2', start: '22:30', end: '01:00', performers: ['coen'] }],
      musicWishes: [
        { id: 'w1', kind: 'special_moment', text: 'Openingsdans', track: 'Ed Sheeran - Perfect' },
        { id: 'w2', kind: 'must_play', text: 'Killers - Mr Brightside' },
        { id: 'w3', kind: 'do_not_play', text: 'Los del Rio - Macarena' },
        { id: 'w4', kind: 'do_not_play', text: 'Snollebollekes' },
      ],
    });
    const plan = await createPlanForGig(gig.id);
    expect(plan.templateKey).toBe('wedding');
    expect(plan.sections[0]).toMatchObject({ kind: 'moment', performer: 'gijs' });
    expect(plan.sections[plan.sections.length - 1].performer).toBe('coen');
    expect(plan.items.find((i) => i.role === 'moment')).toMatchObject({ trackId: perfect.id, momentWishId: 'w1', locked: true });
    expect(plan.items.find((i) => i.role === 'must_play')).toMatchObject({ trackId: mrb.id });
    expect(isBlocked({ artist: 'Los Del Rio', title: 'Macarena (Bayside Boys Remix)' } as never, new Set(plan.blocked))).toBe(true);
    expect(isBlocked({ artist: 'Snollebollekes & Friends', title: 'Links Rechts' } as never, new Set(plan.blocked))).toBe(true);
    expect((await createPlanForGig(gig.id)).id).toBe(plan.id); // one plan per gig
    expect(await db.setTemplates.count()).toBeGreaterThan(3);
  });

  it('adds and moves items', async () => {
    const a = await tr({ title: 'A' }), b = await tr({ title: 'B' });
    let p = { id: 'p', name: 'x', status: 'draft', sections: [{ id: 's1', kind: 'warmup', label: 'W', minutes: 30, energyFrom: 4, energyTo: 6 }, { id: 's2', kind: 'peak', label: 'P', minutes: 30, energyFrom: 8, energyTo: 9 }], items: [], blocked: [] } as never as import('../../core/types').SetPlan;
    p = addItems(p, 's1', [a.id, b.id, a.id]);
    expect(p.items.map((i) => i.trackId)).toEqual([a.id, b.id]);
    p = moveItem(p, p.items[1].id, -1);
    expect(p.items.map((i) => i.trackId)).toEqual([b.id, a.id]);
    expect(matchWish('Perfect', [{ id: 'z', artist: 'Ed Sheeran', title: 'Perfect' } as Track])?.id).toBe('z');
    expect(blockKey('Snollebollekes')).toBe('artist:snollebollekes');
  });

  it('logs plays with reactions, learns, and imports Serato history without duplicates', async () => {
    const { db } = await import('../../core/db');
    const a = await tr({ artist: 'Martin Garrix', title: 'Animals' });
    await save<import('../../core/types').TrackFile>('trackFiles', { trackId: a.id, locationId: 'l', path: 'Club/a.mp3', format: 'mp3', sizeBytes: 1, audioHash: 'h', quality: 'ok', lastSeenAt: 'x' });
    const gig = await createGig({ ...blankGig('gijs'), title: 'Club', date: '2026-11-01', eventType: 'club', stage: 'confirmed' });
    const p = await recordPlay({ gigId: gig.id, trackId: a.id, source: 'tap', at: '2026-11-01T23:00:00.000Z' });
    await setReaction(p, 'fire');
    expect((await db.plays.get(p.id))?.reaction).toBe('fire');
    expect((await learnedFor('club')).track.get(a.id)).toBeCloseTo((1 + 1) / 3);
    const session = buildSession([
      { path: '/Users/gijs/Music/Club/a.mp3', title: 'Animals', artist: 'Martin Garrix', startedAt: Date.parse('2026-11-01T23:00:30Z') / 1000 },
      { title: 'Unknown Track', artist: 'Someone', startedAt: Date.parse('2026-11-01T23:05:00Z') / 1000 },
    ]);
    expect(await importSeratoHistory(session, gig.id)).toEqual({ added: 1, matched: 0, skipped: 1 });
    expect((await db.plays.where('gigId').equals(gig.id).toArray()).map((x) => x.rawTitle ?? x.trackId).sort()).toEqual([a.id, 'Unknown Track'].sort());
  });
});
