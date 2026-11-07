import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useI18n } from '../../../core/i18n';
import { Modal, useToast } from '../../../core/ui';
import type { DayPhase, MemberId } from '../../../core/types';
import { whatsAppLink } from '../../bookings/domain/messaging';
import { doneStep, runningLate } from '../data';
import { nowNext, phaseOf, stepState, type Phase } from '../domain/timeline';
import { Bar, ContactsSheet, countdown, dayContact, hhmm, TaskTicks, useGigCtx, useNow } from '../components';

const TASK_PHASE: Record<Phase, DayPhase> = { prep: 'prep', departure: 'departure', setup: 'setup', playing: 'playing', breakdown: 'breakdown', home: 'wrapup', done: 'wrapup' };

/** The hub on the day: now/next, one-tap row, my tasks, the phase's main button. */
export default function Today() {
  const { t } = useI18n();
  const toast = useToast();
  const nav = useNavigate();
  const { gig, day, venue, steps, tasks, persons, me } = useGigCtx();
  const now = useNow();
  const [contacts, setContacts] = useState(false);
  const [late, setLate] = useState(false);
  const phase = phaseOf(steps, now, gig.date);
  const { now: cur, next } = nowNext(steps, me);
  const state = cur ? stepState(cur, now) : 'done';
  const contact = dayContact(gig, persons);
  const phone = contact?.person.whatsapp || contact?.person.phone;
  const other: MemberId = me === 'gijs' ? 'coen' : 'gijs';
  const tp = TASK_PHASE[phase];
  const mine = tasks.filter((x) => x.phase === tp && (x.owner === me || x.owner === 'both'));
  const theirs = tasks.filter((x) => x.phase === tp && x.owner === other);

  const act = async () => {
    if (!cur) { nav(`/gigday/${gig.id}/wrapup`); return; }
    await doneStep(cur, me);
    if (cur.kind === 'set_start') nav(`/gigday/${gig.id}/booth`);
    if (cur.kind === 'leave_home' && (venue?.lat != null || venue?.loadingEntrance)) toast(t('gd.routeHint'));
  };

  const lateMsg = (m: number) => t('gd.msg.late', { min: m, time: hhmm(steps.find((s) => s.kind === 'arrive')?.plannedAt ? new Date(Date.parse(steps.find((s) => s.kind === 'arrive')!.plannedAt) + m * 60000).toISOString() : undefined) });

  return (
    <div className="gd-today">
      <div className={`gd-now ${state}`}>
        {cur ? (
          <>
            <div className="tiny gd-kicker">{t('gd.now')}</div>
            <div className="gd-now-label">{cur.label}</div>
            <div className="gd-now-time"><span className="mono-num">{hhmm(cur.plannedAt)}</span><span className="gd-count mono-num">{countdown(cur.plannedAt, now)}</span></div>
            <div className="tiny">{state === 'late' ? `! ${t('gd.state.late')}` : state === 'behind' ? `⏱ ${t('gd.state.behind')}` : `✓ ${t('gd.state.on_time')}`}</div>
            {next && <div className="gd-next"><span className="tiny muted">{t('gd.next')}</span> <span className="mono-num">{hhmm(next.plannedAt)}</span> {next.label}</div>}
          </>
        ) : <div className="gd-now-label">{day.status === 'closed' ? t('gd.allClosed') : t('gd.allDone')}</div>}
      </div>

      <div className="gd-quick">
        <Link className="btn" to={`/maps?gig=${gig.id}`}>{t('gd.route')}</Link>
        <button className="btn" onClick={() => setContacts(true)}>{t('gd.contacts')}</button>
        {phone && <a className="btn" href={whatsAppLink(phone, '')} target="_blank" rel="noreferrer">WhatsApp</a>}
        <Link className="btn" to={`/gigday/${gig.id}/venue`}>{t('gd.tab.venue')}</Link>
        <Link className="btn" to={`/gear/gigs/${gig.id}`}>{phase === 'breakdown' || phase === 'home' ? t('gd.unload') : t('gd.load')}</Link>
        {(phase === 'playing' || phase === 'setup') && <Link className="btn" to={`/gigday/${gig.id}/booth`}>{t('gd.booth')}</Link>}
        {(phase === 'prep' || phase === 'departure' || phase === 'setup') && <button className="btn" onClick={() => setLate(true)}>{t('gd.late')}</button>}
      </div>

      {mine.length > 0 && <section className="section"><h2>{t('gd.myTasks')}</h2><TaskTicks tasks={mine} me={me} /></section>}
      {theirs.length > 0 && <Bar done={theirs.filter((x) => x.done).length} total={theirs.length} label={other === 'gijs' ? 'Gijs' : 'Coen'} />}

      <div className="gd-main-wrap">
        <button className="btn primary gd-main" onClick={() => void act()}>
          {cur ? t(cur.kind === 'set_end' && !steps.some((s) => s.kind === 'set_end' && !s.actualAt && s.id !== cur.id) ? 'gd.do.last_record' : (`gd.do.${cur.kind}` as never)) : t('gd.do.wrapup')}
        </button>
      </div>

      {contacts && <ContactsSheet onClose={() => setContacts(false)} />}
      {late && (
        <Modal title={t('gd.late')} onClose={() => setLate(false)}>
          <p className="muted">{t('gd.lateHint')}</p>
          <div className="row">
            {[15, 30, 60].map((m) => (
              <button key={m} className="btn" onClick={async () => {
                await runningLate(gig.id, m, me);
                setLate(false);
                if (phone) window.open(whatsAppLink(phone, lateMsg(m)), '_blank');
              }}>+{m} min</button>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
