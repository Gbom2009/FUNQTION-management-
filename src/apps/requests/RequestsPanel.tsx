import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../../core/i18n';
import { useTracks } from '../library/data';
import { KeyChip } from '../library/components';
import { act, loggedIn, queue, sessionsForGig, updateSession, watch, type SessionRec } from './client';
import { matchQueue, sortQueue, type Matched, type QueueItem } from './domain';

/** The live request queue for a gig (Sets live view + Requests app). */
export default function RequestsPanel({ gigId, nowTrackId, onPlayed, full }: { gigId: string; nowTrackId?: string; onPlayed?: (trackId: string | undefined, requestId: string) => void; full?: boolean }) {
  const { t } = useI18n();
  const tracks = useTracks();
  const [session, setSession] = useState<SessionRec | null>(null);
  const [items, setItems] = useState<QueueItem[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const ok = loggedIn();

  useEffect(() => {
    if (!ok) return;
    let stop: (() => void) | undefined;
    let alive = true;
    void (async () => {
      try {
        const s = (await sessionsForGig(gigId)).find((x) => x.status !== 'closed') ?? null;
        if (!alive) return;
        setSession(s);
        if (!s) return;
        const load = async () => { try { setItems(await queue(s.id)); setErr(null); } catch (e) { setErr(String((e as Error).message)); } };
        await load();
        stop = await watch(s.id, () => void load());
      } catch (e) { setErr(String((e as Error).message)); }
    })();
    const poll = setInterval(() => { if (session) void queue(session.id).then(setItems).catch(() => undefined); }, 20000);
    return () => { alive = false; stop?.(); clearInterval(poll); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gigId, ok]);

  const now = tracks.find((x) => x.id === nowTrackId);
  // Tell guests what's playing (only when switched on for this session).
  useEffect(() => {
    if (!session || !now || !session.rules?.showNowPlaying) return;
    void updateSession(session.id, { nowPlaying: { artist: now.artist, title: now.title } }).catch(() => undefined);
  }, [session, now]);

  const matched: Matched[] = useMemo(() => sortQueue(matchQueue(items, tracks, now)), [items, tracks, now]);
  if (!ok) return full ? null : <p className="tiny muted"><Link to="/requests">{t('req.connect')}</Link></p>;
  if (!session) return full ? null : <p className="tiny muted">{t('req.noSession')} <Link to="/requests">{t('req.start')}</Link></p>;
  const doAct = async (it: Matched, a: Parameters<typeof act>[1]) => {
    setItems(items.map((x) => (x.id === it.id ? { ...x, status: a === 'accept' ? 'accepted' : a === 'later' ? 'later' : a === 'decline' ? 'declined' : a === 'played' ? 'played' : a.startsWith('block') ? 'blocked' : x.status } : x)));
    await act(it.id, a);
    if (a === 'played') onPlayed?.(it.track?.id, it.id);
  };
  const open = matched.filter((m) => m.status !== 'played' && m.status !== 'declined' && m.status !== 'blocked');
  const done = matched.filter((m) => !open.includes(m));

  return (
    <section className="req-panel">
      <div className="row between">
        <h2>{t('req.queue')} <span className="tiny muted">{session.code} · {t(`req.status.${session.status}` as never)}</span></h2>
        <button className="btn small ghost" onClick={async () => setSession(await updateSession(session.id, { status: session.status === 'paused' ? 'open' : 'paused' }))}>{session.status === 'paused' ? t('req.resume') : t('req.pause')}</button>
      </div>
      {err && <p className="tiny danger-text">{err}</p>}
      {open.map((m) => (
        <div key={m.id} className={`req-item ${m.match} ${m.status}`}>
          <span className="req-votes mono-num">▲{m.votes}</span>
          <span className="grow">
            <span className="strong">{m.title}</span> <span className="small muted">{m.artist}</span>
            {m.priority && <span className="tiny"> · 💍</span>}
            <span className={`req-badge ${m.match}`}>{t(`req.match.${m.match}` as never)}</span>
            {m.track && <> <span className="mono-num tiny">{m.track.bpm ? Math.round(m.track.bpm) : '–'}</span> <KeyChip k={m.track.key} /></>}
            {m.shoutout && !m.shoutPublic && (
              <span className="req-shout">“{m.shoutout}”{m.shoutName ? ` – ${m.shoutName}` : ''}
                <button className="btn small ghost" onClick={() => void act(m.id, 'approve_shout').then(() => queue(session.id).then(setItems))}>✓ {t('req.showShout')}</button>
                <button className="btn small ghost" onClick={() => void act(m.id, 'reject_shout').then(() => queue(session.id).then(setItems))}>✕</button>
              </span>
            )}
            {m.shoutPublic && <span className="tiny muted"> · “{m.shoutPublic}”</span>}
          </span>
          <span className="req-actions">
            {m.status !== 'accepted' && <button className="btn small" onClick={() => void doAct(m, 'accept')} title={t('req.accept')}>✓</button>}
            <button className="btn small ghost" onClick={() => void doAct(m, 'played')} title={t('req.played')}>▶</button>
            {m.status !== 'later' && <button className="btn small ghost" onClick={() => void doAct(m, 'later')} title={t('req.later')}>⏱</button>}
            <button className="btn small ghost" onClick={() => void doAct(m, 'decline')} title={t('req.decline')}>✕</button>
            {full && <button className="btn small ghost" onClick={() => void doAct(m, 'block')} title={t('req.block')}>⛔</button>}
            {full && <button className="btn small ghost" onClick={() => void doAct(m, 'block_artist')} title={t('req.blockArtist')}>⛔A</button>}
          </span>
        </div>
      ))}
      {!open.length && <p className="muted small">{t('req.empty')}</p>}
      {full && done.length > 0 && <details><summary className="tiny muted">{t('req.done', { n: done.length })}</summary>{done.map((m) => <div key={m.id} className="small muted">{t(`req.st.${m.status}` as never)} · {m.artist} – {m.title} · ▲{m.votes}</div>)}</details>}
    </section>
  );
}
