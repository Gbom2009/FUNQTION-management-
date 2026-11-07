import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useI18n } from '../../../core/i18n';
import { Empty } from '../../../core/ui';
import { fmtDate } from '../../../core/format';
import { todayStr } from '../../../core/dates';
import type { Contract } from '../../../core/types';
import { byId, useGigs } from '../../bookings/data';
import { GigPicker } from '../../invoicing/pages/Quotes';
import { createContract, useContracts } from '../data';
import { ContractPill } from '../components';
import { daysUntil } from '../domain/render';

type Filter = 'action' | 'sent' | 'signed' | 'cancelled' | 'all';

export default function Overview() {
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const contracts = useContracts();
  const gigs = byId(useGigs());
  const [filter, setFilter] = useState<Filter>('action');
  const [pick, setPick] = useState<null | 'ours' | 'theirs'>(params.get('new') ? 'ours' : null);
  const today = todayStr();
  const needsAction = (c: Contract) => c.status === 'draft' || !!c.pendingAddendum || (c.status === 'sent' && !!c.signBy && daysUntil(c.signBy, today) <= 1);
  const rows = contracts
    .filter((c) => (filter === 'all' ? true : filter === 'action' ? needsAction(c) : filter === 'sent' ? c.status === 'sent' || c.status === 'viewed' : c.status === filter))
    .sort((a, b) => (gigs.get(a.gigId)?.date ?? '').localeCompare(gigs.get(b.gigId)?.date ?? ''));
  const count = (f: Filter) => contracts.filter((c) => (f === 'action' ? needsAction(c) : f === 'sent' ? c.status === 'sent' : f === 'all' ? true : c.status === f)).length;
  return (
    <div>
      <div className="page-head">
        <h1>{t('app.contracts')}</h1>
        <div className="row">
          <button className="btn" onClick={() => setPick('theirs')}>+ {t('ct.newTheirs')}</button>
          <button className="btn primary" onClick={() => setPick('ours')}>+ {t('ct.new')}</button>
        </div>
      </div>
      <div className="scroll-x" style={{ marginBottom: 'var(--s4)' }}>
        <div className="chips">
          {(['action', 'sent', 'signed', 'cancelled', 'all'] as const).map((f) => (
            <button key={f} className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>{t(`ct.filter.${f}`)} · {count(f)}</button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? <Empty>{filter === 'action' ? t('ct.emptyAction') : t('ct.empty')}</Empty> : (
        <div className="list">
          {rows.map((c) => {
            const g = gigs.get(c.gigId);
            const left = c.signBy ? daysUntil(c.signBy, today) : undefined;
            return (
              <Link key={c.id} to={`/contracts/${c.id}`} className="list-item">
                <span className="small" style={{ minWidth: 90 }}>{fmtDate(g?.date, lang, { day: 'numeric', month: 'short', year: '2-digit' })}</span>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="strong">{g?.title ?? '—'} <span className="muted small">{c.number}{c.kind === 'theirs' ? ` · ${t('ct.theirs')}` : ''}</span></div>
                  <div className="tiny muted">
                    {c.status === 'sent' && left != null ? (left < 0 ? t('ct.expiredShort') : t('ct.signByShort', { n: left })) : ''}
                    {c.status === 'draft' ? t('ct.draftShort') : ''}
                    {c.status === 'signed' && c.signedAt ? t('ct.signedShort', { date: fmtDate(c.signedAt.slice(0, 10), lang) }) : ''}
                  </div>
                </div>
                <ContractPill c={c} />
              </Link>
            );
          })}
        </div>
      )}
      <p className="tiny muted" style={{ marginTop: 'var(--s5)' }}>{t('ct.overviewHint')}</p>
      {pick && <GigPicker onClose={() => { setPick(null); setParams({}); }} onPick={async (gigId) => {
        const c = await createContract(gigId, { kind: pick, title: pick === 'theirs' ? t('ct.theirsDefault') : undefined });
        nav(`/contracts/${c.id}`);
      }} />}
    </div>
  );
}
