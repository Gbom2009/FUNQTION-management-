import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { db, DATA_TABLES } from './db';
import type { Base, GearPhoto, Receipt, VenuePhoto } from './types';

// Backups. Until a (home) server exists, this is how Gijs and Coen share data
// between devices and how the 7-year financial archive is kept.
//
// Format v2: a ZIP with data.json + receipts/<id>.<ext>, optionally encrypted
// with a passphrase (AES-GCM 256, key from PBKDF2-SHA256, 310k iterations).
// Format v1 (plain JSON, apps 1–2) can still be imported.
// Merge rule per record: the most recently updated version wins.

export interface BackupFile {
  app: 'funqtion';
  version: 1 | 2;
  exportedAt: string;
  tables: Record<string, unknown[]>;
}

const BLOB_TABLES = new Set(['receipts', 'gearPhotos', 'venuePhotos', 'artworks']);

export async function exportAll(): Promise<BackupFile> {
  const tables: Record<string, unknown[]> = {};
  for (const t of [...DATA_TABLES, 'audit', 'members', 'settings'] as const) {
    const rows = await db.table(t).toArray();
    // Blobs never go into JSON; they travel as separate files in the ZIP.
    tables[t] = BLOB_TABLES.has(t) ? (rows as { blob?: Blob }[]).map(({ blob: _b, ...r }) => r) : rows;
  }
  // Never export PIN hashes.
  tables.members = (tables.members as Record<string, unknown>[]).map(({ pinHash: _h, pinSalt: _s, ...m }) => m);
  return { app: 'funqtion', version: 2, exportedAt: new Date().toISOString(), tables };
}

export interface MergeConflict { table: string; key: string; resolution: 'kept_local' | 'took_incoming' | 'renamed' | 'failed' }
export interface MergeResult { inserted: number; updated: number; skipped: number; conflicts: MergeConflict[] }

// Tables with a unique field besides the id. Two devices can create *different*
// records with the same value (the same bank line imported on both phones, the
// same gear code, two pack lists for one gig). IndexedDB would reject the put
// and abort the whole import, so these are resolved record by record.
const UNIQUE: Partial<Record<string, string>> = { bankLines: 'hash', vatPeriods: 'key', gearItems: 'code', packLists: 'gigId', gigDays: 'gigId', taskTemplates: 'key', setTemplates: 'key', artworks: 'hash' };

type Row = Base & Record<string, unknown>;

/** Which of two clashing records to keep. Returns 'incoming', 'local' or 'both' (keep both, rename incoming). */
function resolveClash(table: string, local: Row, incoming: Row): 'incoming' | 'local' | 'both' {
  if (table === 'gearItems') return 'both'; // two real items: never drop one, give the incoming a new code
  if (table === 'bankLines') {
    // Same transaction: prefer the copy that is already explained (matched/private/…).
    const done = (r: Row) => r.status !== 'unmatched';
    if (done(incoming) && !done(local)) return 'incoming';
    return 'local';
  }
  if (table === 'vatPeriods') {
    if (incoming.filedAt && !local.filedAt) return 'incoming';
    if (local.filedAt && !incoming.filedAt) return 'local';
  }
  return (incoming.updatedAt ?? '') > (local.updatedAt ?? '') ? 'incoming' : 'local';
}

export async function importMerge(file: BackupFile, blobs: Map<string, Blob> = new Map()): Promise<MergeResult> {
  if (file?.app !== 'funqtion' || !file.tables) throw new Error('invalid_backup');
  const res: MergeResult = { inserted: 0, updated: 0, skipped: 0, conflicts: [] };
  await db.transaction('rw', [...DATA_TABLES.map((t) => db.table(t)), db.audit], async () => {
    for (const t of DATA_TABLES) {
      const rows = (file.tables[t] ?? []) as Row[];
      const table = db.table(t);
      const uniq = UNIQUE[t];
      for (const raw of rows) {
        if (!raw?.id) continue;
        let row = raw;
        if (BLOB_TABLES.has(t)) {
          const blob = blobs.get(row.id);
          if (!blob) { res.skipped++; continue; }
          row = { ...row, blob };
        }
        const cur = (await table.get(row.id)) as Row | undefined;
        if (cur && (row.updatedAt ?? '') <= (cur.updatedAt ?? '')) { res.skipped++; continue; }
        // Unique-field clash with a *different* local record?
        const value = uniq ? row[uniq] : undefined;
        const clash = uniq && value != null ? ((await table.where(uniq).equals(value as string).first()) as Row | undefined) : undefined;
        if (clash && clash.id !== row.id) {
          const key = `${uniq}=${String(value)}`;
          const choice = resolveClash(t, clash, row);
          if (choice === 'local') { res.conflicts.push({ table: t, key, resolution: 'kept_local' }); res.skipped++; continue; }
          if (choice === 'incoming') { await table.delete(clash.id); res.conflicts.push({ table: t, key, resolution: 'took_incoming' }); }
          if (choice === 'both') {
            // Keep both items; the incoming one gets a temporary code until it is relabelled.
            row = { ...row, [uniq as string]: `${String(value)}-DUP-${row.id.slice(0, 4).toUpperCase()}` };
            res.conflicts.push({ table: t, key, resolution: 'renamed' });
          }
        }
        try {
          await table.put(row);
          if (cur) res.updated++; else res.inserted++;
        } catch {
          // Never let one bad record abort the whole merge.
          res.conflicts.push({ table: t, key: row.id, resolution: 'failed' });
          res.skipped++;
        }
      }
    }
    const audit = (file.tables.audit ?? []) as { id: string }[];
    for (const a of audit) if (a?.id && !(await db.audit.get(a.id))) await db.audit.put(a as never);
  });
  return res;
}

