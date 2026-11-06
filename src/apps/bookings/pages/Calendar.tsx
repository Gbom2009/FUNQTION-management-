import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../../../core/i18n';
import { useSession } from '../../../core/session';
import { Empty, Field, MemberChips, Modal, Section } from '../../../core/ui';
import { fmtDate, fmtDateLong, fmtMonth } from '../../../core/format';
import { monthMatrix, todayStr, toDateStr } from '../../../core/dates';
import { save, softDelete } from '../../../core/repo';
import { download } from '../../../core/backup';
import type { AvailabilityBlock, Gig, MemberId } from '../../../core/types';
import { byId, useBlocks, useGigs, useVenues } from '../data';
import { findConflicts } from '../domain/conflicts';
import { gigsToIcs } from '../domain/ics';
import { GigLine } from '../components/parts';

const TENTATIVE = new Set(['enquiry', 'option', 'quote_sent']);

export default function Calendar() {
  const { t, lang } = useI18n();
  const { settings, memberName, me } = useSession();
  const gigs = useGigs().filter((g) => g.date && g.stage !== 'lost' && g.stage !== 'cancelled');
  const blocks = useBlocks();
  const venues = byId(useVenues());
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [view, setView] = useState<'month' | 'agenda'>('month');
  const [who, setWho] = useState<MemberId | 'all'>('all');
  const [sel, setSel] = useState<string>(todayStr());
  const [blockOpen, setBlockOpen] = useState(false);

  const visible = gigs.filter((g) => who === 'all' || g.performers.includes(who));
  const visibleBlocks = blocks.filter((b) => who === 'all' || b.memberId === who);
  const byDate = useMemo(() => {
    const m = new Map<string, Gig[]>();
    for (const g of visible) m.set(g.date, [...(m.get(g.date) ?? []), g]);
    for (const list of m.values()) list.sort((a, b) => a.startTime.localeCompare(b.startTime));
    return m;
  }, [visible]);
  const conflictDays = useMemo(() => {
    const s = new Set<string>();
    for (const g of gigs) if (findConflicts(g, gigs, blocks, settings).some((c) => c.level === 'hard')) s.add(g.date);
    return s;
  }, [gigs, blocks, settings]);

  const days = monthMatrix(ym.y, ym.m);
  const today = todayStr();
  const weekdays = t('cal.weekdays').split(',');
  const shift = (n: number) => setYm(({ y, m }) => { const d = new Date(y, m + n, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const blocksOn = (d: string) => visibleBlocks.filter((b) => d >= b.from && d <= b.to);
  const selGigs = byDate.get(sel) ?? [];
  const selBlocks = blocksOn(sel);

  const agenda = visible.filter((g) => g.date >= today).sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));

  function exportIcs() {
    const ics = gigsToIcs(gigs.filter((g) => who === 'all' || g.performers.includes(who)), venues, { option: t('stage.option').toUpperCase() });
    download(`funqtion-${who === 'all' ? 'team' : who}.ics`, ics, 'text/calendar');
  }

  return (
    <div>
      <div className="page-head">
        <h1>{t('cal.title')}</h1>
        <div className="row">
          <div className="chips">
            <button className="chip" aria-pressed={view === 'month'} onClick={() => setView('month')}>{t('cal.month')}</button>
            <button className="chip" aria-pressed={view === 'agenda'} onClick={() => setView('agenda')}>{t('cal.agenda')}</button>
          </div>
          <div className="chips">
            {(['all', 'gijs', 'coen'] as const).map((w) => <button key={w} className="chip" aria-pressed={who === w} onClick={() => setWho(w)}>{w === 'all' ? t('common.all') : memberName(w)}</button>)}
          </div>
          <button className="btn small" onClick={() => setBlockOpen(true)}>{t('cal.block')}</button>
          <button className="btn small" onClick={exportIcs}>{t('cal.exportIcs')}</button>
        </div>
      </div>

      {view === 'month' ? (
        <div className="layout-2">
          <div>
            <div className="row between" style={{ marginBottom: 'var(--s3)' }}>
              <button className="btn small" onClick={() => shift(-1)} aria-label={t('cal.prev')}>←</button>
              <h2 style={{ textTransform: 'capitalize' }}>{fmtMonth(ym.y, ym.m, lang)}</h2>
              <div className="row">
                <button className="btn small ghost" onClick={() => { setYm({ y: now.getFullYear(), m: now.getMonth() }); setSel(today); }}>{t('cal.today')}</button>
                <button className="btn small" onClick={() => shift(1)} aria-label={t('cal.next')}>→</button>
              </div>
            </div>
            <div className="cal">
              {weekdays.map((w) => <div key={w} className="cal-wd">{w}</div>)}
              {days.map((d) => {
                const ds = toDateStr(d);
                const list = byDate.get(ds) ?? [];
                const bl = blocksOn(ds);
                return (
                  <button key={ds} className={`cal-day ${d.getMonth() !== ym.m ? 'other' : ''} ${ds === today ? 'today' : ''} ${ds === sel ? 'sel' : ''}`}
                    onClick={() => setSel(ds)} aria-label={fmtDateLong(ds, lang)}>
                    <span className="row between" style={{ width: '100%' }}>
                      <span className="num">{d.getDate()}</span>
                      {conflictDays.has(ds) && <span className="cal-conflict" title={t('gig.conflicts')}>⚠</span>}
                    </span>
                    {bl.map((b) => <span key={b.id} className="cal-block">{memberName(b.memberId)}</span>)}
                    {list.slice(0, 3).map((g) => (
                      <span key={g.id} className={`cal-ev ${TENTATIVE.has(g.stage) ? 'tentative' : ''}`} style={{ color: `var(--st-${g.stage})` }}>
                        <span className="lbl">{g.startTime} {g.performers.map((p) => (p === 'gijs' ? 'G' : 'C')).join('')} {g.title}</span>
                      </span>
                    ))}
                    {list.length > 3 && <span className="tiny muted">+{list.length - 3}</span>}
                  </button>
                );
              })}
            </div>
          </div>
          <Section title={fmtDateLong(sel, lang)} actions={<Link className="btn small primary" to={`/bookings/gigs/new?date=${sel}`}>+ {t('cal.newGigHere')}</Link>}>
            <div className="stack">
              {selBlocks.map((b) => (
                <div key={b.id} className="banner info"><span>◌</span><div className="txt grow">{memberName(b.memberId)} · {t(`cal.blockKind.${b.kind}`)} {b.note && `· ${b.note}`} <div className="tiny">{fmtDate(b.from, lang)} – {fmtDate(b.to, lang)}</div></div>
                  <button className="btn small ghost" onClick={() => softDelete('availability', b.id)}>{t('common.delete')}</button></div>
              ))}
              {selGigs.length === 0 && selBlocks.length === 0 && <p className="muted small">{t('cal.nothing')}</p>}
              {selGigs.length > 0 && <div className="list">{selGigs.map((g) => <GigLine key={g.id} gig={g} />)}</div>}
            </div>
          </Section>
        </div>
      ) : (
        agenda.length === 0 ? <Empty>{t('cal.nothing')}</Empty> : (
          <div className="stack">
            {Array.from(new Set(agenda.map((g) => g.date.slice(0, 7)))).map((mo) => (
              <div key={mo}>
                <div className="legend" style={{ margin: 'var(--s3) 0', textTransform: 'capitalize' }}>{fmtMonth(Number(mo.slice(0, 4)), Number(mo.slice(5, 7)) - 1, lang)}</div>
                <div className="list">{agenda.filter((g) => g.date.startsWith(mo)).map((g) => <GigLine key={g.id} gig={g} />)}</div>
              </div>
            ))}
          </div>
        )
      )}
      {blockOpen && <BlockDialog date={sel} defaultMember={me?.id ?? 'gijs'} onClose={() => setBlockOpen(false)} />}
      <div className="row tiny muted" style={{ marginTop: 'var(--s4)' }}>
        <MemberChips ids={['gijs']} /> Gijs <MemberChips ids={['coen']} /> Coen · <span className="cal-ev tentative" style={{ color: 'var(--st-option)' }}>{t('stage.option')}</span>
      </div>
    </div>
  );
}

function BlockDialog({ date, defaultMember, onClose }: { date: string; defaultMember: MemberId; onClose: () => void }) {
  const { t } = useI18n();
  const [d, setD] = useState<Partial<AvailabilityBlock>>({ memberId: defaultMember, from: date, to: date, kind: 'holiday' });
  async function submit() {
    if (!d.from || !d.to) return;
    await save<AvailabilityBlock>('availability', { ...(d as AvailabilityBlock), to: d.to < d.from ? d.from : d.to });
    onClose();
  }
  return (
    <Modal title={t('cal.block')} onClose={onClose} footer={<button className="btn primary" onClick={submit}>{t('common.save')}</button>}>
      <div className="grid2">
        <Field label={t('tasks.assignedTo')}>
          <select value={d.memberId} onChange={(e) => setD({ ...d, memberId: e.target.value as MemberId })}><option value="gijs">Gijs</option><option value="coen">Coen</option></select>
        </Field>
        <Field label={t('common.type')}>
          <select value={d.kind} onChange={(e) => setD({ ...d, kind: e.target.value as AvailabilityBlock['kind'] })}>
            {(['holiday', 'personal', 'other_job', 'other'] as const).map((k) => <option key={k} value={k}>{t(`cal.blockKind.${k}`)}</option>)}
          </select>
        </Field>
        <Field label={t('common.from')}><input type="date" value={d.from} onChange={(e) => setD({ ...d, from: e.target.value })} /></Field>
        <Field label={t('common.to')}><input type="date" value={d.to} onChange={(e) => setD({ ...d, to: e.target.value })} /></Field>
      </div>
      <Field label={t('common.notes')}><input value={d.note ?? ''} onChange={(e) => setD({ ...d, note: e.target.value })} /></Field>
    </Modal>
  );
}
