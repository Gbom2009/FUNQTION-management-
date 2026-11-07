import { useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { useSession } from '../session';
import { download, importMerge, makeBackup, readBackup, type MergeResult } from '../backup';
import { fmtDateTime } from '../format';
import { Field, useToast } from './index';
import { runTaskSync } from '../../apps/bookings/domain/taskSync';

/** Export / import of the whole suite, optionally encrypted. Used in every app's settings. */
export function BackupPanel() {
  const { t, lang } = useI18n();
  const { settings, updateSettings } = useSession();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Uint8Array | null>(null);
  const [result, setResult] = useState<MergeResult | null>(null);
  const ageDays = settings.lastBackupAt ? Math.floor((Date.now() - new Date(settings.lastBackupAt).getTime()) / 86_400_000) : null;

  async function doExport() {
    if (pass && pass.length < 8) { toast(t('backup.passTooShort')); return; }
    setBusy(true);
    try {
      const { bytes, name } = await makeBackup(pass || undefined);
      download(name, bytes, pass ? 'application/octet-stream' : 'application/zip');
      await updateSettings({ lastBackupAt: new Date().toISOString() });
    } finally { setBusy(false); }
  }

  async function doImport(bytes: Uint8Array) {
    setBusy(true);
    try {
      const { file, blobs } = await readBackup(bytes, pass || undefined);
      const r = await importMerge(file, blobs);
      setResult(r);
      toast(t('settings.importDone', { inserted: r.inserted, updated: r.updated, skipped: r.skipped }));
      setPending(null);
      runTaskSync();
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === 'passphrase_required') { setPending(bytes); toast(t('backup.needPass')); }
      else if (msg === 'wrong_passphrase') { setPending(bytes); toast(t('backup.wrongPass')); }
      else toast(t('settings.importError'));
    } finally { setBusy(false); }
  }

  return (
    <div className="stack">
      <p className="small muted">{t('settings.shareHint')}</p>
      <p className="small" style={{ color: ageDays == null || ageDays > 14 ? 'var(--warning)' : 'var(--ok)' }}>
        {settings.lastBackupAt ? t('backup.last', { when: fmtDateTime(settings.lastBackupAt, lang), days: ageDays ?? 0 }) : t('backup.never')}
      </p>
      <Field label={t('backup.pass')} hint={t('backup.passHint')}>
        <input type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} />
      </Field>
      <div className="row">
        <button className="btn primary" disabled={busy} onClick={doExport}>{t('settings.export')}</button>
        <button className="btn" disabled={busy} onClick={() => (pending ? doImport(pending) : fileRef.current?.click())}>{pending ? t('backup.retry') : t('settings.import')}</button>
        <input ref={fileRef} type="file" accept=".zip,.fqbackup,.json,application/json,application/zip" hidden
          onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) await doImport(new Uint8Array(await f.arrayBuffer())); }} />
      </div>
      {result && result.conflicts.length > 0 && (
        <div className="banner warn"><span>!</span><div className="txt">
          <div className="strong">{t('backup.conflicts', { n: result.conflicts.length })}</div>
          <ul className="small" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {result.conflicts.slice(0, 20).map((c, i) => <li key={i}>{t(`backup.res.${c.resolution}`, { table: c.table, key: c.key })}</li>)}
          </ul>
        </div></div>
      )}
    </div>
  );
}
