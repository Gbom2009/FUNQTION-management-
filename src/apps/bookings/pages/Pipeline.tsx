import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useI18n } from '../../../core/i18n';
import { Empty, MemberChips, StagePill } from '../../../core/ui';
import { download } from '../../../core/backup';
import { euro, fmtDate } from '../../../core/format';
import { STAGES, type Gig, type MemberId, type Stage } from '../../../core/types';
import { PIPELINE } from '../domain/pipeline';
import { byId, personLabel, useGigs, usePersons, useVenues } from '../data';
import { StageDialog, useConflicts } from '../components/parts';

function Card({ gig }: { gig: Gig }) {
  const { t, lang } = useI18n();
  const venues = byId(useVenues());
  const conflicts = useConflicts(gig);
  const v = gig.venueId ? venues.get(gig.venueId) : undefined;
  const optionSoon = gig.stage === 'option' && gig.optionExpiresAt && new Date(gig.optionExpiresAt).getTime() - Date.now() < 3 * 86_400_000;
  return (
    <Link to={`/bookings/gigs/${gig.id}`} className="gig-card" draggable
      onDragStart={(e) => { e.dataTransfer.setData('text/gig', gig.id); e.dataTransfer.effectAllowed = 'move'; }}>
      <div className="row between tiny muted"><span>{fmtDate(gig.date, lang, { day: 'numeric', month: 'short', year: '2-digit' })}</span><span>{gig.reference}</span></div>
      <div className="t">{gig.title || '—'}</div>
      <div className="tiny muted">{[v?.city, t(`event.${gig.eventType}`)].filter(Boolean).join(' · ')}</div>
      <div className="row between">
        <MemberChips ids={gig.performers} />
        <span className="small strong">{gig.agreedFee ? euro(gig.agreedFee, lang) : ''}</span>
      </div>
      {(conflicts.some((c) => c.level === 'hard') || optionSoon) && (
        <div className="tiny" style={{ color: 'var(--danger)' }}>
          {conflicts.some((c) => c.level === 'hard') && <>⛔ {t('gig.conflicts')} </>}
          {optionSoon && <>⏳ {t('gig.optionExpires')} {fmtDate(gig.optionExpiresAt, lang, { day: 'numeric', month: 'short' })}</>}
        </div>
      )}
    </Link>
  );
}

export default function Pipeline() {
  const { t } = useI18n();
  const gigs = useGigs();
  const persons = byId(usePersons());
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<'board' | 'list'>(() => (window.innerWidth < 900 ? 'list' : 'board'));
  const [year, setYear] = useState<string>('all');
  const [who, setWho] = useState<MemberId | 'all'>('all');
  const [showClosed, setShowClosed] = useState(false);
  const [drop, setDrop] = useState<Stage | null>(null);
  const [pending, setPending] = useState<{ gig: Gig; to: Stage } | null>(null);

  const years = Array.from(new Set(gigs.map((g) => g.date.slice(0, 4)).filter(Boolean))).sort().reverse();
  const filtered = gigs
    .filter((g) => year === 'all' || g.date.startsWith(year))
    .filter((g) => who === 'all' || g.performers.includes(who))
    .sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
  const mobileStage = (params.get('stage') as Stage) || PIPELINE.find((s) => filtered.some((g) => g.stage === s)) || 'enquiry';
  const columns: Stage[] = showClosed ? [...PIPELINE, 'lost', 'cancelled'] : PIPELINE;

  function onDrop(stage: Stage, e: React.DragEvent) {
    e.preventDefault();
    setDrop(null);
    const id = e.dataTransfer.getData('text/gig');
    const gig = gigs.find((g) => g.id === id);
    if (!gig || gig.stage === stage) return;
    setPending({ gig, to: stage });
  }

  function exportCsv() {
    const head = ['reference', 'title', 'date', 'start', 'end', 'stage', 'eventType', 'performers', 'client', 'fee', 'lostReason'];
    const rows = filtered.map((g) => [g.reference, g.title, g.date, g.startTime, g.endTime, g.stage, g.eventType, g.performers.join('+'),
      personLabel(g.clientPersonId ? persons.get(g.clientPersonId) : undefined), g.agreedFee ? (g.agreedFee / 100).toFixed(2) : '', g.lostReason ?? '']);
    const csv = [head, ...rows].map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\n');
    download(`funqtion-gigs-${new Date().toISOString().slice(0, 10)}.csv`, '﻿' + csv, 'text/csv');
  }

  return (
    <div>
      <div className="page-head">
        <div><h1>{t('pipe.title')}</h1><div className="sub only-desktop">{view === 'board' ? t('pipe.dragHint') : ''}</div></div>
        <div className="row">
          <div className="chips only-desktop">
            <button className="chip" aria-pressed={view === 'board'} onClick={() => setView('board')}>{t('pipe.board')}</button>
            <button className="chip" aria-pressed={view === 'list'} onClick={() => setView('list')}>{t('pipe.list')}</button>
          </div>
          <select className="input" style={{ width: 'auto' }} value={year} onChange={(e) => setYear(e.target.value)} aria-label={t('pipe.filterYear')}>
            <option value="all">{t('pipe.filterYear')}: {t('common.all')}</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <select className="input" style={{ width: 'auto' }} value={who} onChange={(e) => setWho(e.target.value as MemberId | 'all')} aria-label={t('pipe.filterPerformer')}>
            <option value="all">{t('pipe.filterPerformer')}: {t('common.all')}</option>
            <option value="gijs">Gijs</option><option value="coen">Coen</option>
          </select>
          <label className="check small only-desktop"><input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />{t('stage.showClosed')}</label>
          <button className="btn small only-desktop" onClick={exportCsv}>{t('pipe.exportCsv')}</button>
          <Link className="btn primary" to="/bookings/gigs/new">+ {t('gig.new')}</Link>
        </div>
      </div>

      {view === 'board' && (
        <div className="board only-desktop">
          {columns.map((s) => {
            const list = filtered.filter((g) => g.stage === s);
            return (
              <div key={s} className={`col ${drop === s ? 'drop' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setDrop(s); }} onDragLeave={() => setDrop((d) => (d === s ? null : d))} onDrop={(e) => onDrop(s, e)}>
                <div className="col-head"><StagePill stage={s} /><span className="small muted">{list.length}</span></div>
                <div className="col-body">
                  {list.length === 0 && <div className="tiny muted" style={{ padding: 'var(--s2)' }}>{t('pipe.empty')}</div>}
                  {list.map((g) => <Card key={g.id} gig={g} />)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* List view: always on mobile, optional on desktop */}
      <div className={view === 'board' ? 'only-mobile' : ''}>
        <div className="scroll-x" style={{ marginBottom: 'var(--s3)' }}>
          <div className="chips">
            {(showClosed ? STAGES : PIPELINE).map((s) => (
              <button key={s} className="chip" aria-pressed={mobileStage === s} onClick={() => setParams({ stage: s }, { replace: true })}>
                {t(`stage.${s}`)} <span className="muted">{filtered.filter((g) => g.stage === s).length}</span>
              </button>
            ))}
          </div>
        </div>
        {filtered.filter((g) => g.stage === mobileStage).length === 0 ? <Empty>{t('pipe.empty')}</Empty> : (
          <div className="stack" style={{ gap: 'var(--s2)' }}>
            {filtered.filter((g) => g.stage === mobileStage).map((g) => <Card key={g.id} gig={g} />)}
          </div>
        )}
      </div>
      {pending && <StageDialog gig={pending.gig} to={pending.to} onClose={() => setPending(null)} />}
    </div>
  );
}
