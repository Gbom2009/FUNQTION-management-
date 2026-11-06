import { db, type DataTable } from './db';
import type { AuditEntry, Base, MemberId } from './types';

// Every write in the suite goes through these helpers so the audit log
// ("who changed what") can never be skipped.

let actor: MemberId | 'system' = 'system';
export function setActor(a: MemberId | 'system') { actor = a; }
export function getActor() { return actor; }

export const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);

export const nowIso = () => new Date().toISOString();

const IGNORED = new Set(['updatedAt', 'updatedBy', 'createdAt', 'createdBy', 'blob']);

export function diff(oldRow: Record<string, unknown> | undefined, newRow: Record<string, unknown>) {
  const changes: Record<string, [unknown, unknown]> = {};
  const keys = new Set([...Object.keys(oldRow ?? {}), ...Object.keys(newRow)]);
  for (const k of keys) {
    if (IGNORED.has(k)) continue;
    const a = oldRow?.[k];
    const b = newRow[k];
    if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) changes[k] = [a ?? null, b ?? null];
  }
  return changes;
}

type NewRecord<T extends Base> = Omit<T, keyof Base> & Partial<Base>;

/** Insert or update a record, writing an audit entry with the field diff. */
export async function save<T extends Base>(table: DataTable, rec: NewRecord<T> | T, opts: { actor?: MemberId | 'system' } = {}): Promise<T> {
  const t = db.table(table);
  const who = opts.actor ?? actor;
  return db.transaction('rw', t, db.audit, async () => {
    const now = nowIso();
    const existing = rec.id ? ((await t.get(rec.id)) as T | undefined) : undefined;
    const row = {
      ...rec,
      id: rec.id ?? uid(),
      createdAt: existing?.createdAt ?? rec.createdAt ?? now,
      createdBy: existing?.createdBy ?? rec.createdBy ?? who,
      updatedAt: now,
      updatedBy: who,
    } as T;
    const changes = diff(existing as unknown as Record<string, unknown>, row as unknown as Record<string, unknown>);
    if (existing && Object.keys(changes).length === 0) return existing;
    await t.put(row);
    const entry: AuditEntry = {
      id: uid(), table, rowId: row.id, action: existing ? (row.deletedAt && !existing.deletedAt ? 'delete' : 'update') : 'insert',
      changes, actor: who, at: now,
    };
    await db.audit.add(entry);
    return row;
  });
}

/** Merge a partial change into an existing record. */
export async function patch<T extends Base>(table: DataTable, id: string, changes: Partial<T>, opts: { actor?: MemberId | 'system' } = {}): Promise<T | undefined> {
  const existing = (await db.table(table).get(id)) as T | undefined;
  if (!existing) return undefined;
  return save<T>(table, { ...existing, ...changes }, opts);
}

/** Soft delete: keeps the row for sync/audit, hides it everywhere. */
export async function softDelete(table: DataTable, id: string) {
  return patch(table, id, { deletedAt: nowIso() } as Partial<Base>);
}

export const alive = <T extends { deletedAt?: string | null }>(rows: T[]) => rows.filter((r) => !r.deletedAt);
