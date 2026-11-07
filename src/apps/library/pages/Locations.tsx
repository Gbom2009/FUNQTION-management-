import { useState } from 'react';
import { useI18n } from '../../../core/i18n';
import { useSession } from '../../../core/session';
import { Empty, Modal, Section, useToast } from '../../../core/ui';
import { fmtDateTime } from '../../../core/format';
import { save } from '../../../core/repo';
import { db } from '../../../core/db';
import type { MusicLocation, Track, TrackFile } from '../../../core/types';
import { addLocation, analyseTrack, scanLocation, useLocations, useTrackFiles, useTracks, writeTags, type ScanProgress } from '../data';
import { canPickFolders, isDesktop, pickFolder } from '../fs';
import { sourceFor } from '../components';

/** Where the music lives: laptop folders, external drives, USB sticks. Scan, analyse, write tags. */
export default function Locations() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const locs = useLocations();
  const files = useTrackFiles();
  const tracks = useTracks();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [prog, setProg] = useState<ScanProgress | null>(null);

  const withSource = async (loc: MusicLocation) => {
    let src = await sourceFor(loc);
    if (!src) {
      const p = await pickFolder();
      if (!p) { toast(t('lib.noAccess')); return null; }
      if (p.handle) await db.dirHandles.put({ id: loc.id, handle: p.handle });
      if (p.absPath) await save<MusicLocation>('musicLocations', { ...loc, rootPath: p.absPath });
      src = await sourceFor({ ...loc, rootPath: p.absPath ?? loc.rootPath });
    }
    return src;
  };

  const scan = async (loc: MusicLocation) => {
    const src = await withSource(loc);
    if (!src) return;
    setBusy(loc.id);
    try { const r = await scanLocation(loc, src, setProg); toast(t('lib.scanDone', { added: r.added, errors: r.errors.length })); }
    finally { setBusy(null); setProg(null); }
  };

  const analyse = async (loc: MusicLocation) => {
    const src = await withSource(loc);
    if (!src) return;
    const mine = files.filter((f) => f.locationId === loc.id && !f.missing);
    const byId = new Map(tracks.map((x) => [x.id, x]));
    const todo = mine.filter((f) => { const tr = byId.get(f.trackId); return tr && (!tr.bpm || !tr.key || !tr.analysedAt); });
    setBusy(loc.id);
    let done = 0, failed = 0;
    for (const f of todo) {
      setProg({ done, total: todo.length, added: 0, updated: 0, errors: [], current: f.path });
      try { await analyseTrack((await db.musicTracks.get(f.trackId)) as Track, f, src); } catch { failed++; }
      done++;
    }
    setBusy(null); setProg(null);
    toast(t('lib.analyseDone', { n: done - failed, failed }));
  };

  const writeAll = async (loc: MusicLocation) => {
    const src = await withSource(loc);
    if (!src || !confirm(t('lib.writeAllConfirm'))) return;
    setBusy(loc.id);
    let n = 0;
    for (const f of files.filter((x) => x.locationId === loc.id && !x.missing && x.format === 'mp3') as TrackFile[]) {
      const tr = await db.musicTracks.get(f.trackId);
      if (tr && !tr.deletedAt && tr.status !== 'inbox' && (await writeTags(tr, f, src)) === 'ok') n++;
    }
    setBusy(null);
    toast(t('lib.tagsWritten', { n }));
  };

  return (
    <div>
      <div className="page-head row between"><h1>{t('lib.locations')}</h1><button className="btn primary" onClick={() => setAdding(true)}>+ {t('lib.addLocation')}</button></div>
      {!canPickFolders() && <div className="banner"><div className="txt">{t('lib.noFolderAccess')}</div></div>}
      {!locs.length ? <Empty>{t('lib.noLocations')}</Empty> : (
        <div className="stack">
          {locs.map((l) => {
            const mine = files.filter((f) => f.locationId === l.id);
            return (
              <Section key={l.id} title={l.name} actions={<span className="tiny muted">{t(`lib.kind.${l.kind}` as never)} · {l.owner === 'shared' ? t('lib.shared') : l.owner === 'gijs' ? 'Gijs' : 'Coen'}</span>}>
                <div className="small muted">{l.rootPath || t('lib.browserFolder')}</div>
                <div className="small">{t('lib.locStats', { files: mine.filter((f) => !f.missing).length, missing: mine.filter((f) => f.missing).length })}{l.lastScanAt ? ` · ${t('lib.lastScan')} ${fmtDateTime(l.lastScanAt, lang)}` : ''}</div>
                {busy === l.id && prog && <div className="small">{prog.total ? `${prog.done}/${prog.total}` : prog.done} · {prog.current}</div>}
                <div className="row" style={{ marginTop: 'var(--s2)' }}>
                  <button className="btn" disabled={!!busy} onClick={() => void scan(l)}>{t('lib.scan')}</button>
                  <button className="btn ghost" disabled={!!busy} onClick={() => void analyse(l)}>{t('lib.analyse')}</button>
                  <button className="btn ghost" disabled={!!busy} onClick={() => void writeAll(l)}>{t('lib.writeAll')}</button>
                </div>
              </Section>
            );
          })}
        </div>
      )}
      <p className="tiny muted" style={{ marginTop: 'var(--s5)' }}>{t('lib.locHint')}</p>
      {adding && <AddLocation onClose={() => setAdding(false)} />}
    </div>
  );
}

function AddLocation({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const { me } = useSession();
  const [p, setP] = useState<Pick<MusicLocation, 'name' | 'kind' | 'owner' | 'rootPath'>>({ name: '', kind: 'laptop', owner: me?.id ?? 'gijs', rootPath: '' });
  const [handle, setHandle] = useState<unknown>();
  return (
    <Modal title={t('lib.addLocation')} onClose={onClose} footer={<button className="btn primary" disabled={!p.name} onClick={async () => { await addLocation({ ...p, rootPath: p.rootPath || undefined }, handle); onClose(); }}>{t('common.save')}</button>}>
      <button className="btn" onClick={async () => { const r = await pickFolder(); if (r) { setHandle(r.handle); setP({ ...p, name: p.name || r.name, rootPath: r.absPath ?? p.rootPath }); } }}>{t('lib.pickFolder')}</button>
      <label className="field"><span>{t('common.name')}</span><input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} placeholder="MacBook Gijs – Music" /></label>
      <label className="field"><span>{t('lib.kind')}</span>
        <select value={p.kind} onChange={(e) => setP({ ...p, kind: e.target.value as MusicLocation['kind'] })}>{(['laptop', 'external', 'usb', 'nas'] as const).map((k) => <option key={k} value={k}>{t(`lib.kind.${k}` as never)}</option>)}</select>
      </label>
      <label className="field"><span>{t('lib.owner')}</span>
        <select value={p.owner} onChange={(e) => setP({ ...p, owner: e.target.value as MusicLocation['owner'] })}><option value="gijs">Gijs</option><option value="coen">Coen</option><option value="shared">{t('lib.shared')}</option></select>
      </label>
      <label className="field"><span>{t('lib.rootPath')}</span><input value={p.rootPath ?? ''} disabled={isDesktop()} onChange={(e) => setP({ ...p, rootPath: e.target.value })} placeholder="/Users/gijs/Music" /></label>
      <p className="tiny muted">{t('lib.rootPathHint')}</p>
    </Modal>
  );
}
