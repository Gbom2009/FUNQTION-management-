import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useI18n } from '../../../core/i18n';
import { Empty, Modal, Section } from '../../../core/ui';
import { fmtDate } from '../../../core/format';
import { todayStr } from '../../../core/dates';
import { save } from '../../../core/repo';
import type { SetTemplate } from '../../../core/types';
import { useGigs } from '../../bookings/data';
import { createPlan, createPlanForGig, ensureSetTemplates, useSetPlans, useSetTemplates } from '../data';
import { perfLabel } from '../components';

export default function SetList() {
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const plans = useSetPlans();
  const templates = useSetTemplates();
  const gigs = useGigs().filter((g) => g.date >= todayStr() && ['option', 'quote_sent', 'confirmed'].includes(g.stage)).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 12);
  const [blank, setBlank] = useState(false);
  useEffect(() => { void ensureSetTemplates(); }, []);
  const planFor = new Map(plans.filter((p) => p.gigId).map((p) => [p.gigId!, p]));
  return (
    <div className="stack" style={{ gap: 'var(--s6)' }}>
      <div className="page-head row between"><h1>{t('app.sets')}</h1><button className="btn" onClick={() => setBlank(true)}>+ {t('sets.newBlank')}</button></div>
      <Section title={t('sets.upcomingGigs')}>
        {gigs.map((g) => {
          const p = planFor.get(g.id);
          return (
            <div key={g.id} className="list-item">
              <span className="grow"><span className="strong">{g.title}</span> <span className="small muted">{fmtDate(g.date, lang)}</span></span>
              {p ? <Link className="btn small" to={`/sets/${p.id}`}>{t('sets.open')} ({p.items.length})</Link>
                : <button className="btn small primary" onClick={async () => nav(`/sets/${(await createPlanForGig(g.id)).id}`)}>{t('sets.makePlan')}</button>}
            </div>
          );
        })}
        {!gigs.length && <Empty>{t('gd.noUpcoming')}</Empty>}
      </Section>
      <Section title={t('sets.allPlans')}>
        {plans.map((p) => <Link key={p.id} className="list-item" to={`/sets/${p.id}`}><span className="grow">{p.name}</span><span className="tiny muted">{p.items.length} {t('sets.tracks')} · {p.sections.map((s) => perfLabel(s.performer)).filter((x, i, a) => a.indexOf(x) === i).join('/')}</span></Link>)}
      </Section>
      <Section title={t('sets.templates')}><div className="stack">{templates.map((tp) => <TemplateRow key={tp.id} tp={tp} />)}</div></Section>
      {blank && <BlankModal templates={templates} onClose={() => setBlank(false)} onCreate={async (name, key) => nav(`/sets/${(await createPlan(name, key)).id}`)} />}
    </div>
  );
}

function BlankModal({ templates, onClose, onCreate }: { templates: SetTemplate[]; onClose: () => void; onCreate: (name: string, key: string) => void }) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [key, setKey] = useState(templates[0]?.key ?? 'private');
  return (
    <Modal title={t('sets.newBlank')} onClose={onClose} footer={<button className="btn primary" disabled={!name} onClick={() => onCreate(name, key)}>{t('common.save')}</button>}>
      <label className="field"><span>{t('common.name')}</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Promo mix november" /></label>
      <label className="field"><span>{t('sets.template')}</span><select value={key} onChange={(e) => setKey(e.target.value)}>{templates.map((tp) => <option key={tp.key} value={tp.key}>{tp.name}</option>)}</select></label>
    </Modal>
  );
}

/** Template sections: one per line "label | minutes | energy from-to | bpm min-max". */
function TemplateRow({ tp }: { tp: SetTemplate }) {
  const { t } = useI18n();
  const [text, setText] = useState(tp.sections.map((s) => `${s.kind} | ${s.label} | ${s.minutes} | ${s.energyFrom}-${s.energyTo}${s.bpmMin ? ` | ${s.bpmMin}-${s.bpmMax}` : ''}`).join('\n'));
  return (
    <details className="card">
      <summary className="strong">{tp.name}</summary>
      <p className="tiny muted">{t('sets.templateHint')}</p>
      <textarea className="mono" rows={tp.sections.length + 1} value={text} onChange={(e) => setText(e.target.value)} />
      <button className="btn small" onClick={() => {
        const sections = text.split('\n').map((l) => l.split('|').map((x) => x.trim())).filter((p) => p.length >= 4).map((p) => {
          const [ef, et] = p[3].split('-').map(Number);
          const [bmin, bmax] = (p[4] ?? '').split('-').map(Number);
          return { kind: p[0] as SetTemplate['sections'][number]['kind'], label: p[1], minutes: Number(p[2]) || 30, energyFrom: ef || 5, energyTo: et || ef || 5, bpmMin: bmin || undefined, bpmMax: bmax || undefined };
        });
        void save<SetTemplate>('setTemplates', { ...tp, sections });
      }}>{t('common.save')}</button>
    </details>
  );
}
