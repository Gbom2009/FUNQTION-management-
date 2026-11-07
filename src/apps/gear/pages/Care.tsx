import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../../../core/i18n';
import { useSession } from '../../../core/session';
import { Field, Modal, Section, useToast } from '../../../core/ui';
import { centsFromInput, fmtDate } from '../../../core/format';
import { save } from '../../../core/repo';
import { todayStr } from '../../../core/dates';
import { GEAR_CATEGORIES, type GearCategory, type GearIssue, type MaintenancePlan } from '../../../core/types';
import { logMaintenance, resolveIssue, sendToRepair, useGearItems, useIssues, useLogs, usePlans, useSafetyTests } from '../data';
import { maintenanceDue, safetyDue } from '../domain/gear';

export default function Care() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const { settings } = useSession();
  const items = useGearItems();
  const plans = usePlans();
  const logs = useLogs();
  const issues = useIssues();
  const tests = useSafetyTests();
  const today = todayStr();
  const byId = new Map(items.map((i) => [i.id, i]));
  const due = maintenanceDue(plans, items, logs, today).filter((d) => d.soon || d.overdue)
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
  const safety = settings.gearSafetyTests ? safetyDue(items, tests, settings, today).filter((d) => d.overdue || d.soon) : [];
  const openIssues = issues.filter((i) => i.status === 'open' || i.status === 'in_repair');
  const [resolve, setResolve] = useState<GearIssue | null>(null);
  const [repair, setRepair] = useState<GearIssue | null>(null);
  const [plan, setPlan] = useState<MaintenancePlan | null>(null);
  return (
    <div>
      <div className="page-head"><h1>{t('g.care')}</h1></div>
      <div className="layout-2">
        <div>
          <Section title={t('g.openIssues')}>
            {openIssues.length === 0 ? <p className="small muted">{t('g.noIssues')}</p> : (
              <div className="list">{openIssues.map((i) => {
                const it = byId.get(i.itemId);
                return (
                  <div key={i.id} className="list-item" style={{ flexWrap: 'wrap' }}>
                    <div className="grow"><div className="strong">{i.title}</div><div className="tiny muted">{it ? <Link to={`/gear/items/${it.id}`}>{it.code} {it.name}</Link> : ''} · {t(`g.sev.${i.severity}`)}{i.repairBy ? ` · ${i.repairBy}` : ''}{i.expectedBack ? ` · ${fmtDate(i.expectedBack, lang)}` : ''}</div></div>
                    <span className="pill">{t(`g.issue.${i.status}`)}</span>
                    {i.status === 'open' && <button className="btn small" onClick={() => setRepair(i)}>{t('g.toRepair')}</button>}
                    <button className="btn small primary" onClick={() => setResolve(i)}>{t('g.resolve')}</button>
                  </div>
                );
              })}</div>
            )}
          </Section>
          <Section title={t('g.due')}>
            {due.length + safety.length === 0 ? <p className="small muted">{t('g.nothingDue')}</p> : (
              <div className="list">
                {due.map((d) => {
                  const it = byId.get(d.itemId)!;
                  return (
                    <div key={`${d.planId}${d.itemId}`} className="list-item" style={{ flexWrap: 'wrap' }}>
                      <div className="grow"><div className={d.overdue ? 'strong danger-text' : 'strong'}>{d.title}</div>
                        <div className="tiny muted">{it.code} {it.name} · {d.dueDate ? fmtDate(d.dueDate, lang) : t(`g.dueAt.${d.unit!}`, { n: d.dueAt!, now: d.unit === 'hours' ? it.usageHours : it.usageGigs })}</div></div>
                      <button className="btn small" onClick={async () => { await logMaintenance(it, d.planId, 'ok', d.title); toast(t('common.saved')); }}>✓ {t('g.done')}</button>
                      <button className="btn small ghost" onClick={async () => { await logMaintenance(it, d.planId, 'issue', d.title); toast(t('common.saved')); }}>! {t('g.problem')}</button>
                    </div>
                  );
                })}
                {safety.map((d) => { const it = byId.get(d.itemId)!; return (
                  <Link key={`s${d.itemId}`} className="list-item" to={`/gear/items/${it.id}`}><span className="grow"><span className={d.overdue ? 'strong danger-text' : 'strong'}>{t('g.safetyDue')}</span><br /><span className="tiny muted">{it.code} {it.name} · {d.title === 'safety_never' ? t('g.neverTested') : fmtDate(d.dueDate, lang)}</span></span></Link>
                ); })}
              </div>
            )}
          </Section>
        </div>
        <div>
          <Section title={t('g.plans')} actions={<button className="btn small" onClick={() => setPlan({ id: '', createdAt: '', createdBy: 'system', updatedAt: '', updatedBy: 'system', title: '', trigger: 'days', interval: 90, active: true, category: 'audio_cables' })}>+</button>}>
            <div className="list">{plans.map((p) => (
              <button key={p.id} className="list-item" style={{ border: 0, textAlign: 'left', cursor: 'pointer' }} onClick={() => setPlan(p)}>
                <span className="grow"><span className="strong">{p.title}</span><br /><span className="tiny muted">{p.itemId ? byId.get(p.itemId)?.name : t(`g.cat.${p.category!}`)} · {t(`g.every.${p.trigger}`, { n: p.interval })}{p.active ? '' : ` · ${t('ct.inactive')}`}</span></span>
              </button>
            ))}</div>
          </Section>
          {!settings.gearSafetyTests && <p className="tiny muted">{t('g.safetyOff')} <Link to="/gear/settings">{t('nav.settings')}</Link></p>}
        </div>
      </div>
      {resolve && <ResolveDialog issue={resolve} onClose={() => setResolve(null)} />}
      {repair && <RepairDialog issue={repair} onClose={() => setRepair(null)} />}
      {plan && <PlanDialog plan={plan} onClose={() => setPlan(null)} />}
    </div>
  );
}

