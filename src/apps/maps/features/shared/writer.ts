import { db, type DataTable } from "../../../../core/db";
import { save } from "../../../../core/repo";
import type { Base } from "../../../../core/types";

/**
 * Writes from Maps to the shared database. Text fields change on every key
 * press, so changes are collected per record and saved at most every 600 ms
 * (one audit entry instead of one per letter). Until a change is stored,
 * `overlay()` lays it over what the database returns, so inputs never jump back.
 */
type Row = Record<string, unknown>;
interface Pending { table: DataTable; id: string; changes: Row; create?: Row }

const pending = new Map<string, Pending>();
const inflight = new Map<string, Row>();
let timer: ReturnType<typeof setTimeout> | null = null;
let chain: Promise<void> = Promise.resolve();
const listeners = new Set<() => void>();

const key = (table: string, id: string) => `${table}:${id}`;

/** Queue changes for a record. `create` holds the fields for a record that may not exist yet. */
export function queueWrite(table: DataTable, id: string, changes: Row, create?: Row) {
  const k = key(table, id);
  const cur = pending.get(k);
  pending.set(k, { table, id, changes: { ...cur?.changes, ...changes }, create: cur?.create ?? create });
  timer ??= setTimeout(() => void flushWrites(), 600);
}

/** Store everything queued now (also on page hide). */
export function flushWrites(): Promise<void> {
  if (timer) { clearTimeout(timer); timer = null; }
  const batch = [...pending.values()];
  pending.clear();
  for (const p of batch) inflight.set(key(p.table, p.id), { ...inflight.get(key(p.table, p.id)), ...p.changes });
  chain = chain.then(async () => {
    for (const p of batch) {
      try {
        const cur = (await db.table(p.table).get(p.id)) as Row | undefined;
        if (cur) await save(p.table, { ...cur, ...p.changes } as unknown as Base);
        else if (p.create) await save(p.table, { ...p.create, ...p.changes, id: p.id } as unknown as Base);
      } catch (e) {
        console.warn("[maps] write failed", p.table, p.id, e);
      } finally {
        inflight.delete(key(p.table, p.id));
      }
    }
    listeners.forEach((f) => f());
  });
  return chain;
}

/** Unstored changes for a record (inflight first, then newer pending ones). */
export function overlay(table: DataTable, id: string): Row | undefined {
  const a = inflight.get(key(table, id));
  const b = pending.get(key(table, id))?.changes;
  return a || b ? { ...a, ...b } : undefined;
}

/** Called after each batch is stored (sync uses it to drop stale overlays). */
export function onFlushed(f: () => void) { listeners.add(f); return () => listeners.delete(f); }

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => void flushWrites());
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") void flushWrites(); });
}
