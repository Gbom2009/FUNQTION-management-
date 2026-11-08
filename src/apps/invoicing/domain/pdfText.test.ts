import { describe, expect, it } from 'vitest';
import { breakLigatures, safeText } from './pdfText';

describe('ligature-safe PDF text', () => {
  it('splits punctuation pairs but leaves normal text alone', () => {
    expect(breakLigatures('https://x.nl')).toBe('https:\uFEFF/\uFEFF/x.nl');
    expect(breakLigatures('wacht...')).toBe('wacht.\uFEFF.\uFEFF.');
    expect(breakLigatures('a--b a==b')).toBe('a-\uFEFF-b a=\uFEFF=b');
    expect(breakLigatures('Team Funqtion · 3 × 2 m')).toBe('Team Funqtion · 3 × 2 m');
  });
  it('walks a definition but not svg, colours or widths', () => {
    const footer = () => ({ text: 'a//b' });
    const d = safeText({ content: ['x...', { text: [{ text: 'a::b', color: '#f6--' }], svg: '<svg a="//"/>' }], table: { widths: ['*', 'auto'] }, footer });
    expect(d.content[0]).toBe('x.\uFEFF.\uFEFF.');
    expect((d.content[1] as { text: { text: string; color: string }[] }).text[0]).toEqual({ text: 'a:\uFEFF:b', color: '#f6--' });
    expect((d.content[1] as { svg: string }).svg).toBe('<svg a="//"/>');
    expect(d.table.widths).toEqual(['*', 'auto']);
    expect(d.footer()).toEqual({ text: 'a/\uFEFF/b' });
  });
});
