import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../../core/db';
import { alive } from '../../../core/repo';
import { useI18n } from '../../../core/i18n';
import { useSession } from '../../../core/session';
import { useToast } from '../../../core/ui';
import { euro } from '../../../core/format';
import { todayStr } from '../../../core/dates';
import type { GearIssue, Invoice, MemberId, Review, Template, Trip, VenueNote } from '../../../core/types';
import { fillTemplate, mailtoLink, whatsAppLink } from '../../bookings/domain/messaging';
import { closeGigDay, overtimeFor, wrapInvoice, wrapMark, wrapPlayed, wrapThanks, wrapTrips } from '../data';
import { openCount, wrapUpItems, type WrapItem } from '../domain/wrapup';
import type { Overtime } from '../domain/overtime';
import { delay } from '../domain/timeline';
import { hhmm, useGigCtx } from '../components';
import { logLine } from './Log';
import { feedbackLink } from '../../feedback/data';

/** The next morning: everything prepared, one tap each. */
export default function WrapUp() {
  const { t } = useI18n();
  const toast = useToast();
  const { settings, me: meMember } = useSession();
  const { gig, day, venue, steps, logs, persons } = useGigCtx();
  const q = (fn: () => Promise<unknown[]>, deps: unknown[]) => useLiveQuery(fn, deps) ?? [];
  const trips = q(async () => alive(await db.trips.where('gigId').equals(gig.id).toArray()), [gig.id]) as Trip[];
  const invoices = q(async () => alive(await db.invoices.where('gigId').equals(gig.id).toArray()), [gig.id]) as Invoice[];
  const reviews = q(async () => alive(await db.reviews.toArray()).filter((r) => (r as Review).gigId === gig.id), [gig.id]) as Review[];
  const issues = q(async () => alive(await db.gearIssues.toArray()).filter((i) => (i as GearIssue).gigId === gig.id && (i as GearIssue).status === 'open'), [gig.id]) as GearIssue[];
  const notes = q(async () => alive(await db.venueNotes.where('gigId').equals(gig.id).toArray()), [gig.id]) as VenueNote[];
  const accepted = useLiveQuery(async () => alive(await db.quotes.where('gigId').equals(gig.id).toArray()).some((x) => x.status === 'accepted'), [gig.id]) ?? false;
  const templates = q(() => db.templates.toArray(), []) as Template[];
  const [ot, setOt] = useState<Overtime | null>(null);
  useEffect(() => { void overtimeFor(gig.id).then(setOt); }, [gig.id, logs.length, steps]);
  // No Google profile: the review link is our own feedback form (app 14).
  const [fbLink, setFbLink] = useState('');
  useEffect(() => { void feedbackLink(gig).then((r) => setFbLink(r.link)); }, [gig]);

  const items = wrapUpItems({ gig, day, venue, trips, invoices, reviews, logs, openGearIssues: issues.length, venueNotesToday: notes.length, hasAcceptedQuote: accepted, today: todayStr() });
  const client = persons.find((p) => p.id === gig.clientPersonId);
  const lang = client?.language ?? settings.language;
  const tpl = templates.find((x) => !x.deletedAt && x.kind === 'thank_you_review' && x.language === lang);
  const body = tpl ? fillTemplate(tpl.body, { firstName: client?.firstName, gigTitle: gig.title, reviewLink: settings.reviewLink || fbLink, sender: meMember?.name }) : '';
  const subject = tpl?.subject ? fillTemplate(tpl.subject, { gigTitle: gig.title }) : gig.title;

  const row = (it: WrapItem, title: string, children: React.ReactNode) => (
    <div key={it.key} className={`gd-wrap ${it.state}`}>
      <div className="row between"><span className="strong">{it.state === 'done' ? '✓ ' : it.state === 'na' ? '– ' : ''}{title}</span></div>
      {it.state !== 'na' && <div className="stack" style={{ gap: 'var(--s2)', marginTop: 'var(--s2)' }}>{children}</div>}
    </div>
  );

  const get = (k: WrapItem['key']) => items.find((x) => x.key === k)!;
  const open = openCount(items);
  const lastEnd = steps.filter((s) => s.kind === 'set_end' && s.actualAt).sort((a, b) => b.actualAt!.localeCompare(a.actualAt!))[0];
  const vibes = logs.filter((l) => l.vibe).map((l) => l.vibe!);

  return (
    <div className="stack" style={{ gap: 'var(--s4)' }}>
      <p className="muted">{day.status === 'closed' ? t('gd.wrapClosed') : t('gd.wrapOpen', { n: open })}</p>

      {row(get('played'), t('gd.wrap.played'), get('played').state === 'todo' && <button className="btn" onClick={() => void wrapPlayed(gig)}>{t('gd.wrap.playedDo')}</button>)}

      {row(get('trips'), t('gd.wrap.trips'), get('trips').state === 'done'
        ? <span className="small muted">{get('trips').detail}</span>
        : <TripsEditor proposals={get('trips').trips ?? []} onSave={(list) => void wrapTrips(gig, list).then(() => toast(t('common.saved')))} />)}

      {row(get('invoice'), t('gd.wrap.invoice'), <>
        {ot && ot.minutes > 0 && <p className="small">{ot.halfHours ? t('gd.overtimeLine', { n: ot.halfHours, amount: euro(ot.amount, settings.language) }) : t('gd.overtimeNoRequest', { min: ot.minutes })}</p>}
        {get('invoice').state === 'todo'
          ? <button className="btn" onClick={async () => { const inv = await wrapInvoice(gig); toast(inv ? t('gd.invoiceMade') : t('gd.noQuote')); }}>{t('gd.wrap.invoiceDo')}</button>
          : <Link className="btn small ghost" to="/invoicing">{t('gd.openInvoicing')}</Link>}
      </>)}

      {row(get('thanks'), t('gd.wrap.thanks'), get('thanks').state === 'todo' && <>
        <p className="small muted" style={{ whiteSpace: 'pre-wrap' }}>{body || t('gd.noTemplate')}</p>
        <div className="row">
          {(client?.whatsapp || client?.phone) && <a className="btn" href={whatsAppLink(client.whatsapp || client.phone, body)} target="_blank" rel="noreferrer" onClick={() => void wrapThanks(gig)}>WhatsApp</a>}
          {client?.email && <a className="btn" href={mailtoLink(client.email, subject, body)} onClick={() => void wrapThanks(gig)}>E-mail</a>}
          <button className="btn ghost small" onClick={() => void wrapThanks(gig)}>{t('gd.markSent')}</button>
        </div>
        {!settings.reviewLink && !fbLink && <p className="tiny muted">{t('gd.noReviewLink')}</p>}
      </>)}

      {row(get('gear'), t('gd.wrap.gear'), <>
        <span className="small">{issues.length ? t('gd.openIssues', { n: issues.length }) : t('gd.noIssues')}</span>
        <Link className="btn small ghost" to={`/gear/gigs/${gig.id}`}>{t('gd.openGear')}</Link>
      </>)}

      {row(get('venue'), t('gd.wrap.venue'), <>
        {notes.map((n) => <span key={n.id} className="small">• {n.text}</span>)}
        {get('venue').state === 'todo' && <button className="btn small" onClick={() => void wrapMark(gig.id, 'venue')}>{t('gd.confirm')}</button>}
      </>)}

      {row(get('summary'), t('gd.wrap.summary'), <>
        <div className="small">
          {steps.filter((s) => s.actualAt && ['arrive', 'soundcheck', 'set_start', 'set_end', 'leave_venue'].includes(s.kind)).map((s) => (
            <div key={s.id}>{hhmm(s.actualAt)} {s.label}{delay(s) ? ` (${delay(s) > 0 ? '+' : ''}${delay(s)} min)` : ''}</div>
          ))}
          {lastEnd && ot && ot.minutes > 0 && <div>{t('gd.overtimeMin', { min: ot.minutes })}</div>}
          {vibes.length > 0 && <div>{t('gd.vibeAvg', { v: (vibes.reduce((a, b) => a + b, 0) / vibes.length).toFixed(1) })}</div>}
          {logs.filter((l) => ['issue', 'damage', 'complaint', 'compliment', 'note'].includes(l.type)).map((l) => <div key={l.id}>• {logLine(l, t as never)}</div>)}
        </div>
        {get('summary').state === 'todo' && <button className="btn small ghost" onClick={() => void wrapMark(gig.id, 'summary')}>{t('gd.confirm')}</button>}
      </>)}

      {day.status !== 'closed' && <button className="btn primary gd-main" onClick={async () => { await closeGigDay(gig.id); toast(t('gd.closedMsg')); }}>{t('gd.close')}</button>}
    </div>
  );
}

