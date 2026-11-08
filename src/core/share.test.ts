import { describe, expect, it } from 'vitest';
import { answerCode, decodePayload, encodePayload, publicLink, readAnswers } from './share';

describe('local-mode links', () => {
  it('round-trips data, also with accents and emoji', () => {
    const v = { n: 'Lisa & Tom', t: 'Bruiloft in de Kluis – één topavond 🧡', list: Array.from({ length: 30 }, (_, i) => i) };
    const s = encodePayload(v);
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodePayload(s)).toEqual(v);
    expect(decodePayload('not-valid')).toBeNull();
  });
  it('puts the data after the # of the public hub', () => {
    const l = publicLink('https://gbom2009.github.io/FUNQTION-management-', 'f', { g: 'x' });
    expect(l).toMatch(/^https:\/\/gbom2009\.github\.io\/FUNQTION-management-\/#\/f\/[A-Za-z0-9_-]+$/);
    expect(decodePayload(l.split('/f/')[1])).toEqual({ g: 'x' });
  });
  it('finds answer codes in a pasted chat, even when wrapped', () => {
    const a = { k: 'fb', g: 'gig-1', at: '2026-11-08T10:00:00Z', r: 5, t: 'Top!' };
    const code = answerCode(a);
    const chat = `[08-11 10:01] Lisa: Hoi! Hier onze feedback\nCijfer: 5\n${code.slice(0, 30)}\n${code.slice(30)}\n[08-11 10:02] Lisa: 🧡`;
    expect(readAnswers(chat)).toEqual([a]);
    expect(readAnswers(`blabla ${code} en nog ${answerCode({ ...a, g: 'gig-2' })}`).map((x) => x.g)).toEqual(['gig-1', 'gig-2']);
    expect(readAnswers('FQ1:rubbish')).toEqual([]);
  });
});
