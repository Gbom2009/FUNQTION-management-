import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../../core/db';
import { alive } from '../../../core/repo';
import { useI18n } from '../../../core/i18n';
import { Section, useToast } from '../../../core/ui';
import { CROWD_TYPES, type CrowdType, type SetPlan } from '../../../core/types';
import { useTracks } from '../data';
import { checkUsb, exportM3u, exportRekordbox, exportSeratoCrate, type UsbReport } from '../exportData';
import { browserSource, isDesktop, pickFolder, tauriSource } from '../fs';

/** Get tracks out: Serato crates (also djay), Rekordbox XML (→ free Rekordbox builds CDJ sticks), M3U; and check a stick. */
export default function Export() {
  const { t } = useI18n();
  const toast = useToast();
  const tracks = useTracks();
  const plans = (useLiveQuery(async () => alive(await db.setPlans.toArray()), []) ?? []) as SetPlan[];
  const [what, setWhat] = useState<string>(plans[0] ? `plan:${plans[0].id}` : 'crowd:wedding');
  const [report, setReport] = useState<UsbReport | null>(null);

  const selection = (): { name: string; ids: string[] } => {
    if (what.startsWith('plan:')) {
      const p = plans.find((x) => x.id === what.slice(5));
      return { name: p?.name ?? 'Set', ids: [...new Set(p?.items.map((i) => i.trackId) ?? [])] };
    }
    const c = what.slice(6) as CrowdType;
    return { name: t(`lib.crowd.${c}` as never), ids: tracks.filter((x) => x.crowd.includes(c) && x.status !== 'retired').map((x) => x.id) };
  };
  const done = (r: { count: number; missing: { artist: string; title: string }[] }) =>
    toast(t('lib.exported', { n: r.count }) + (r.missing.length ? ` · ${t('lib.exportMissing', { n: r.missing.length })}` : ''));

  return (
    <div className="stack" style={{ gap: 'var(--s6)' }}>
      <div className="page-head"><h1>{t('lib.export')}</h1></div>
      <label className="field"><span>{t('lib.exportWhat')}</span>
        <select value={what} onChange={(e) => setWhat(e.target.value)}>
          {plans.map((p) => <option key={p.id} value={`plan:${p.id}`}>{t('lib.setPlan')}: {p.name}</option>)}
          {CROWD_TYPES.map((c) => <option key={c} value={`crowd:${c}`}>{t('lib.crowdList')}: {t(`lib.crowd.${c}` as never)}</option>)}
        </select>
      </label>
      <Section title="Serato / djay Pro">
        <p className="small muted">{isDesktop() ? t('lib.crateDesktop') : t('lib.crateBrowser')}</p>
        <button className="btn" onClick={async () => { const s = selection(); const r = await exportSeratoCrate(s.name, s.ids); done(r); }}>{t('lib.writeCrate')}</button>
      </Section>
      <Section title={t('lib.cdj')}>
        <p className="small muted">{t('lib.cdjHint')}</p>
        <button className="btn" onClick={async () => { const s = selection(); done(await exportRekordbox(s.name, s.ids)); }}>Rekordbox XML</button>
        <button className="btn ghost" onClick={async () => { const s = selection(); done(await exportM3u(s.name, s.ids)); }}>M3U</button>
      </Section>
      <Section title={t('lib.usbCheck')}>
        <p className="small muted">{t('lib.usbHint')}</p>
        <button className="btn" onClick={async () => {
          const p = await pickFolder();
          if (!p) return;
          let pioneer = false;
          if (p.absPath) {
            const fs = await import('@tauri-apps/plugin-fs');
            pioneer = await fs.exists(`${p.absPath}/PIONEER`);
          } else {
            try { await (p.handle as { getDirectoryHandle(n: string): Promise<unknown> }).getDirectoryHandle('PIONEER'); pioneer = true; } catch { pioneer = false; }
          }
          const src = p.absPath ? await tauriSource(p.absPath) : browserSource(p.handle);
          setReport(await checkUsb(src, selection().ids, pioneer));
        }}>{t('lib.pickStick')}</button>
        {report && (
          <div className="card" style={{ marginTop: 'var(--s3)' }}>
            <div className={report.missing.length ? 'danger-text strong' : 'strong'}>{t('lib.usbResult', { found: report.found, planned: report.planned })}</div>
            <div className="small">{report.hasRekordboxExport ? `✓ ${t('lib.usbRekordbox')}` : `! ${t('lib.usbNoRekordbox')}`}</div>
            {report.missing.map((m) => <div key={m.trackId} className="small">✕ {m.label}</div>)}
          </div>
        )}
      </Section>
    </div>
  );
}
