import { describe, expect, it } from 'vitest';
import { useTestDatabase } from './db';
import { exportAll, importMerge } from './backup';
import { save, setActor } from './repo';

const meta = (who: 'gijs' | 'coen', at: string) => ({ createdAt: at, createdBy: who, updatedAt: at, updatedBy: who });
const line = (id: string, status: string, who: 'gijs' | 'coen') => ({ id, accountId: 'acc', date: '2026-11-01', amount: -100, counterparty: 'Shell', description: '',
  hash: 'same-hash', batchId: id, status, matches: [], ...meta(who, '2026-11-02') });

let n = 0;
describe('backup merge with clashing unique fields (two devices)', () => {
  it('keeps importing everything else and resolves each clash', async () => {
    setActor('gijs');
    // Device A (Gijs)
    const a = useTestDatabase('mergeA' + n++);
    await a.bankLines.put(line('A-line', 'matched', 'gijs') as never);
    await a.vatPeriods.put({ id: 'A-vat', key: '2027-Q1', boxes: {}, filedAt: '2027-04-20', ...meta('gijs', '2027-04-20') } as never);
    await a.gearItems.put({ id: 'A-item', code: 'FQ-0031', name: 'Hazer', kind: 'unique', category: 'effects', quantity: 1, owner: 'gijs', ...meta('gijs', '2026-11-03') } as never);
    await a.packLists.put({ id: 'A-pack', gigId: 'gig1', status: 'confirmed', setup: 'standard', lines: [], ...meta('gijs', '2026-11-05') } as never);
    await save('persons', { firstName: 'Lisa', lastName: '', language: 'nl', tags: [] } as never);
    const file = await exportAll();

    // Device B (Coen) made different records with the same unique values.
    const b = useTestDatabase('mergeB' + n++);
    await b.bankLines.put(line('B-line', 'unmatched', 'coen') as never);
    await b.vatPeriods.put({ id: 'B-vat', key: '2027-Q1', boxes: {}, ...meta('coen', '2027-04-25') } as never);
    await b.gearItems.put({ id: 'B-item', code: 'FQ-0031', name: 'Kabelhaspel', kind: 'unique', category: 'power', quantity: 1, owner: 'coen', ...meta('coen', '2026-11-04') } as never);
    await b.packLists.put({ id: 'B-pack', gigId: 'gig1', status: 'draft', setup: 'standard', lines: [], ...meta('coen', '2026-11-01') } as never);

    const r = await importMerge(file);
    // The unrelated record still arrives (before the fix, the whole import aborted).
    expect(await b.persons.count()).toBe(1);
    expect(r.conflicts.map((c) => [c.table, c.resolution]).sort()).toEqual([
      ['bankLines', 'took_incoming'], ['gearItems', 'renamed'], ['packLists', 'took_incoming'], ['vatPeriods', 'took_incoming'],
    ]);
    // Bank line: the matched copy wins, no duplicate left.
    expect((await b.bankLines.toArray()).map((l) => l.id)).toEqual(['A-line']);
    // VAT period: the filed one wins.
    expect((await b.vatPeriods.toArray()).map((v) => v.id)).toEqual(['A-vat']);
    // Pack list: the newest one wins.
    expect((await b.packLists.toArray()).map((p) => p.id)).toEqual(['A-pack']);
    // Gear: both real items kept; the imported one gets a temporary code.
    const items = (await b.gearItems.toArray()).sort((x, y) => x.id.localeCompare(y.id));
    expect(items.map((i) => i.code)).toEqual(['FQ-0031-DUP-A-IT', 'FQ-0031']);
  });

  it('keeps the local copy when it is the better one, and is idempotent', async () => {
    const a = useTestDatabase('mergeC' + n++);
    await a.bankLines.put(line('A-line', 'unmatched', 'gijs') as never);
    const file = await exportAll();
    const b = useTestDatabase('mergeD' + n++);
    await b.bankLines.put(line('B-line', 'matched', 'coen') as never);
    const r1 = await importMerge(file);
    expect(r1.conflicts).toEqual([{ table: 'bankLines', key: 'hash=same-hash', resolution: 'kept_local' }]);
    expect((await b.bankLines.toArray()).map((l) => l.id)).toEqual(['B-line']);
    const r2 = await importMerge(file);
    expect(r2.inserted).toBe(0);
  });
});
