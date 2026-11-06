import { db, DATA_TABLES } from './db';
import type { Base } from './types';

// Export / import of the whole local database. Until the self-hosted sync
// server exists, this is how Gijs and Coen share data between devices:
// export on one device, import (merge) on the other. Merge rule per record:
// the most recently updated version wins; nothing is ever lost from the
// receiving side that it changed later.

export interface BackupFile {
  app: 'funqtion';
  version: 1;
  exportedAt: string;
  tables: Record<string, unknown[]>;
}

export async function exportAll(): Promise<BackupFile> {
  const tables: Record<string, unknown[]> = {};
  for (const t of [...DATA_TABLES, 'audit', 'members', 'settings'] as const) {
    tables[t] = await db.table(t).toArray();
  }
  // Never export PIN hashes.
  tables.members = (tables.members as Record<string, unknown>[]).map(({ pinHash: _h, pinSalt: _s, ...m }) => m);
  return { app: 'funqtion', version: 1, exportedAt: new Date().toISOString(), tables };
}

export interface MergeResult { inserted: number; updated: number; skipped: number }

export async function importMerge(file: BackupFile): Promise<MergeResult> {
  if (file?.app !== 'funqtion' || !file.tables) throw new Error('invalid_backup');
  const res: MergeResult = { inserted: 0, updated: 0, skipped: 0 };
  await db.transaction('rw', [...DATA_TABLES.map((t) => db.table(t)), db.audit], async () => {
    for (const t of DATA_TABLES) {
      const rows = (file.tables[t] ?? []) as Base[];
      const table = db.table(t);
      for (const row of rows) {
        if (!row?.id) continue;
        const cur = (await table.get(row.id)) as Base | undefined;
        if (!cur) { await table.put(row); res.inserted++; }
        else if ((row.updatedAt ?? '') > (cur.updatedAt ?? '')) { await table.put(row); res.updated++; }
        else res.skipped++;
      }
    }
    const audit = (file.tables.audit ?? []) as { id: string }[];
    for (const a of audit) if (a?.id && !(await db.audit.get(a.id))) await db.audit.put(a as never);
  });
  return res;
}

export function download(filename: string, content: string, mime = 'application/json') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
