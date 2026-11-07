import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../../../core/i18n';
import { Modal } from '../../../core/ui';
import { keepAwake } from '../../maps/location/wakeLock';
import { doneStep, setWish } from '../data';
import { nowPlaying, sortSteps } from '../domain/timeline';
import { countdown, hhmm, useGigCtx, useNow } from '../components';
import { LogModal, type QuickKind } from './Log';

/**
 * Next to the decks: black, dim, big clock, who's playing until when,
 * countdowns to the next moment, set end and curfew. Four big buttons.
 * Long-press to leave; the screen stays on. No sounds, ever.
 */
export default function Booth() {
  const { t } = useI18n();
  const nav = useNavigate();
  const { gig, day, steps, me } = useGigCtx();
  const now = useNow(1000);
  const [red, setRed] = useState(() => { try { return localStorage.getItem('fq-booth-red') === '1'; } catch { return false; } });
  const [log, setLog] = useState<QuickKind | null>(null);
  const [moments, setMoments] = useState(false);
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { keepAwake(true); return () => keepAwake(false); }, []);
  useEffect(() => { try { localStorage.setItem('fq-booth-red', red ? '1' : '0'); } catch { /* ignore */ } }, [red]);

  const sorted = sortSteps(steps);
  const playing = nowPlaying(sorted, gig.setSlots ?? []);
  const nextMoment = sorted.find((s) => s.kind === 'moment' && !s.actualAt);
  const nextSet = sorted.find((s) => (s.kind === 'set_start' || s.kind === 'set_end') && !s.actualAt);
  const curfew = sorted.find((s) => s.kind === 'curfew');
  const soon = nextMoment && Date.parse(nextMoment.plannedAt) - now.getTime() < 5 * 60000 && Date.parse(nextMoment.plannedAt) > now.getTime() - 60000;
  const who = playing.slot?.performers.map((p) => (p === 'gijs' ? 'Gijs' : 'Coen')).join(' + ');
  const pendingMoments = (gig.musicWishes ?? []).filter((w) => w.kind === 'special_moment' && !w.done);

  const startHold = () => { hold.current = setTimeout(() => nav(`/gigday/${gig.id}`), 700); };
  const endHold = () => { if (hold.current) clearTimeout(hold.current); };

  return (
    <div className={`gd-booth ${red ? 'red' : ''}`}>
      <div className="gd-booth-top">
        <button className="gd-booth-exit" onPointerDown={startHold} onPointerUp={endHold} onPointerLeave={endHold} aria-label={t('gd.boothExit')}>{t('gd.boothExit')}</button>
        <button className="gd-booth-red" onClick={() => setRed(!red)} aria-pressed={red}>{t('gd.redMode')}</button>
      </div>
      <div className="gd-clock mono-num">{now.toTimeString().slice(0, 5)}</div>
      <div className="gd-playing">{who ? t('gd.playingUntil', { who, until: hhmm(playing.until) }) : nextSet ? `${nextSet.label} ${hhmm(nextSet.plannedAt)}` : ''}</div>
      <div className="gd-counts">
        {nextMoment && <div className={soon ? 'pulse' : ''}><span className="tiny">{nextMoment.label}</span><span className="mono-num">{countdown(nextMoment.plannedAt, now)}</span></div>}
        {nextSet && <div><span className="tiny">{nextSet.label}</span><span className="mono-num">{countdown(nextSet.plannedAt, now)}</span></div>}
        {curfew && <div><span className="tiny">{t('gd.curfew')}</span><span className="mono-num">{countdown(curfew.plannedAt, now)}</span></div>}
        {day.noiseLimitDb ? <div><span className="tiny">{t('gd.noiseLimit')}</span><span className="mono-num">{day.noiseLimitDb} dB</span></div> : null}
      </div>
      {nextSet && <button className="gd-booth-set" onClick={() => void doneStep(nextSet, me)}>{t('gd.doneNow')}: {nextSet.label} · {hhmm(nextSet.plannedAt)}</button>}
      <div className="gd-booth-grid">
        <button onClick={() => setMoments(true)}>{t('gd.moment')}</button>
        <button onClick={() => setLog('overtime_request')}>{t('gd.log.overtime_request')}</button>
        <button onClick={() => setLog('note')}>{t('gd.log.note')}</button>
        <button onClick={() => setLog('vibe')}>{t('gd.log.vibe')}</button>
      </div>
      {log && <LogModal kind={log} onClose={() => setLog(null)} />}
      {moments && (
        <Modal title={t('gd.moments')} onClose={() => setMoments(false)}>
          {pendingMoments.map((w) => {
            const step = sorted.find((s) => s.kind === 'moment' && s.sourceRef === w.id);
            return (
              <div key={w.id} className="gd-moment">
                <span className="mono-num">{w.at || hhmm(step?.plannedAt)}</span>
                <span className="grow"><span className="strong">{w.text}</span>{w.track ? ` · ${w.track}` : ''}{w.cue ? <span className="tiny muted"> · {w.cue}</span> : null}</span>
                <button className="btn primary small" onClick={async () => { if (step) await doneStep(step, me); else await setWish(gig.id, w.id, { done: true, doneAt: new Date().toISOString() }); }}>{t('gd.done')}</button>
              </div>
            );
          })}
          {!pendingMoments.length && <p className="muted">{t('gd.noMoments')}</p>}
        </Modal>
      )}
    </div>
  );
}