const ext = (mime: string) => (mime.includes('pdf') ? 'pdf' : mime.includes('png') ? 'png' : 'jpg');

/** ZIP with data.json + receipt files + gear photos. */
export async function exportZip(): Promise<Uint8Array> {
  const data = await exportAll();
  const files: Record<string, Uint8Array> = { 'data.json': strToU8(JSON.stringify(data)) };
  const receipts = (await db.receipts.toArray()).filter((r) => !r.deletedAt);
  for (const r of receipts) files[`receipts/${r.id}.${ext(r.mime)}`] = new Uint8Array(await r.blob.arrayBuffer());
  const photos = (await db.gearPhotos.toArray()).filter((r) => !r.deletedAt);
  for (const r of photos) files[`gear/${r.id}.${ext(r.mime)}`] = new Uint8Array(await r.blob.arrayBuffer());
  const venuePhotos = (await db.venuePhotos.toArray()).filter((r) => !r.deletedAt);
  for (const r of venuePhotos) files[`venues/${r.id}.${ext(r.mime)}`] = new Uint8Array(await r.blob.arrayBuffer());
  const artworks = (await db.artworks.toArray()).filter((r) => !r.deletedAt);
  for (const r of artworks) files[`artwork/${r.id}.${ext(r.mime)}`] = new Uint8Array(await r.blob.arrayBuffer());
  files['README.txt'] = strToU8(`Funqtion backup ${data.exportedAt}\nImport via Instellingen > Gegevens & back-up.\n`);
  return zipSync(files, { level: 6 });
}

// ---------------------------------------------------------------------------
// Encryption (WebCrypto only).

const MAGIC = strToU8('FQENC1');
const ITER = 310_000;

async function deriveKey(pass: string, salt: Uint8Array) {
  const base = await crypto.subtle.importKey('raw', strToU8(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: ITER }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encrypt(data: Uint8Array, pass: string): Promise<Uint8Array> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pass, salt);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data as BufferSource));
  const out = new Uint8Array(MAGIC.length + 16 + 12 + ct.length);
  out.set(MAGIC, 0); out.set(salt, MAGIC.length); out.set(iv, MAGIC.length + 16); out.set(ct, MAGIC.length + 28);
  return out;
}

export const isEncrypted = (b: Uint8Array) => b.length > MAGIC.length && MAGIC.every((c, i) => b[i] === c);

export async function decrypt(b: Uint8Array, pass: string): Promise<Uint8Array> {
  const salt = b.slice(MAGIC.length, MAGIC.length + 16);
  const iv = b.slice(MAGIC.length + 16, MAGIC.length + 28);
  const key = await deriveKey(pass, salt);
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, b.slice(MAGIC.length + 28)));
  } catch {
    throw new Error('wrong_passphrase');
  }
}

/** Build the backup file (encrypted when a passphrase is given). */
export async function makeBackup(passphrase?: string): Promise<{ bytes: Uint8Array; name: string }> {
  const zip = await exportZip();
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  if (passphrase) return { bytes: await encrypt(zip, passphrase), name: `funqtion-backup-${stamp}.fqbackup` };
  return { bytes: zip, name: `funqtion-backup-${stamp}.zip` };
}

/** Read any backup: encrypted v2, ZIP v2 or legacy JSON v1. */
export async function readBackup(bytes: Uint8Array, passphrase?: string): Promise<{ file: BackupFile; blobs: Map<string, Blob> }> {
  let data = bytes;
  if (isEncrypted(data)) {
    if (!passphrase) throw new Error('passphrase_required');
    data = await decrypt(data, passphrase);
  }
  if (data[0] === 0x50 && data[1] === 0x4b) {
    const files = unzipSync(data);
    const file = JSON.parse(strFromU8(files['data.json'])) as BackupFile;
    const blobs = new Map<string, Blob>();
    const meta = new Map([...((file.tables.receipts ?? []) as Receipt[]), ...((file.tables.gearPhotos ?? []) as GearPhoto[]), ...((file.tables.venuePhotos ?? []) as VenuePhoto[]), ...((file.tables.artworks ?? []) as VenuePhoto[])].map((r) => [r.id, r.mime]));
    for (const [path, content] of Object.entries(files)) {
      const m = path.match(/^(?:receipts|gear|venues|artwork)\/([^.]+)\./);
      if (m) blobs.set(m[1], new Blob([content as BlobPart], { type: meta.get(m[1]) ?? 'image/jpeg' }));
    }
    return { file, blobs };
  }
  return { file: JSON.parse(strFromU8(data)) as BackupFile, blobs: new Map() };
}

export function download(filename: string, content: string | Uint8Array | Blob, mime = 'application/json') {
  const blob = content instanceof Blob ? content : new Blob([content as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
