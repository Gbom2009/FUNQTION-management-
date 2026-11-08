import { describe, expect, it } from 'vitest';
import { decodePayload, encodePayload, readAnswers } from '../../../core/share';
import type { Gig, MusicWish, Portal, TimelineStep } from '../../../core/types';
import { afterLock, buildSnapshot, cleanWishes, lockDate, mergeWishes, wishesMessage, type WishesAnswer } from './portal';

const base = { createdAt: '', createdBy: 'gijs' as const, updatedAt: '', updatedBy: 'gijs' as const };
const gig = (p: Partial<Gig> = {}): Gig => ({ ...base, id: 'g1', reference: '', title: 'Bruiloft Lisa & Tom', eventType: 'wedding', date: '2026-12-12', startTime: '20:00', endTime: '01:00', setupRequired: true, stage: 'confirmed', stageChangedAt: '', ownerId: 'gijs', performers: [], setSlots: [], contacts: [], musicWishes: [{ id: 'w1', kind: 'must_play', text: 'Avicii – Levels' }], notesInternal: 'GEHEIM: korting 10%', agreedFee: 150000, ...p } as Gig);
const portal: Portal = { ...base, id: 'p1', gigId: 'g1', sections: ['overview', 'timeline', 'contacts', 'wishes', 'documents', 'after'], lockDays: 7, showPlayed: 'top20', playedList: Array.from({ length: 30 }, (_, i) => `Track ${i}`).join('\n') };
const step = (kind: TimelineStep['kind'], at: string, label: string): TimelineStep => ({ ...base, id: label, gigId: 'g1', kind, plannedAt: new Date(`2026-12-12T${at}:00`).toISOString(), label });

describe('portal snapshot', () => {
  const input = {
    gig: gig(), portal, lang: 'nl' as const, clientFirstName: 'Lisa', steps: [step('doors', '19:30', 'Deuren open'), step('leave_home', '16:20', 'Vertrek Gijs'), step('set_start', '20:00', 'Start')],
    members: [{ name: 'Gijs', phone: '0612' }, { name: 'Coen' }], contacts: [{ name: 'Mark', role: 'ceremoniemeester', phone: '0699' }],
    docs: [{ k: 'quote' as const, no: 'O2026-G-0001', st: 'accepted', amt: 150000 }], answerWa: '31612', now: new Date('2026-11-01T10:00:00Z'),
  };
  it('contains what the client needs and nothing internal', () => {
    const s = buildSnapshot(input);
    expect(s.tl).toEqual([['19:30', 'Deuren open'], ['20:00', 'Start']]);   // no travel steps
    expect(s.us).toEqual([['Gijs', '0612']]);
    expect(s.wi).toEqual([['must_play', 'Avicii – Levels', undefined]]);
    expect(s.lock).toBe('2026-12-05');
    expect(s.pl).toBeUndefined(); // not played yet
    const json = JSON.stringify(s);
    expect(json).not.toContain('GEHEIM');
    expect(json).not.toContain('agreedFee');
  });
  it('shows the played list only after the gig, top 20 when asked', () => {
    const s = buildSnapshot({ ...input, gig: gig({ stage: 'played' }) });
    expect(s.pl).toHaveLength(20);
  });
  it('leaves out sections that are switched off', () => {
    const s = buildSnapshot({ ...input, portal: { ...portal, sections: ['overview'] } });
    expect([s.tl, s.us, s.wi, s.docs, s.lock]).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });
  it('fits comfortably in a link', () => {
    const big = buildSnapshot({ ...input, gig: gig({ musicWishes: Array.from({ length: 40 }, (_, i) => ({ id: String(i), kind: 'must_play', text: `Artiest ${i} – Een redelijk lang nummer ${i}` }) as MusicWish) }) });
    const enc = encodePayload(big);
    expect(enc.length).toBeLessThan(4000);
    expect(decodePayload(enc)).toEqual(JSON.parse(JSON.stringify(big)));
  });
});

describe('wishes back', () => {
  const ans: WishesAnswer = { k: 'wishes', g: 'g1', at: '2026-12-01T10:00:00Z', w: [['must_play', 'Avicii – Levels'], ['special_moment', 'Ed Sheeran – Perfect', '21:00'], ['do_not_play', 'Snollebollekes']], c: [['Mark', 'ceremoniemeester', '0699']], ok: { photo: true }, note: 'Graag veel jaren 90!' };
  it('round-trips through the message', () => {
    const msg = wishesMessage({ e: 'Bruiloft', l: 'nl' }, ans);
    expect(msg).toContain('3 nieuwe muziekwensen');
    expect(msg).toContain('• Moment: Ed Sheeran – Perfect (21:00)');
    expect(readAnswers(msg).map(cleanWishes)).toEqual([{ ...ans, ok: { photo: true, event: undefined } }]);
  });
  it('cleans rubbish', () => {
    const c = cleanWishes({ k: 'wishes', g: 'g1', at: 'x', w: [['hack', 'x'], ['genre', '  '], ['genre', 'Hardstyle', 'nu']], c: [['', 'x']], ok: { photo: 'yes' } } as never)!;
    expect(c.w).toEqual([['genre', 'Hardstyle']]);
    expect(c.c).toEqual([]);
    expect(c.ok).toEqual({ photo: undefined, event: undefined });
  });
  it('merges without duplicates and marks client wishes', () => {
    let n = 0;
    const r = mergeWishes(gig().musicWishes, ans.w, () => `n${n++}`, ans.at);
    expect(r.added).toBe(2); // Levels was already there (case/punctuation-insensitive)
    expect(r.wishes[1]).toMatchObject({ kind: 'special_moment', text: 'Ed Sheeran – Perfect', track: 'Ed Sheeran – Perfect', at: '21:00', by: 'client' });
    expect(r.wishes[2]).toMatchObject({ kind: 'do_not_play', text: 'Snollebollekes', track: undefined });
  });
  it('knows the lock date', () => {
    expect(lockDate({ date: '2026-12-12' }, 7)).toBe('2026-12-05');
    expect(afterLock('2026-12-06T10:00:00Z', '2026-12-05')).toBe(true);
    expect(afterLock('2026-12-05T10:00:00Z', '2026-12-05')).toBe(false);
  });
});
