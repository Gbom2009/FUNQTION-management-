import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../../core/db';
import { useI18n, type Key } from '../../../core/i18n';
import { useSession } from '../../../core/session';
import { Field, Modal, Section, useToast } from '../../../core/ui';
import { fmtDate, fmtDateTime } from '../../../core/format';
import { PORTAL_SECTIONS, type Gig, type Portal, type PortalSection } from '../../../core/types';
import { ensurePortal, portalLink, sendPortal, updatePortal, usePortal } from '../data';
import { lockDate } from '../domain/portal';

export default function GigPortal() {
  const { gigId } = useParams();
  const gig = useLiveQuery(() => (gigId ? db.gigs.get(gigId) : undefined), [gigId]);
  const portal = usePortal(gigId);
  useEffect(() => { if (gigId) void ensurePortal(gigId); }, [gigId]);
  if (!gig || !portal) return <p className="muted">…</p>;
  return <Editor gig={gig} portal={portal} />;
}

function Editor({ gig, portal }: { gig: Gig; portal: Portal }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const { me } = useSession();
  const [link, setLink] = useState('');
  const [msg, setMsg] = useState<{ text: string; whatsapp: string; mail: string } | null>(null);
  useEffect(() => { void portalLink(gig).then(setLink); }, [gig, portal]);
  const set = (c: Partial<Portal>) => updatePortal(portal, c);
  const toggle = (s: PortalSection) => set({ sections: portal.sections.includes(s) ? portal.sections.filter((x) => x !== s) : PORTAL_SECTIONS.filter((x) => x === s || portal.sections.includes(x)) });
  const clientWishes = gig.musicWishes.filter((w) => w.by === 'client');
  const local = link.replace(/^https?:\/\/[^#]+/, `${location.origin}${location.pathname}`);
  return (
    <div>
      <div className="page-head row between">
        <div>
          <h1>{gig.title}</h1>
          <div className="tiny muted">{fmtDate(gig.date, lang)} · {t(`stage.${gig.stage}` as Key)} · <Link to={`/bookings/gigs/${gig.id}`}>{t('po.toGig')}</Link></div>
        </div>
      </div>
      <div className="layout-2">
        <div className="stack">
          <Section title={t('po.sections')}>
            <div className="list">
              {PORTAL_SECTIONS.map((s) => <label key={s} className="list-item check"><input type="checkbox" checked={portal.sections.includes(s)} onChange={() => toggle(s)} /> {t(`po.sec.${s}` as Key)}</label>)}
            </div>
            <Field label={t('po.welcome')}><textarea rows={3} value={portal.welcome ?? ''} placeholder={t('po.welcomePh')} onChange={(e) => set({ welcome: e.target.value })} /></Field>
            <Field label={t('po.lockDays')} hint={t('po.lockHint', { date: fmtDate(lockDate(gig, portal.lockDays), lang) })}>
              <input inputMode="numeric" value={String(portal.lockDays)} onChange={(e) => set({ lockDays: Math.max(0, Number(e.target.value) || 0) })} />
            </Field>
          </Section>
          <Section title={t('po.after')}>
            <p className="small muted">{t('po.afterHelp')}</p>
            <Field label={t('po.showPlayed')}>
              <select value={portal.showPlayed} onChange={(e) => set({ showPlayed: e.target.value as Portal['showPlayed'] })}>
                {(['none', 'top20', 'all'] as const).map((x) => <option key={x} value={x}>{t(`po.played.${x}` as Key)}</option>)}
              </select>
            </Field>
            <Field label={t('po.playedList')} hint={t('po.playedHint')}><textarea rows={5} value={portal.playedList ?? ''} onChange={(e) => set({ playedList: e.target.value })} /></Field>
            <div className="grid2">
              <Field label={t('po.photos')}><input value={portal.photosUrl ?? ''} placeholder="https://photos.app.goo.gl/…" onChange={(e) => set({ photosUrl: e.target.value.trim() || undefined })} /></Field>
              <Field label={t('po.playlist')}><input value={portal.playlistUrl ?? ''} placeholder="https://open.spotify.com/playlist/…" onChange={(e) => set({ playlistUrl: e.target.value.trim() || undefined })} /></Field>
            </div>
          </Section>
        </div>
        <div className="stack">
          <Section title={t('po.send')}>
            <p className="small muted">{t('po.sendHelp')}</p>
            <div className="stack">
              <button className="btn primary" onClick={async () => setMsg(await sendPortal(gig, me?.name ?? 'Team Funqtion'))}>{t('po.sendBtn')}</button>
              <a className="btn" href={local} target="_blank" rel="noreferrer">{t('po.preview')}</a>
              <button className="btn ghost" onClick={async () => { await navigator.clipboard?.writeText(link).catch(() => undefined); toast(t('pr.copied')); }}>{t('po.copyLink')}</button>
            </div>
            <p className="tiny muted">{t('po.linkSize', { n: link.length })}{portal.sentAt ? ` · ${t('po.sentAt', { at: fmtDateTime(portal.sentAt, lang) })}` : ''}</p>
            <p className="tiny muted">{t('po.privacy')}</p>
          </Section>
          <Section title={t('po.fromClient')}>
            {clientWishes.length ? (
              <div className="list">{clientWishes.map((w) => <div key={w.id} className="list-item small">{t(`wish.${w.kind}` as Key)}: {w.track || w.text}{w.at ? ` (${w.at})` : ''}</div>)}</div>
            ) : <p className="small muted">{t('po.noClientWishes')}</p>}
            {portal.lastAnswerAt && <p className="tiny muted">{t('po.lastAnswer', { at: fmtDateTime(portal.lastAnswerAt, lang) })}</p>}
            <Link className="btn small ghost" to={`/gigday/${gig.id}/music`}>{t('po.toMusic')}</Link>
          </Section>
        </div>
      </div>
      {msg && (
        <Modal title={t('po.sendBtn')} onClose={() => setMsg(null)} footer={<>
          <button className="btn ghost" onClick={async () => { await navigator.clipboard?.writeText(msg.text).catch(() => undefined); toast(t('pr.copied')); }}>{t('pr.copyCaption')}</button>
          <a className="btn" href={msg.mail}>{t('fb.viaMail')}</a>
          <a className="btn primary" href={msg.whatsapp} target="_blank" rel="noreferrer">{t('fb.viaWa')}</a>
        </>}>
          <pre className="small" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{msg.text}</pre>
        </Modal>
      )}
    </div>
  );
}
