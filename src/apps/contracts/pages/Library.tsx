import { useState } from 'react';
import { useI18n } from '../../../core/i18n';
import { Field, Modal, Section, useToast } from '../../../core/ui';
import { save, uid } from '../../../core/repo';
import { EVENT_TYPES, type Clause, type ClauseMode, type ClauseWhen, type ContractTemplate, type EventType, type Rider, type RiderItem } from '../../../core/types';
import { useAllClauses, useContractTemplates, useRiders } from '../data';
import { currentClauses } from '../domain/render';

type Tab = 'templates' | 'clauses' | 'riders';

export default function Library() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('templates');
  return (
    <div>
      <div className="page-head"><h1>{t('ct.library')}</h1></div>
      <div className="tabs" role="tablist">
        {(['templates', 'clauses', 'riders'] as const).map((x) => <button key={x} role="tab" aria-selected={tab === x} onClick={() => setTab(x)}>{t(`ct.lib.${x}`)}</button>)}
      </div>
      <p className="small muted" style={{ marginBottom: 'var(--s4)' }}>{t('ct.libHint')}</p>
      {tab === 'templates' && <Templates />}
      {tab === 'clauses' && <Clauses />}
      {tab === 'riders' && <Riders />}
    </div>
  );
}

function Templates() {
  const { t } = useI18n();
  const templates = useContractTemplates();
  const [edit, setEdit] = useState<ContractTemplate | null>(null);
  return (
    <>
      <div className="list">
        {templates.map((x) => (
          <button key={x.id} className="list-item" style={{ textAlign: 'left', border: 0, cursor: 'pointer' }} onClick={() => setEdit(x)}>
            <div className="grow"><div className="strong">{x.name}{!x.active ? ` (${t('ct.inactive')})` : ''}</div>
              <div className="tiny muted">{x.eventTypes.map((e) => t(`event.${e}`)).join(', ')} · {t(`ct.kind.${x.clientKind}`)} · {t(`ct.flow.${x.flow}`)}</div></div>
          </button>
        ))}
      </div>
      <div style={{ marginTop: 'var(--s4)' }}><button className="btn small" onClick={() => setEdit({ id: '', createdAt: '', createdBy: 'system', updatedAt: '', updatedBy: 'system', name: '', eventTypes: [], clientKind: 'consumer', flow: 'after_quote', clauses: [], active: true })}>+ {t('ct.lib.newTemplate')}</button></div>
      {edit && <TemplateEditor tpl={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function TemplateEditor({ tpl, onClose }: { tpl: ContractTemplate; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const clauses = currentClauses(useAllClauses());
  const riders = useRiders();
  const [d, setD] = useState<ContractTemplate>(tpl);
  const modeOf = (key: string) => d.clauses.find((x) => x.key === key);
  const setMode = (key: string, mode: ClauseMode | '', when?: ClauseWhen) => {
    const rest = d.clauses.filter((x) => x.key !== key);
    if (!mode) return setD({ ...d, clauses: rest });
    const idx = d.clauses.findIndex((x) => x.key === key);
    const entry = { key, mode, when: mode === 'auto' ? (when ?? 'outdoor') : undefined };
    const list = idx >= 0 ? d.clauses.map((x) => (x.key === key ? entry : x)) : [...d.clauses, entry];
    setD({ ...d, clauses: list });
  };
  return (
    <Modal title={d.name || t('ct.lib.newTemplate')} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>{t('common.cancel')}</button>
      <button className="btn primary" disabled={!d.name.trim()} onClick={async () => { const { id, ...rest } = d; await save<ContractTemplate>('contractTemplates', id ? d : rest); toast(t('common.saved')); onClose(); }}>{t('common.save')}</button></>}>
      <div className="grid2">
        <Field label={t('ct.lib.name')}><input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /></Field>
        <Field label={t('ct.signByDays')}><input inputMode="numeric" value={d.signByDays ?? ''} placeholder="7" onChange={(e) => setD({ ...d, signByDays: e.target.value ? Number(e.target.value) : undefined })} /></Field>
      </div>
      <div className="field"><span>{t('gig.eventType')}</span>
        <div className="chips">{EVENT_TYPES.map((e) => <button key={e} className="chip" aria-pressed={d.eventTypes.includes(e)} onClick={() => setD({ ...d, eventTypes: d.eventTypes.includes(e) ? d.eventTypes.filter((x) => x !== e) : [...d.eventTypes, e as EventType] })}>{t(`event.${e}`)}</button>)}</div>
      </div>
      <div className="field"><span>{t('ct.flow')}</span>
        <div className="chips">{(['together', 'after_quote', 'none'] as const).map((f) => <button key={f} className="chip" aria-pressed={d.flow === f} onClick={() => setD({ ...d, flow: f })}>{t(`ct.flow.${f}`)}</button>)}</div>
        <small className="muted tiny">{t(`ct.flowHint.${d.flow}`)}</small>
      </div>
      <div className="grid2">
        <Field label={t('ct.clientKind')}><select value={d.clientKind} onChange={(e) => setD({ ...d, clientKind: e.target.value as ContractTemplate['clientKind'] })}><option value="consumer">{t('ct.kind.consumer')}</option><option value="business">{t('ct.kind.business')}</option></select></Field>
        <Field label={t('ct.rider')}><select value={d.riderId ?? ''} onChange={(e) => setD({ ...d, riderId: e.target.value || undefined })}><option value="">—</option>{riders.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
      </div>
      <div className="grid2">
        <Field label={t('ct.lib.introNl')}><textarea rows={2} value={d.introNl ?? ''} onChange={(e) => setD({ ...d, introNl: e.target.value })} /></Field>
        <Field label={t('ct.lib.introEn')}><textarea rows={2} value={d.introEn ?? ''} onChange={(e) => setD({ ...d, introEn: e.target.value })} /></Field>
      </div>
      <div className="field"><span>{t('ct.clauses')}</span>
        <div className="table-wrap"><table className="tbl"><tbody>
          {clauses.map((c) => {
            const m = modeOf(c.key);
            return (
              <tr key={c.key}>
                <td>{c.key} · {c.titleNl}{c.only ? <span className="tiny muted"> ({t(`ct.kind.${c.only}`)})</span> : null}</td>
                <td><select className="input" value={m?.mode ?? ''} onChange={(e) => setMode(c.key, e.target.value as ClauseMode | '', m?.when)} aria-label={c.key}>
                  <option value="">—</option>{(['required', 'on', 'off', 'auto'] as const).map((x) => <option key={x} value={x}>{t(`ct.mode.${x}`)}</option>)}
                </select></td>
                <td>{m?.mode === 'auto' && <select className="input" value={m.when ?? 'outdoor'} onChange={(e) => setMode(c.key, 'auto', e.target.value as ClauseWhen)} aria-label={`${c.key} when`}>
                  {(['outdoor', 'setup', 'consumer', 'business'] as const).map((w) => <option key={w} value={w}>{t(`ct.when.${w}`)}</option>)}
                </select>}</td>
              </tr>
            );
          })}
        </tbody></table></div>
      </div>
      <label className="check"><input type="checkbox" checked={d.active} onChange={(e) => setD({ ...d, active: e.target.checked })} />{t('m.active')}</label>
    </Modal>
  );
}

function Clauses() {
  const { t } = useI18n();
  const clauses = currentClauses(useAllClauses());
  const [edit, setEdit] = useState<Clause | null>(null);
  return (
    <>
      <div className="list">
        {clauses.map((c) => (
          <button key={c.id} className="list-item" style={{ textAlign: 'left', border: 0, cursor: 'pointer' }} onClick={() => setEdit(c)}>
            <span className="strong" style={{ minWidth: 34 }}>{c.key}</span>
            <div className="grow"><div>{c.titleNl} <span className="muted small">/ {c.titleEn}</span></div>
              <div className="tiny muted">{t(`ct.cat.${c.category}`)} · v{c.version}{c.locked ? ' · 🔒' : ''}{c.only ? ` · ${t(`ct.kind.${c.only}`)}` : ''}{c.bodyBizNl ? ` · ${t('ct.lib.hasBiz')}` : ''}</div></div>
          </button>
        ))}
      </div>
      {edit && <ClauseEditor clause={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function ClauseEditor({ clause, onClose }: { clause: Clause; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [d, setD] = useState<Clause>(clause);
  const f = (k: 'titleNl' | 'titleEn' | 'bodyNl' | 'bodyEn' | 'bodyBizNl' | 'bodyBizEn' | 'note', rows = 0) => (
    <Field label={t(`ct.lib.${k}`)}>
      {rows ? <textarea rows={rows} value={d[k] ?? ''} onChange={(e) => setD({ ...d, [k]: e.target.value })} /> : <input value={d[k] ?? ''} onChange={(e) => setD({ ...d, [k]: e.target.value })} />}
    </Field>
  );
  return (
    <Modal title={`${d.key} · ${d.titleNl}`} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>{t('common.cancel')}</button>
      <button className="btn primary" onClick={async () => { await save<Clause>('clauses', { ...d, version: clause.version + 1, bodyBizNl: d.bodyBizNl || undefined, bodyBizEn: d.bodyBizEn || undefined }); toast(t('ct.lib.savedVersion', { v: clause.version + 1 })); onClose(); }}>{t('common.save')}</button></>}>
      <p className="tiny muted">{t('ct.lib.placeholders')}</p>
      <div className="grid2">{f('titleNl')}{f('titleEn')}</div>
      <div className="grid2">{f('bodyNl', 7)}{f('bodyEn', 7)}</div>
      <details><summary className="small">{t('ct.lib.bizVariant')}</summary><div className="grid2">{f('bodyBizNl', 5)}{f('bodyBizEn', 5)}</div></details>
      {f('note', 2)}
      <div className="row">
        <label className="check"><input type="checkbox" checked={!!d.locked} onChange={(e) => setD({ ...d, locked: e.target.checked })} />{t('ct.lib.locked')}</label>
        <label className="check"><input type="checkbox" checked={d.active} onChange={(e) => setD({ ...d, active: e.target.checked })} />{t('m.active')}</label>
      </div>
      <p className="tiny muted">{t('ct.lib.versionHint', { v: clause.version })}</p>
    </Modal>
  );
}

function Riders() {
  const { t } = useI18n();
  const riders = useRiders();
  const [edit, setEdit] = useState<Rider | null>(null);
  return (
    <>
      <Section>
        <div className="list">
          {riders.map((r) => (
            <button key={r.id} className="list-item" style={{ textAlign: 'left', border: 0, cursor: 'pointer' }} onClick={() => setEdit(r)}>
              <div className="grow"><div className="strong">{r.name}</div><div className="tiny muted">v{r.version} · {r.technical.length} + {r.hospitality.length}</div></div>
            </button>
          ))}
        </div>
        <div style={{ marginTop: 'var(--s4)' }}><button className="btn small" onClick={() => setEdit({ id: '', createdAt: '', createdBy: 'system', updatedAt: '', updatedBy: 'system', name: '', version: 0, technical: [], hospitality: [], active: true })}>+ {t('ct.lib.newRider')}</button></div>
      </Section>
      {edit && <RiderEditor rider={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

const toText = (items: RiderItem[]) => items.map((x) => `${x.nl} | ${x.en}`).join('\n');
const fromText = (text: string): RiderItem[] => text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
  const [nl, en] = l.split('|').map((x) => x.trim());
  return { id: uid(), nl, en: en || nl };
});

function RiderEditor({ rider, onClose }: { rider: Rider; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [name, setName] = useState(rider.name);
  const [tech, setTech] = useState(toText(rider.technical));
  const [hosp, setHosp] = useState(toText(rider.hospitality));
  return (
    <Modal title={name || t('ct.lib.newRider')} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>{t('common.cancel')}</button>
      <button className="btn primary" disabled={!name.trim()} onClick={async () => {
        const { id, ...rest } = rider;
        const next = { ...rest, name, version: rider.version + 1, technical: fromText(tech), hospitality: fromText(hosp) };
        await save<Rider>('riders', id ? { ...next, id } : next);
        toast(t('common.saved')); onClose();
      }}>{t('common.save')}</button></>}>
      <Field label={t('ct.lib.name')}><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <p className="tiny muted">{t('ct.lib.riderFormat')}</p>
      <Field label={t('ct.rider.technical')}><textarea rows={7} value={tech} onChange={(e) => setTech(e.target.value)} /></Field>
      <Field label={t('ct.rider.hospitality')}><textarea rows={5} value={hosp} onChange={(e) => setHosp(e.target.value)} /></Field>
    </Modal>
  );
}
