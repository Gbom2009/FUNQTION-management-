import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../../core/db';
import { alive, save } from '../../core/repo';
import { useI18n } from '../../core/i18n';
import { Check, Empty, Modal, Section, useToast } from '../../core/ui';
import { AppShell, type NavItem } from '../../core/ui/AppShell';
import { fmtDate } from '../../core/format';
import { addDays, toDateStr } from '../../core/dates';
import type { Gig, RequestStat, SetPlan, TimelineStep, Track } from '../../core/types';
import { useGigs } from '../bookings/data';
import { normKey } from '../library/domain/names';
import { qrArt, DEFAULT_PRESETS } from '../gear/domain/labelArt';
import logoSvg from '../../../public/logo.svg?raw';
import { client, createSession, guestUrl, loggedIn, login, logout, queue, serverUrl, sessionsForGig, setServerUrl, updateSession, type SessionRec } from './client';
import { defaultRules, findTrack, libraryIndex, sessionCode } from './domain';
import RequestsPanel from './RequestsPanel';

export default function RequestsApp() {
  const nav: NavItem[] = [
    { to: '/requests', key: 'app.requests', icon: 'enquiries', end: true },
    { to: '/sets', key: 'app.sets', icon: 'calendar' },
    { to: '/library', key: 'app.library', icon: 'tasks' },
  ];
  return <AppShell title="app.requests" nav={nav} settingsTo="/requests"><RequestsHome /></AppShell>;
}

function RequestsHome() {
  const { t, lang } = useI18n();
  const [, force] = useState(0);
  const from = toDateStr(addDays(new Date(), -1));
  const gigs = useGigs().filter((g) => g.date >= from && g.date <= toDateStr(addDays(new Date(), 30)) && ['confirmed', 'option', 'played'].includes(g.stage)).sort((a, b) => a.date.localeCompare(b.date));
  return (
    <div className="stack" style={{ gap: 'var(--s6)' }}>
      <div className="page-head"><h1>{t('app.requests')}</h1></div>
      <ServerCard onChange={() => force((n) => n + 1)} />
      {loggedIn() && (
        <Section title={t('req.gigs')}>
          {gigs.map((g) => <GigSession key={g.id} gig={g} label={`${fmtDate(g.date, lang)} · ${g.title}`} />)}
          {!gigs.length && <Empty>{t('gd.noUpcoming')}</Empty>}
        </Section>
      )}
    </div>
  );
}

