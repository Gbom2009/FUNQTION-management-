import { useState } from 'react';
import { useI18n } from '../../../core/i18n';
import { useSession } from '../../../core/session';
import { Empty, Modal, Section, useToast } from '../../../core/ui';
import { fmtDate, fmtDateTime } from '../../../core/format';
import { addDays, toDateStr, todayStr } from '../../../core/dates';
import type { Gig } from '../../../core/types';
import { useGigs } from '../../bookings/data';
import { requestFeedback, useReviews } from '../data';
import { importAll } from '../../portal/data';
import { reminderDue, waiting } from '../domain/feedback';

/** Ask, wait, paste the answer. */
export default function Requests() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const { me, settings } = useSession();
  const gigs = useGigs();
  const reviews = useReviews();
  const [paste, setPaste] = useState('');
  const [msg, setMsg] = useState<{ gig: Gig; text: string; whatsapp: string; mail: string } | null>(null);
  const since = toDateStr(addDays(new Date(), -90));
  const today = todayStr();
  const byGig = new Map<string, typeof reviews>();
  for (const r of reviews) byGig.set(r.gigId, [...(byGig.get(r.gigId) ?? []), r]);
  const played = gigs.filter((g) => ['played', 'invoiced', 'paid'].includes(g.stage) || (g.stage === 'confirmed' && g.date < today));
  const toAsk = played.filter((g) => g.date >= since && !(byGig.get(g.id) ?? []).some((r) => r.requestedAt || r.receivedAt)).sort((a, b) => b.date.localeCompare(a.date));
  const open = reviews.filter(waiting).sort((a, b) => (a.requestedAt ?? '').localeCompare(b.requestedAt ?? ''));
  const gigById = new Map(gigs.map((g) => [g.id, g]));
  const days = settings.feedbackReminderDays ?? 5;

  const ask = async (g: Gig) => { const r = await requestFeedback(g, me?.name ?? 'Team Funqtion'); setMsg({ gig: g, ...r }); };

  return (
    <div>
      <div className="page-head"><h1>{t('app.feedback')}</h1></div>

      <Section title={t('fb.paste')}>
        <p className="small muted">{t('fb.pasteHelp')}</p>
        <textarea rows={4} value={paste} placeholder="FQ1:…" onChange={(e) => setPaste(e.target.value)} style={{ width: '100%' }} />
        <button className="btn primary" disabled={!paste.includes('FQ1:') || !me} onClick={async () => {
          const all = await importAll(paste, me!.id);
          const r = all.feedback;
          setPaste('');
          toast(t('fb.imported', { n: r.imported + r.updated }) + (all.wishes.gigs ? ` · ${t('po.imported', { w: all.wishes.wishes, c: all.wishes.contacts, f: 0 })}` : '') + (r.unknownGig ? ` · ${t('fb.unknownGig', { n: r.unknownGig })}` : '') + (r.lowScores.length ? ` · ${t('fb.lowScore')}` : ''));
        }}>{t('fb.read')}</button>
      </Section>

      <Section title={t('fb.toAsk')}>
        {toAsk.length ? (
          <div className="list">
            {toAsk.map((g) => (
              <div key={g.id} className="list-item row between">
                <div><div className="strong">{g.title}</div><div className="tiny muted">{fmtDate(g.date, lang)}</div></div>
                <button className="btn small" onClick={() => ask(g)}>{t('fb.ask')}</button>
              </div>
            ))}
          </div>
        ) : <Empty>{t('fb.nothingToAsk')}</Empty>}
      </Section>

      <Section title={t('fb.waiting')}>
        {open.length ? (
          <div className="list">
            {open.map((r) => {
              const g = gigById.get(r.gigId);
              const remind = reminderDue(r, new Date(), days);
              return (
                <div key={r.id} className="list-item row between">
                  <div>
                    <div className="strong">{g?.title ?? '—'}</div>
                    <div className="tiny muted">{t('fb.askedAt', { at: fmtDateTime(r.requestedAt, lang) })}</div>
                    {remind && <div className="tiny" style={{ color: 'var(--warning)' }}>{t('fb.remindNow')}</div>}
                  </div>
                  {g && <button className="btn small ghost" onClick={() => ask(g)}>{remind ? t('fb.remind') : t('fb.sendAgain')}</button>}
                </div>
              );
            })}
          </div>
        ) : <Empty>{t('fb.nothingWaiting')}</Empty>}
      </Section>

      {msg && (
        <Modal title={t('fb.askTitle', { gig: msg.gig.title })} onClose={() => setMsg(null)} footer={<>
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