function ResolveDialog({ issue, onClose }: { issue: GearIssue; onClose: () => void }) {
  const { t } = useI18n();
  const [work, setWork] = useState('');
  const [cost, setCost] = useState('');
  const [by, setBy] = useState(issue.repairBy ?? '');
  const [writeOff, setWriteOff] = useState(false);
  return (
    <Modal title={`${t('g.resolve')}: ${issue.title}`} onClose={onClose} footer={<button className="btn primary" disabled={!work.trim()} onClick={async () => { await resolveIssue(issue, { work, cost: centsFromInput(cost), repairBy: by || undefined, writeOff }); onClose(); }}>{t('common.save')}</button>}>
      <Field label={t('g.work')}><textarea value={work} onChange={(e) => setWork(e.target.value)} /></Field>
      <div className="grid2">
        <Field label={t('g.repairBy')}><input value={by} onChange={(e) => setBy(e.target.value)} placeholder={t('g.self')} /></Field>
        <Field label={t('g.cost')} hint={t('g.costHint')}><input inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} /></Field>
      </div>
      <label className="check"><input type="checkbox" checked={writeOff} onChange={(e) => setWriteOff(e.target.checked)} />{t('g.writeOff')}</label>
    </Modal>
  );
}

function RepairDialog({ issue, onClose }: { issue: GearIssue; onClose: () => void }) {
  const { t } = useI18n();
  const [by, setBy] = useState('');
  const [back, setBack] = useState('');
  return (
    <Modal title={t('g.toRepair')} onClose={onClose} footer={<button className="btn primary" disabled={!by.trim()} onClick={async () => { await sendToRepair(issue, { repairBy: by, expectedBack: back || undefined }); onClose(); }}>{t('common.save')}</button>}>
      <Field label={t('g.repairBy')}><input value={by} onChange={(e) => setBy(e.target.value)} /></Field>
      <Field label={t('g.expectedBack')}><input type="date" value={back} onChange={(e) => setBack(e.target.value)} /></Field>
    </Modal>
  );
}

function PlanDialog({ plan, onClose }: { plan: MaintenancePlan; onClose: () => void }) {
  const { t } = useI18n();
  const items = useGearItems();
  const [d, setD] = useState(plan);
  return (
    <Modal title={d.title || t('g.plans')} onClose={onClose} footer={<button className="btn primary" disabled={!d.title.trim()} onClick={async () => { const { id, ...rest } = d; await save<MaintenancePlan>('maintenancePlans', id ? d : rest); onClose(); }}>{t('common.save')}</button>}>
      <Field label={t('g.name')}><input value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} /></Field>
      <div className="grid2">
        <Field label={t('g.category')}><select value={d.itemId ? '' : d.category ?? ''} onChange={(e) => setD({ ...d, category: (e.target.value || undefined) as GearCategory | undefined, itemId: e.target.value ? undefined : d.itemId })}><option value="">—</option>{GEAR_CATEGORIES.map((c) => <option key={c} value={c}>{t(`g.cat.${c}`)}</option>)}</select></Field>
        <Field label={t('g.orItem')}><select value={d.itemId ?? ''} onChange={(e) => setD({ ...d, itemId: e.target.value || undefined, category: e.target.value ? undefined : d.category })}><option value="">—</option>{items.map((i) => <option key={i.id} value={i.id}>{i.code} {i.name}</option>)}</select></Field>
        <Field label={t('g.trigger')}><select value={d.trigger} onChange={(e) => setD({ ...d, trigger: e.target.value as MaintenancePlan['trigger'] })}>{(['days', 'hours', 'gigs'] as const).map((x) => <option key={x} value={x}>{t(`g.trig.${x}`)}</option>)}</select></Field>
        <Field label={t('g.interval')}><input inputMode="numeric" value={d.interval} onChange={(e) => setD({ ...d, interval: Math.max(1, Number(e.target.value) || 1) })} /></Field>
      </div>
      <Field label={t('g.instructions')}><textarea value={d.instructions ?? ''} onChange={(e) => setD({ ...d, instructions: e.target.value })} /></Field>
      <label className="check"><input type="checkbox" checked={d.active} onChange={(e) => setD({ ...d, active: e.target.checked })} />{t('m.active')}</label>
    </Modal>
  );
}
