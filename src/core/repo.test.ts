import { beforeEach, describe, expect, it } from 'vitest';
import { useTestDatabase } from './db';
import { save, setActor, softDelete } from './repo';
import { exportAll, importMerge } from './backup';
import type { Person } from './types';

let n = 0;
beforeEach(() => { useTestDatabase('test-' + n++); setActor('gijs'); });

const person = (p: Partial<Person> = {}) => ({ firstName: 'Lisa', lastName: 'de Vries', language: 'nl' as const, tags: [], ...p });

describe('repo + audit', () => {
  it('logs inserts and field-level updates with the actor', async () => {
    const { db } = await import('./db');
    const p = await save<Person>('persons', person());
    setActor('coen');
    await save<Person>('persons', { ...p, phone: '0612345678' });
    const log = await db.audit.where('rowId').equals(p.id).sortBy('at');
    expect(log.map((l) => l.action)).toEqual(['insert', 'update']);
    expect(log[1].actor).toBe('coen');
    expect(log[1].changes).toEqual({ phone: [null, '0612345678'] });
  });

  it('skips no-op saves and soft deletes', async () => {
    const { db } = await import('./db');
    const p = await save<Person>('persons', person());
    await save<Person>('persons', { ...p });
    await softDelete('persons', p.id);
    const log = await db.audit.where('rowId').equals(p.id).toArray();
    expect(log.map((l) => l.action).sort()).toEqual(['delete', 'insert']);
    expect((await db.persons.get(p.id))?.deletedAt).toBeTruthy();
  });

  it('round-trips a backup with newest-wins merge', async () => {
    const p = await save<Person>('persons', person());
    const file = await exportAll();
    useTestDatabase('other-' + n++);
    expect(await importMerge(file)).toMatchObject({ inserted: 1 });
    expect(await importMerge(file)).toMatchObject({ inserted: 0, skipped: 1 });
    const newer = structuredClone(file);
    (newer.tables.persons[0] as Person).phone = '1';
    (newer.tables.persons[0] as Person).updatedAt = '2999-01-01T00:00:00.000Z';
    expect(await importMerge(newer)).toMatchObject({ updated: 1 });
    expect(p.id).toBeTruthy();
  });
});
