import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../../core/db';
import { useI18n, type Key } from '../../../core/i18n';
import { useSession } from '../../../core/session';
import { useToast } from '../../../core/ui';
import { todayStr, addDays, toDateStr } from '../../../core/dates';
import { alive } from '../../../core/repo';
import type { LightCue, LightShow } from '../../../core/types';
import { useGigs } from '../../bookings/data';
import { endShow, fire, laserStateOf, lightSettings, setShowLaser, startShow, stopLaser, useCues, useShowLog, useShows, type FireResult } from '../data';
import { bpmFromTaps, laserGate, LASER_CHECKS, nextMoment, SECTIONS, visibleScenes, type Section } from '../domain/live';
import { connectMidi, midiConnected, midiSupported, onMidiChange } from '../midi';

export default function Live({ stage = false }: { stage?: boolean }) {
  const { t } = useI18n();
  const toast = useToast();
  const { me, settings } = useSession();
  const ls = lightSettings(settings);
  const cues = useCues();
  const shows = useShows();
  const show = shows.find((s) => !s.endedAt);
  const log = useShowLog(show?.id);
  const gigs = useGigs();
  const today = todayStr();
  const yesterday = toDateStr(addDays(new Date(), -1));
  const candidates = gigs.filter((g) => (g.date === today || g.date === yesterday) && ['confirmed', 'played'].includes(g.stage));
  const [gigId, setGigId] = useState<string>('');
  const gig = gigs.find((g) => g.id === (show?.gigId ?? gigId));
  const steps = useLiveQuery(async () => (gig ? alive(await db.timelineSteps.where('gigId').equals(gig.id).toArray()) : []), [gig?.id]) ?? [];
  const [section, setSection] = useState<Section | 'all'>('all');
  const [taps, setTaps] = useState<number[]>([]);
  const [, force] = useState(0);
  const [now, setNow] = useState(new Date());
  useEffect(() => onMidiChange(() => force((x) => x + 1)), []);
  useEffect(() => { const iv = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(iv); }, []);
  const bpm = bpmFromTaps(taps);
  const gate = laserGate(laserStateOf(show, ls));
  const moment = nextMoment(steps, now);
  const scenes = visibleScenes(cues, gig?.eventType, section, ls.strobeOff);
  const moments = cues.filter((c) => c.kind === 'moment' && (!gig || !c.eventTypes.length || c.eventTypes.includes(gig.eventType)) && !(c.strobe && gig && ls.strobeOff.includes(gig.eventType)));
  const blackout = cues.find((c) => c.kind === 'blackout');
  const laserCues = cues.filter((c) => c.kind === 'laser' || c.usesLaser);

  const report = (r: FireResult, c: LightCue) => {
    if (r === 'laser_blocked') toast(t('lt.laserBlocked'));
    else if (r === 'no_midi') toast(t('lt.noMidi'));
    else if (r === 'no_mapping') toast(t('lt.noMapping', { cue: c.label }));
  };
  const held = useRef(new Set<string>());
  const press = async (c: LightCue) => { if (c.hold) held.current.add(c.id); report(await fire(c, show, 'press'), c); };
  // Flash buttons: note-off only after a press (not when the pointer merely leaves the tile).
  const release = (c: LightCue) => { if (c.hold && held.current.delete(c.id)) void fire(c, show, 'release'); };
  const stop = async () => {
    const r = await stopLaser(show);
    toast(r.mapped ? t('lt.stopped', { n: r.sent }) : t('lt.noStopCue'));
  };
  const tap = () => setTaps((x) => [...x.slice(-8), performance.now()]);

  // Keyboard: Esc = laser stop, B = blackout, space = tap tempo.
  const latest = useRef({ stop, blackout, show, tap });
  latest.current = { stop, blackout, show, tap };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,textarea,select')) return;
      if (e.key === 'Escape') { e.preventDefault(); void latest.current.stop(); }
      if (e.key.toLowerCase() === 'b' && latest.current.blackout) void fire(latest.current.blackout, latest.current.show);
      if (e.key === ' ') { e.preventDefault(); latest.current.tap(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const tile = (c: LightCue, big = false) => (
    <button key={c.id} type="button" className={`lt-tile${big ? ' big' : ''}`} style={{ '--tile': c.colour ?? 'var(--fq-accent)' } as React.CSSProperties}
      onPointerDown={() => void press(c)} onPointerUp={() => release(c)} onPointerLeave={() => release(c)}>
      <span>{c.label}</span>
      {(c.usesLaser || c.kind === 'laser') && <span className="tiny">LASER</span>}
    </button>
  );

  return (
    <div className={`lt-live${stage ? ' stage' : ''}`}>
      <div className="lt-top">
        <div className="row" style={{ flexWrap: 'wrap', gap: 'var(--s2)' }}>
          {!show ? (
            <>
              <select value={gigId} onChange={(e) => setGigId(e.target.value)} aria-label={t('pr.gig')}>
                <option value="">{t('lt.noGig')}</option>
                {candidates.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
              </select>
              <button className="btn primary" disabled={!me} onClick={async () => { await startShow(gigId || undefined, me!.id); }}>{t('lt.startShow')}</button>
            </>
          ) : (
            <>
              <span className="strong">{gig?.title ?? t('lt.noGig')}</span>
              <button className="btn small ghost" onClick={() => endShow(show)}>{t('lt.endShow')}</button>
            </>
          )}
          {!midiConnected() && <button className="btn small" onClick={async () => { const r = await connectMidi(); if (!r.ok) toast(r.error === 'unsupported' ? t('lt.midiUnsupported') : t('lt.midiFailed')); }}>{t('lt.connectMidi')}</button>}
          {midiConnected() && <span className="tiny" style={{ color: 'var(--ok)' }}>MIDI ✓ {ls.midiOutput ?? ''}</span>}
          {!midiSupported() && <span className="tiny danger-text">{t('lt.midiUnsupported')}</span>}
        </div>
        <div className="row" style={{ gap: 'var(--s2)' }}>
          <button className="btn lt-tap" onClick={tap} aria-label={t('lt.tap')}>{bpm ? `${bpm} BPM` : t('lt.tap')}</button>
          {stage ? <Link className="btn small ghost" to="/lights">×</Link> : <Link className="btn small ghost" to="/lights/stage">{t('lt.stageMode')}</Link>}
        </div>
      </div>

      {moment && <div className="banner warn"><span className="txt">{moment.inMin > 0 ? t('lt.momentIn', { label: moment.label, n: moment.inMin }) : t('lt.momentNow', { label: moment.label })}</span></div>}
      {!ls.remoteEstop && <div className="banner danger"><span className="txt">{t('lt.noEstop')}</span></div>}

      <div className="lt-safety">
        <button type="button" className="lt-stop" onClick={() => void stop()}>{t('lt.laserStop')}<span className="tiny">Esc</span></button>
        {blackout && <button type="button" className="lt-blackout" onPointerDown={() => void press(blackout)} onPointerUp={() => release(blackout)}>{t('lt.blackout')}<span className="tiny">B</span></button>}
      </div>

      {!!moments.length && <div className="lt-grid moments">{moments.map((c) => tile(c, true))}</div>}

      <div className="chips scroll-x" role="group" aria-label={t('lt.section')}>
        {(['all', ...SECTIONS] as const).map((s) => <button key={s} type="button" className="chip" aria-pressed={section === s} onClick={() => setSection(s)}>{t(`lt.sec.${s}` as Key)}</button>)}
      </div>
      <div className="lt-grid">{scenes.length ? scenes.map((c) => tile(c)) : <p className="muted">{t('lt.noScenes')} <Link to="/lights/cues">{t('lt.nav.cues')}</Link></p>}</div>

      <LaserPanel show={show} gateBlocks={gate.blocks} allowed={gate.allowed} cues={laserCues} onFire={press} remoteEstop={ls.remoteEstop} />

      {show && <div className="lt-log tiny muted">{log.slice(0, 6).map((l) => <div key={l.id}>{new Date(l.at).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })} · {t(`lt.ev.${l.event}` as Key)}{l.detail ? ` · ${l.detail}` : ''}</div>)}</div>}
      <p className="tiny muted">{t('lt.remoteLater')}</p>
    </div>
  );
}

function LaserPanel({ show, gateBlocks, allowed, cues, onFire, remoteEstop }: { show?: LightShow; gateBlocks: string[]; allowed: boolean; cues: LightCue[]; onFire: (c: LightCue) => void; remoteEstop: boolean }) {
  const { t } = useI18n();
  const checks = show?.checks ?? {};
  const keys = useMemo(() => LASER_CHECKS.filter((k) => k !== 'estop'), []);
  return (
    <section className="lt-laser">
      <div className="row between"><h2 className="strong">{t('lt.laser')}</h2><span className="tiny" style={{ color: allowed ? 'var(--ok)' : 'var(--danger)' }}>{allowed ? t('lt.laserOk') : t('lt.laserLocked')}</span></div>
      {!show ? <p className="small muted">{t('lt.startFirst')}</p> : <>
        {keys.map((k) => <label key={k} className="check"><input type="checkbox" checked={!!checks[k]} onChange={(e) => setShowLaser(show, { checks: { ...checks, [k]: e.target.checked } })} /> {t(`g.laser.${k}` as Key)}</label>)}
        {!remoteEstop && <label className="check"><input type="checkbox" checked={!!show.operatorAtKey} onChange={(e) => setShowLaser(show, { operatorAtKey: e.target.checked })} /> {t('lt.operatorAtKey')}</label>}
        <label className="check"><input type="checkbox" checked={!!show.crowdScan} onChange={(e) => setShowLaser(show, { crowdScan: e.target.checked })} /> {t('g.laser.crowdScan')}</label>
        {show.crowdScan && <>
          <div className="banner danger"><span className="txt small">{t('g.laser.crowdWarn')}</span></div>
          <label className="field"><span>{t('g.laser.permissionBy')}</span><input defaultValue={show.crowdPermission ?? ''} onBlur={(e) => setShowLaser(show, { crowdPermission: e.target.value })} /></label>
          <label className="check"><input type="checkbox" checked={!!show.crowdMeasured} onChange={(e) => setShowLaser(show, { crowdMeasured: e.target.checked })} /> {t('lt.measured')}</label>
        </>}
        {gateBlocks.map((b) => <div key={b} className="tiny danger-text">• {t(`lt.block.${b}` as Key)}</div>)}
        <div className="lt-grid">{cues.map((c) => (
          <button key={c.id} type="button" className="lt-tile" disabled={!allowed && (c.laserRole === 'on' || c.usesLaser)} style={{ '--tile': c.laserRole === 'off' ? 'var(--danger)' : '#4fd17a' } as React.CSSProperties} onClick={() => onFire(c)}>{c.label}</button>
        ))}</div>
      </>}
    </section>
  );
}
