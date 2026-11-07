import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseCsv } from './gear';

// The repository is public. The starter gear list may describe the set-up, but must
// never contain what makes gear worth stealing or traceable: serial numbers,
// purchase dates, prices or replacement values. Those live in the app (or in a
// private CSV on the device, `*private*.csv` is git-ignored), never in git.
const PRIVATE_COLUMNS = ['serial', 'purchase_date', 'purchase_price_eur', 'replacement_value_eur'];

describe('public gear list (docs/gear-inventory/gear-list.csv)', () => {
  const rows = parseCsv(readFileSync('docs/gear-inventory/gear-list.csv', 'utf8'));

  it('still has the private columns (so the format stays importable)', () => {
    for (const c of PRIVATE_COLUMNS) expect(Object.keys(rows[0] ?? {})).toContain(c);
  });

  it('leaves serial numbers, dates and values empty', () => {
    const offenders = rows.flatMap((r) => PRIVATE_COLUMNS.filter((c) => (r[c] ?? '').trim()).map((c) => `${r.code}: ${c}`));
    expect(offenders).toEqual([]);
  });
});
