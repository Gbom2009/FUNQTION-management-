import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useI18n } from '../../../core/i18n';
import { useSession } from '../../../core/session';
import { useTracks } from '../../library/data';
import { KeyChip } from '../../library/components';
import { keepAwake } from '../../maps/location/wakeLock';
import { learnedFor, recordPlay, setReaction, usePlays, useSetPlan } from '../data';
import { suggest, type Cand, type Learned } from '../domain/suggest';
import { perfLabel } from '../components';
import RequestsPanel from '../../requests/RequestsPanel';

/**
 * Behind the decks (phone/tablet): now, the next planned tracks, what fits now,
 * one tap to log a play, reactions, and the guests' requests. Dark and big.
 */
export default function Live() {
  const { id } = useParams();
  const { t } = useI18n();
  const { me } = useSession();
  const plan = useSetPlan(id);
  const tracks = useTracks();
  const plays = usePlays(plan?.gigId);
  const [learned, setLearned] = useState<Learned>();
  const [q, setQ] = useState('');
  useEffect(() => { keepAwake(true); return () => keepAwake(false); }, []);
  useEffect(() => { void learnedFor().then(setLearned); }, []);
  const byId = useMemo(() => new Map(tracks.map((x) => [x.id, x])), [tracks]);
  if (!plan) return <p className="muted">…</p>;
  const mine = plays.filter((p) => !plan.gigId || p.setPlanId === plan.id || p.gigId === plan.gigId);
  const now = mine[mine.length - 1];
  const nowTrack = now?.trackId ? byId.get(now.trackId) : undefined;
  const played = new Set(mine.map((p) => p.trackId).filter(Boolean) as string[]);
  const next = plan.items.filter((i) => !played.has(i.trackId)).slice(0, 4);
  const sec = plan.sections.find((s) => s.id === next[0]?.sectionId);
  const fits = suggest(tracks.filter((x) => x.status !== 'retired') as Cand[], { prev: nowTrack, section: sec, blocked: new Set(plan.blocked), usedIds: played, recentArtists: mine.slice(-5).map((p) => byId.get(p.trackId ?? '')?.artist ?? ''), learned }, 5);
  const search = q.trim().length >= 2 ? tracks.filter((x) => `${x.artist} ${x.title}`.toLowerCase().includes(q.toLowerCase())).slice(0, 8) : [];
  const play = (trackId: string, source: 'tap' | 'plan' | 'request' = 'tap', requestId?: string) =>
    void recordPlay({ gigId: plan.gigId, setPlanId: plan.id, trackId, performer: me?.id, source, requestId });

  return (
    <div className="sets-live">
      <div className="row between">
        <Link to={`/sets/${plan.id}`} className="btn small ghost">← {plan.name}</Link>
        {plan.gigId && <Link to={`/gigday/${plan.gigId}/booth`} className="btn small ghost">{t('gd.booth')}</Link>}
      </div>
      <div className="sets-now">
        <div className="tiny muted">{t('sets.nowPlaying')}</div>
        {nowTrack ? <>
          <div className="sets-now-title">{nowTrack.title}</div>
          <div className="small">{nowTrack.artist} · <span className="mono-num">{nowTrack.bpm ? Math.round(nowTrack.bpm) : '–'}</span> · <KeyChip k={nowTrack.key} /> · E{nowTrack.energy ?? '?'}</div>
          <div className="sets-react">
            {(['fire', 'good', 'meh', 'empty'] as const).map((r) => <button key={r} aria-pressed={now?.reaction === r} onClick={() => now && void setReaction(now, r)}>{t(`sets.react.${r}` as never)}</button>)}
          </div>
        </> : <div className="muted">{now?.rawTitle ?? t('sets.nothingYet')}</div>}
      </div>

      <div className="sets-live-cols">
        <section>
          <h2>{t('sets.planned')}</h2>
          {next.map((i) => { const tr = byId.get(i.trackId); return (
            <button key={i.id} className="sets-live-row" onClick={() => play(i.trackId, 'plan')}>
              <span className="grow"><span className="strong">{tr?.title}</span> <span className="small muted">{tr?.artist}</span>{i.role !== 'planned' ? <span className="tiny"> · {t(`sets.role.${i.role}` as never)}</span> : null}</span>
              <span className="mono-num">{tr?.bpm ? Math.round(tr.bpm) : '–'}</span><KeyChip k={tr?.key} /><span className="tiny">{perfLabel(i.performer)}</span><span className="sets-go">▶</span>
            </button>
          ); })}
          {!next.length && <p className="muted small">{t('sets.planDone')}</p>}
        </section>
        <section>
          <h2>{t('sets.fitsNow')}</h2>
          {fits.map((s) => (
            <button key={s.track.id} className="sets-live-row" onClick={() => play(s.track.id)}>
              <span className="grow"><span className="strong">{s.track.title}</span> <span className="small muted">{s.track.artist}</span></span>
              <span className="mono-num">{s.track.bpm ? Math.round(s.track.bpm) : '–'}</span><KeyChip k={s.track.key} /><span className="sets-go">▶</span>
            </button>
          ))}
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('sets.otherTrack')} />
          {search.map((x) => <button key={x.id} className="sets-live-row" onClick={() => { play(x.id); setQ(''); }}><span className="grow">{x.artist} – {x.title}</span><span className="sets-go">▶</span></button>)}
        </section>
      </div>
      {plan.gigId && <RequestsPanel gigId={plan.gigId} nowTrackId={nowTrack?.id} onPlayed={(trackId, reqId) => trackId && play(trackId, 'request', reqId)} />}
    </div>
  );
}
