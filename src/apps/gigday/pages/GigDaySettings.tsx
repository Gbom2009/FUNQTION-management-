import { useEffect, useState } from 'react';
import { useI18n } from '../../../core/i18n';
import { useSession } from '../../../core/session';
import { save } from '../../../core/repo';
import { Check, Section, useToast } from '../../../core/ui';
import { DAY_PHASES, type DayPhase, type GigDayDefaults, type TaskTemplate, type TaskTemplateItem } from '../../../core/types';
import { defaultsOf, ensureTemplates, useTemplates } from '../data';

type NumKey = 'doorsBeforeFirstSet' | 'arriveBeforeSetup' | 'leaveBuffer' | 'avgSpeedKmh' | 'avgSpeedTrailerKmh';
type PerSetup = 'soundcheckBeforeDoors' | 'setupMinutes' | 'breakdownMinutes';

/** Timeline defaults and task templates (the "customise later" part). */
export default function GigDaySettings() {
  const { t } = useI18n();
  const { settings, updateSettings } = useSession();
  const d = defaultsOf(settings);
  const templates = useTemplates();
  useEffect(() => { void ensureTemplates(); }, []);
  const set = (p: Partial<GigDayDefaults>) => void updateSettings({ gigDay: { ...(settings.gigDay ?? {}), ...p } });
  const num = (k: NumKey, label: string) => (
    <label className="field" key={k}><span>{label}</span><input inputMode="numeric" value={d[k]} onChange={(e) => set({ [k]: Number(e.target.value) || 0 })} /></label>
  );
  const per = (k: PerSetup, label: string) => (
    <div className="grid2" key={k}>
      <label className="field"><span>{label} · {t('gd.setup.standard')}</span><input inputMode="numeric" value={d[k].standard} onChange={(e) => set({ [k]: { ...d[k], standard: Number(e.target.value) || 0 } })} /></label>
      <label className="field"><span>{label} · {t('gd.setup.dj_only')}</span><input inputMode="numeric" value={d[k].dj_only} onChange={(e) => set({ [k]: { ...d[k], dj_only: Number(e.target.value) || 0 } })} /></label>
    </div>
  );
  return (
    <div className="stack" style={{ gap: 'var(--s6)' }}>
      <div className="page-head"><h1>{t('gd.settings')}</h1></div>
      <Section title={t('gd.defaults')}>
        <div className="stack">
          {num('doorsBeforeFirstSet', t('gd.s.doors'))}
          {per('soundcheckBeforeDoors', t('gd.s.soundcheck'))}
          {per('setupMinutes', t('gd.s.setup'))}
          {per('breakdownMinutes', t('gd.s.breakdown'))}
          {num('arriveBeforeSetup', t('gd.s.arrive'))}
          {num('leaveBuffer', t('gd.s.buffer'))}
          <div className="grid2">{num('avgSpeedKmh', t('gd.s.speed'))}{num('avgSpeedTrailerKmh', t('gd.s.speedTrailer'))}</div>
          <div className="grid2">
            <label className="field"><span>{t('gd.s.dayBefore')}</span><input type="time" value={d.dayBeforeAt} onChange={(e) => set({ dayBeforeAt: e.target.value })} /></label>
            <label className="field"><span>{t('gd.s.wrapUp')}</span><input type="time" value={d.wrapUpAt} onChange={(e) => set({ wrapUpAt: e.target.value })} /></label>
          </div>
          <p className="tiny muted">{t('gd.s.hint')}</p>
        </div>
      </Section>
      <Section title={t('gd.templates')}>
        <p className="tiny muted">{t('gd.templatesHint')}</p>
        <div className="stack">{templates.map((tp) => <TemplateEditor key={tp.id} tp={tp} />)}</div>
      </Section>
    </div>
  );
}

const toText = (items: TaskTemplateItem[]) => items.map((i) => `${i.phase} | ${i.owner} | ${i.title}${i.laserOnly ? ' | laser' : ''}${i.outdoorOnly ? ' | buiten' : ''}`).join('\n');
export function parseTemplate(text: string): TaskTemplateItem[] {
  return text.split('\n').map((l) => l.split('|').map((x) => x.trim())).filter((p) => p.length >= 3 && p[2]).map((p) => ({
    phase: (DAY_PHASES as readonly string[]).includes(p[0]) ? (p[0] as DayPhase) : 'setup',
    owner: p[1] === 'gijs' || p[1] === 'coen' ? p[1] : 'both',
    title: p[2],
    ...(p.slice(3).includes('laser') ? { laserOnly: true } : {}),
    ...(p.slice(3).some((x) => x === 'buiten' || x === 'outdoor') ? { outdoorOnly: true } : {}),
  }));
}

function TemplateEditor({ tp }: { tp: TaskTemplate }) {
  const { t } = useI18n();
  const toast = useToast();
  const [text, setText] = useState(toText(tp.items));
  return (
    <details className="card">
      <summary className="strong">{tp.name} <span className="tiny muted">({tp.items.length})</span></summary>
      <div className="stack" style={{ marginTop: 'var(--s3)' }}>
        <Check label={t('gd.templateActive')} checked={tp.active} onChange={(v) => void save<TaskTemplate>('taskTemplates', { ...tp, active: v })} />
        <textarea rows={Math.min(14, tp.items.length + 2)} className="mono" value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn small" onClick={async () => { await save<TaskTemplate>('taskTemplates', { ...tp, items: parseTemplate(text) }); toast(t('common.saved')); }}>{t('common.save')}</button>
      </div>
    </details>
  );
}
