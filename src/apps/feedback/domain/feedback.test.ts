import { describe, expect, it } from 'vitest';
import { readAnswers } from '../../../core/share';
import type { Gig, Review } from '../../../core/types';
import { answerMessage, applyAnswer, cleanAnswer, reminderDue, summary, type FeedbackAnswer, type FeedbackRequest } from './feedback';

const base = { createdAt: '', createdBy: 'gijs' as const, updatedAt: '', updatedBy: 'gijs' as const };
const req: FeedbackRequest = { v: 1, g: 'g1', n: 'Lisa', e: 'Bruiloft Lisa & Tom', d: '2026-12-12', l: 'nl' };
const ans: FeedbackAnswer = { k: 'fb', g: 'g1', at: '2026-12-13T10:00:00Z', r: 5, s: { music: 5, vibe: 4 }, rec: 10, h: ['full_floor'], t: 'Wat een feest!', pub: 'name', name: 'Lisa & Tom' };
const review = (p: Partial<Review>): Review => ({ ...base, id: 'r' + Math.random(), gigId: 'g1', ...p });

describe('feedback answers', () => {
  it('round-trips through the client\'s message', () => {
    const msg = answerMessage(req, ans);
    expect(msg).toContain('★★★★★');
    expect(msg).toContain('"Wat een feest!"');
    expect(msg).toContain('Mag gedeeld worden, met naam');
    const back = readAnswers(msg).map(cleanAnswer);
    expect(back).toEqual([ans]);
  });
  it('cleans tampered or partial answers', () => {
    const c = cleanAnswer({ k: 'fb', g: 'g1', at: 'x', r: 9, s: { music: -3, vibe: 3 }, rec: 42, h: ['full_floor', 'hack'], t: '  ', pub: 'yes' } as never)!;
    expect(c).toMatchObject({ r: 5, s: { music: 1, vibe: 3 }, rec: 10, h: ['full_floor'], t: undefined, pub: 'no' });
    expect(cleanAnswer({ k: 'wishes', g: 'g1', at: '' })).toBeNull();
  });
  it('records permission as consents and flags low scores', () => {
    const a = applyAnswer(ans, { id: 'g1', title: 'Bruiloft' }, 'nl', 'p1');
    expect(a.review).toMatchObject({ rating: 5, mayPublish: true, mayUseName: true, displayName: 'Lisa & Tom', source: 'feedback_form' });
    expect(a.consents.map((c) => [c.purpose, c.given])).toEqual([['testimonial_public', true], ['testimonial_name', true]]);
    expect(a.lowScore).toBe(false);
    const no = applyAnswer({ ...ans, pub: 'no', r: 3 }, { id: 'g1', title: 'Bruiloft' }, 'nl');
    expect(no.review.mayPublish).toBe(false);
    expect(no.consents).toHaveLength(1);
    expect(no.lowScore).toBe(true);
  });
  it('reminds once after the waiting time', () => {
    const r = review({ requestedAt: '2026-12-13T10:00:00Z' });
    expect(reminderDue(r, new Date('2026-12-17T10:00:00Z'))).toBe(false);
    expect(reminderDue(r, new Date('2026-12-18T10:00:00Z'))).toBe(true);
    expect(reminderDue({ ...r, receivedAt: 'x' }, new Date('2027-01-01'))).toBe(false);
  });
  it('summarises ratings, NPS and highlights', () => {
    const gigs = [{ id: 'g1', eventType: 'wedding' }, { id: 'g2', eventType: 'village_festival' }] as Gig[];
    const s = summary([
      review({ gigId: 'g1', rating: 5, scores: { recommend: 10, music: 5 }, highlights: ['full_floor', 'moments'] }),
      review({ gigId: 'g1', rating: 4, scores: { recommend: 6 }, highlights: ['full_floor'] }),
      review({ gigId: 'g2', rating: 3 }),
      review({ gigId: 'g2', requestedAt: 'x' }),
    ], gigs);
    expect(s).toMatchObject({ count: 3, avg: 4, nps: 0, scoreAvg: { music: 5 } });
    expect(s.byType[0]).toEqual({ type: 'wedding', count: 2, avg: 4.5 });
    expect(s.topHighlights[0]).toEqual({ h: 'full_floor', n: 2 });
  });
});