function ServerCard({ onChange }: { onChange: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [url, setUrl] = useState(serverUrl());
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const ok = loggedIn();
  return (
    <Section title={t('req.server')}>
      {ok ? (
        <div className="row between"><span className="small">✓ {serverUrl()} · {client()?.authStore.record?.email as string}</span><button className="btn small ghost" onClick={() => { logout(); onChange(); }}>{t('login.switch')}</button></div>
      ) : (
        <div className="stack">
          <p className="small muted">{t('req.serverHint')}</p>
          <label className="field"><span>{t('req.serverUrl')}</span><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://verzoek.jouwdomein.nl" /></label>
          <div className="grid2">
            <label className="field"><span>{t('common.email')}</span><input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" /></label>
            <label className="field"><span>{t('req.password')}</span><input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" /></label>
          </div>
          <button className="btn primary" onClick={async () => {
            try { setServerUrl(url); await login(email, pw); setPw(''); onChange(); toast(t('req.connected')); }
            catch (e) { toast(`${t('req.loginFailed')} (${(e as Error).message})`); }
          }}>{t('req.connect')}</button>
        </div>
      )}
    </Section>
  );
}

/** Rules, wedding mode and the library index for a new session, from Bookings, Gig Day and Sets. */
async function buildSession(gig: Gig): Promise<Omit<SessionRec, 'id'> & { libraryIndex: unknown }> {
  const steps = alive(await db.timelineSteps.where('gigId').equals(gig.id).toArray()) as TimelineStep[];
  const plan = alive(await db.setPlans.where('gigId').equals(gig.id).toArray())[0] as SetPlan | undefined;
  const blocks = [...(plan?.blocked ?? []), ...(gig.musicWishes ?? []).filter((w) => w.kind === 'do_not_play').map((w) => { const [a, ...r] = w.text.split(/\s+[-–]\s+/); return r.length ? normKey(a, r.join(' - ')) : `artist:${w.text.trim().toLowerCase()}`; })];
  const tracks = alive(await db.musicTracks.toArray()) as Track[];
  const wedding = gig.eventType === 'wedding' ? {
    names: gig.title.replace(/^bruiloft\s*/i, '').trim() || gig.title,
    wishes: (gig.musicWishes ?? []).filter((w) => w.kind === 'special_moment' && w.track).map((w) => `${w.text}: ${w.track}`).slice(0, 4),
    priorityCode: sessionCode().slice(2) + Math.floor(Math.random() * 90 + 10),
  } : null;
  return {
    code: sessionCode(), gigId: gig.id, title: gig.title, status: 'open',
    rules: { ...defaultRules(gig.eventType, undefined, steps, [...new Set(blocks)]) } as unknown as Record<string, unknown>,
    wedding, nowPlaying: null, libraryIndex: libraryIndex(tracks),
  };
}

function GigSession({ gig, label }: { gig: Gig; label: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const [s, setS] = useState<SessionRec | null | undefined>(undefined);
  const [card, setCard] = useState(false);
  useEffect(() => { void sessionsForGig(gig.id).then((l) => setS(l.find((x) => x.status !== 'closed') ?? null)).catch(() => setS(null)); }, [gig.id]);
  const rules = (s?.rules ?? {}) as { allowShoutouts?: boolean; showNowPlaying?: boolean; explicitAllowed?: boolean };
  const setRule = async (k: string, v: boolean) => { if (s) setS(await updateSession(s.id, { rules: { ...s.rules, [k]: v } })); };

  /** Close: keep what was asked (no personal data) for Sets' stats. */
  const close = async () => {
    if (!s || !confirm(t('req.closeConfirm'))) return;
    const items = await queue(s.id);
    const tracks = alive(await db.musicTracks.toArray()) as Track[];
    for (const i of items) {
      await save<RequestStat>('requestStats', { gigId: gig.id, sessionCode: s.code, artist: i.artist, title: i.title, normKey: i.normKey || normKey(i.artist, i.title), votes: i.votes, status: i.status, trackId: findTrack(i.artist, i.title, tracks)?.id });
    }
    await updateSession(s.id, { status: 'closed', closedAt: new Date().toISOString() });
    setS(null);
    toast(t('req.closed', { n: items.length }));
  };

  return (
    <div className="card stack" style={{ gap: 'var(--s2)' }}>
      <div className="row between">
        <span className="strong">{label}</span>
        {s === null && <button className="btn small primary" onClick={async () => setS(await createSession(await buildSession(gig)))}>{t('req.start')}</button>}
      </div>
      {s && (
        <>
          <div className="row">
            <span className="small">{t('req.code')}: <span className="mono-num strong">{s.code}</span>{s.wedding?.priorityCode ? ` · 💍 ${s.wedding.priorityCode}` : ''}</span>
            <button className="btn small" onClick={() => setCard(true)}>{t('req.qrCard')}</button>
            <button className="btn small ghost" onClick={async () => { await updateSession(s.id, { libraryIndex: libraryIndex(alive(await db.musicTracks.toArray()) as Track[]) }); toast(t('req.indexUpdated')); }}>{t('req.updateIndex')}</button>
            <button className="btn small ghost" onClick={() => void close()}>{t('req.close')}</button>
          </div>
          <div className="row">
            <Check label={t('req.allowShoutouts')} checked={!!rules.allowShoutouts} onChange={(v) => void setRule('allowShoutouts', v)} />
            <Check label={t('req.showNowPlaying')} checked={!!rules.showNowPlaying} onChange={(v) => void setRule('showNowPlaying', v)} />
            <Check label={t('req.explicit')} checked={!!rules.explicitAllowed} onChange={(v) => void setRule('explicitAllowed', v)} />
          </div>
          <RequestsPanel gigId={gig.id} full />
          <Link className="tiny" to={`/gigday/${gig.id}`}>{t('app.gigday')} →</Link>
        </>
      )}
      {card && s && <QrCard session={s} title={gig.title} onClose={() => setCard(false)} />}
    </div>
  );
}

/** Printable A6 table card: Funqtion-style QR (black, orange, logo), the short code, the URL. */
function QrCard({ session, title, onClose }: { session: SessionRec; title: string; onClose: () => void }) {
  const { t } = useI18n();
  const [svg, setSvg] = useState('');
  const url = guestUrl(session.code);
  useEffect(() => {
    void (async () => {
      const { qrMatrix } = await import('../gear/zxing');
      const preset = DEFAULT_PRESETS.find((p) => p.id === 'qr_large_fq')!;
      setSvg(qrArt(await qrMatrix(url, true), preset, logoSvg));
    })();
  }, [url]);
  return (
    <Modal title={t('req.qrCard')} onClose={onClose} footer={<button className="btn primary" onClick={() => window.print()}>{t('req.print')}</button>}>
      <div className="req-card" id="req-card">
        <div className="req-card-tag">FEEL THE MUSIQ</div>
        <div className="req-card-title">{session.wedding?.names ?? title}</div>
        {svg ? <img src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`} alt="QR" className="req-card-qr" /> : <div className="req-card-qr" />}
        <div className="req-card-steps">{t('req.cardSteps')}</div>
        <div className="req-card-code mono-num">{session.code}</div>
        <div className="req-card-url">{url.replace(/^https?:\/\//, '')}</div>
        <div className="req-card-small">@funqtionofficial · {t('req.cardPrivacy')}</div>
      </div>
      <p className="tiny muted">{t('req.cardHint')}</p>
    </Modal>
  );
}

