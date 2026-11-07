import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../../core/db';
import { useI18n } from '../../../core/i18n';
import { Empty, Modal, Section, useToast } from '../../../core/ui';
import { fmtDate } from '../../../core/format';
import type { SetItem, SetPlan, SetSection, Track } from '../../../core/types';
import { useTracks } from '../../library/data';
import { EMPTY_FILTER, filterTracks, sortTracks } from '../../library/pages/Collection';
import { EnergyBar, fmtDur, KeyChip } from '../../library/components';
import { exportM3u, exportRekordbox, exportSeratoCrate } from '../../library/exportData';
import { addItems, learnedFor, moveItem, savePlan, useSetPlan } from '../data';
import { curveWarnings, energyCurve, fillChain, suggest, type Cand, type Learned } from '../domain/suggest';
import { EnergyCurve, perfLabel } from '../components';

/** The planner: sections with tracks, the energy curve, suggestions for what's next. */
export default function SetEditor() {
  const { id } = useParams();
  const { t, lang } = useI18n();
  const toast = useToast();
  const plan = useSetPlan(id);
  const tracks = useTracks();
  const gig = useLiveQuery(() => (plan?.gigId ? db.gigs.get(plan.gigId) : undefined), [plan?.gigId]);
  const [secId, setSecId] = useState<string>();
  const [q, setQ] = useState('');
  const [learned, setLearned] = useState<Learned>();
  const [proposal, setProposal] = useState<Cand[] | null>(null);
  useEffect(() => { void learnedFor(gig?.eventType).then(setLearned); }, [gig?.eventType]);
  const byId = useMemo(() => new Map(tracks.map((x) => [x.id, x])), [tracks]);
  const pool: Track[] = useMemo(() => tracks.filter((x) => x.status !== 'retired'), [tracks]);

  if (plan === undefined) return <p className="muted">…</p>;
  if (!plan) return <Empty>{t('sets.notFound')}</Empty>;
  const sec = plan.sections.find((s) => s.id === secId) ?? plan.sections.find((s) => s.kind !== 'moment') ?? plan.sections[0];
  const secItems = (s: SetSection) => plan.items.filter((i) => i.sectionId === s.id);
  const lastInSec = sec ? secItems(sec).slice(-1)[0] : undefined;
  const lastAny = plan.items[plan.items.length - 1];
  const prev = byId.get((lastInSec ?? lastAny)?.trackId ?? '');
  const used = new Set(plan.items.map((i) => i.trackId));
  const blocked = new Set(plan.blocked);
  const recentArtists = plan.items.slice(-6).map((i) => byId.get(i.trackId)?.artist ?? '');
  const ctx = { prev, section: sec, progress: sec ? Math.min(1, secItems(sec).length / Math.max(1, sec.minutes / 4)) : 0, eventType: gig?.eventType, blocked, usedIds: used, recentArtists, learned };
  const sugg = suggest(pool, ctx, 8);
  const curve = energyCurve(plan.sections, plan.items, byId);
  const warn = curveWarnings(curve);
  const search = q.trim().length >= 2 ? sortTracks(filterTracks(pool, { ...EMPTY_FILTER, q }), 'artist').slice(0, 30) : [];
  const total = plan.items.reduce((a, i) => a + (byId.get(i.trackId)?.durationS ?? 240), 0);
  const planned = plan.sections.reduce((a, s) => a + s.minutes, 0);
  const upd = (p: SetPlan) => void savePlan(p);
  const add = (trackId: string) => { if (sec) upd(addItems(plan, sec.id, [trackId])); };
  const ids = plan.items.map((i) => i.trackId);
  const done = (r: { count: number; missing: unknown[] }) => toast(t('lib.exported', { n: r.count }) + (r.missing.length ? ` · ${t('lib.exportMissing', { n: r.missing.length })}` : ''));

  return (
    <div className="stack" style={{ gap: 'var(--s5)' }}>
      <div className="page-head row between">
        <div>
          <h1>{plan.name}</h1>
          {gig && <div className="small muted"><Link to={`/gigday/${gig.id}`}>{fmtDate(gig.date, lang)} · {gig.title}</Link></div>}
        </div>
        <div className="row">
          <Link className="btn primary" to={`/sets/${plan.id}/live`}>{t('sets.live')}</Link>
          <button className="btn small ghost" onClick={async () => done(await exportSeratoCrate(plan.name, ids))}>Serato crate</button>
          <button className="btn small ghost" onClick={async () => done(await exportRekordbox(plan.name, ids))}>Rekordbox XML</button>
          <button className="btn small ghost" onClick={async () => done(await exportM3u(plan.name, ids))}>M3U</button>
        </div>
      </div>

      <div className="card">
        <div className="row between tiny muted"><span>{t('sets.curve')}</span><span>{Math.round(total / 60)} / {planned} min · {plan.items.length} {t('sets.tracks')}</span></div>
        <EnergyCurve points={curve} />
        {warn.length > 0 && <div className="tiny danger-text">{warn.map((w) => `${t(`sets.warn.${w.kind}` as never)} @ ${Math.round(w.atMin)} min`).join(' · ')}</div>}
      </div>

      <div className="sets-grid">
        <div className="stack">
          {plan.sections.map((s) => (
            <div key={s.id} className={`sets-section ${s.id === sec?.id ? 'on' : ''}`}>
              <button className="sets-section-head" onClick={() => setSecId(s.id)}>
                <span className="strong">{s.label}</span>
                <span className="tiny muted">{s.minutes} min · E{s.energyFrom}→{s.energyTo}{s.bpmMin ? ` · ${s.bpmMin}–${s.bpmMax}` : ''} · {perfLabel(s.performer)}</span>
              </button>
              {secItems(s).map((it, i, arr) => <ItemRow key={it.id} it={it} tr={byId.get(it.trackId)} prev={byId.get(arr[i - 1]?.trackId ?? '')} onMove={(d) => upd(moveItem(plan, it.id, d))} onRemove={() => upd({ ...plan, items: plan.items.filter((x) => x.id !== it.id) })} onPerf={() => upd({ ...plan, items: plan.items.map((x) => (x.id === it.id ? { ...x, performer: x.performer === 'gijs' ? 'coen' : x.performer === 'coen' ? undefined : 'gijs' } : x)) })} />)}
            </div>
          ))}
        </div>

        <div className="stack">
          <Section title={`${t('sets.next')}${sec ? ` · ${sec.label}` : ''}`} actions={<button className="btn small ghost" onClick={() => setProposal(fillChain(pool, prev, 6, { section: sec, eventType: gig?.eventType, blocked, usedIds: used, recentArtists, learned }))}>{t('sets.fill')}</button>}>
            {sugg.map((s) => (
              <button key={s.track.id} className="sets-sugg" onClick={() => add(s.track.id)}>
                <span className="grow"><span className="strong">{s.track.title}</span> <span className="muted small">{s.track.artist}</span></span>
                <span className="mono-num small">{s.track.bpm ? Math.round(s.track.bpm) : '–'}</span><KeyChip k={s.track.key} /><EnergyBar e={s.track.energy} />
                <span className="sets-chips">{s.reasons.map((r, i) => <span key={i} className={`sets-chip ${r.good ? 'good' : 'bad'}`}>{t(`sets.r.${r.k}` as never, { v: r.v })}</span>)}</span>
              </button>
            ))}
            {!sugg.length && <p className="muted small">{t('sets.noSugg')}</p>}
          </Section>
          <Section title={t('sets.search')}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('lib.search')} />
            {search.map((x) => (
              <button key={x.id} className="sets-sugg" disabled={used.has(x.id)} onClick={() => add(x.id)}>
                <span className="grow"><span className="strong">{x.title}</span> <span className="muted small">{x.artist}</span></span>
                <span className="mono-num small">{x.bpm ? Math.round(x.bpm) : '–'}</span><KeyChip k={x.key} />
              </button>
            ))}
          </Section>
          {plan.blocked.length > 0 && <Section title={t('sets.blocked')}><ul className="gd-dont">{plan.blocked.map((b) => <li key={b}>{b.replace('artist:', '').replace('|', ' – ')}</li>)}</ul></Section>}
        </div>
      </div>

      {proposal && (
        <Modal title={t('sets.fill')} onClose={() => setProposal(null)} footer={<>
          <button className="btn ghost" onClick={() => setProposal(null)}>{t('common.cancel')}</button>
          <button className="btn primary" onClick={() => { if (sec) upd(addItems(plan, sec.id, proposal.map((p) => p.id))); setProposal(null); }}>{t('sets.accept')}</button>
        </>}>
          {proposal.map((p) => <div key={p.id} className="small">{p.artist} – {p.title} · {p.bpm ? Math.round(p.bpm) : '–'} · {p.key ?? '–'} · E{p.energy ?? '?'}</div>)}
          {!proposal.length && <p className="muted">{t('sets.noSugg')}</p>}
        </Modal>
      )}
    </div>
  );
}