function TripsEditor({ proposals, onSave }: { proposals: { driver: MemberId; km: number; roundTrip: boolean }[]; onSave: (l: { driver: MemberId; km: number; roundTrip: boolean }[]) => void }) {
  const { t } = useI18n();
  const [list, setList] = useState(proposals);
  return (
    <>
      {list.map((p, i) => (
        <div key={p.driver} className="row">
          <span style={{ minWidth: 48 }}>{p.driver === 'gijs' ? 'Gijs' : 'Coen'}</span>
          <input inputMode="decimal" style={{ width: 90 }} value={p.km || ''} placeholder="km" onChange={(e) => setList(list.map((x, j) => (j === i ? { ...x, km: Number(e.target.value.replace(',', '.')) || 0 } : x)))} />
          <span className="tiny muted">{t('gd.kmOneWay')}</span>
          <label className="tiny"><input type="checkbox" checked={p.roundTrip} onChange={(e) => setList(list.map((x, j) => (j === i ? { ...x, roundTrip: e.target.checked } : x)))} /> {t('gd.roundTrip')}</label>
        </div>
      ))}
      <button className="btn" disabled={!list.some((x) => x.km > 0)} onClick={() => onSave(list)}>{t('gd.wrap.tripsDo')}</button>
    </>
  );
}