function ItemRow({ it, tr, prev, onMove, onRemove, onPerf }: { it: SetItem; tr?: Track; prev?: Track; onMove: (d: -1 | 1) => void; onRemove: () => void; onPerf: () => void }) {
  const { t } = useI18n();
  const jump = prev?.bpm && tr?.bpm ? Math.abs(tr.bpm - prev.bpm) / prev.bpm > 0.06 && Math.abs(tr.bpm - prev.bpm * 2) / prev.bpm > 0.06 && Math.abs(tr.bpm * 2 - prev.bpm) / prev.bpm > 0.06 : false;
  return (
    <div className={`sets-item ${it.role}`}>
      <span className="grow">
        <span className="strong">{tr?.title ?? '?'}</span> <span className="muted small">{tr?.artist}</span>
        {it.role !== 'planned' && <span className="tiny"> · {t(`sets.role.${it.role}` as never)}</span>}
        {tr?.stream && <span className="tiny"> · ☁</span>}
        {jump && <span className="tiny danger-text"> · ⚠ BPM</span>}
      </span>
      <span className="mono-num small">{tr?.bpm ? Math.round(tr.bpm) : '–'}</span><KeyChip k={tr?.key} /><EnergyBar e={tr?.energy} />
      <span className="tiny muted">{fmtDur(tr?.durationS)}</span>
      <button className={`chip small ${it.performer ?? ''}`} onClick={onPerf}>{it.performer ? perfLabel(it.performer) : '·'}</button>
      <button className="btn small ghost" onClick={() => onMove(-1)} aria-label="up">↑</button>
      <button className="btn small ghost" onClick={() => onMove(1)} aria-label="down">↓</button>
      {!it.locked && <button className="btn small ghost" onClick={onRemove} aria-label="remove">✕</button>}
    </div>
  );
}
