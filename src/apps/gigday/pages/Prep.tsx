import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../../core/db';
import { alive, save } from '../../../core/repo';
import { useI18n } from '../../../core/i18n';
import { useSession } from '../../../core/session';
import { Chips, Section, useToast } from '../../../core/ui';
import { DAY_PHASES, type DayPhase, type DayTask, type MemberId, type PackList } from '../../../core/types';
import { whatsAppLink } from '../../bookings/domain/messaging';
import { addTask, defaultsOf, exportPlan, regenerate, updateGigDay, venueAddress } from '../data';
import { gigDayIcs, readiness } from '../domain/prep';
import { dayContact, download, hhmm, TaskTicks, useGigCtx } from '../components';
import { TimelineList } from './Timeline';

const MEMBERS: MemberId[] = ['gijs', 'coen'];

export default function Prep() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const { settings } = useSession();
  const { gig, day, venue, steps, tasks, persons, me } = useGigCtx();
  const contract = useLiveQuery(async () => alive(await db.contracts.where('gigId').equals(gig.id).toArray()), [gig.id]) ?? [];
  const invoices = useLiveQuery(async () => alive(await db.invoices.where('gigId').equals(gig.id).toArray()), [gig.id]) ?? [];
  const pack = useLiveQuery(() => db.packLists.where('gigId').equals(gig.id).first(), [gig.id]);
  const contact = dayContact(gig, persons);
  const deposit = invoices.find((i) => i.kind === 'deposit');
  const ready = readiness({
    contract: contract.some((c) => c.status === 'signed') ? 'signed' : contract.length ? 'open' : 'none',
    deposit: deposit ? (deposit.status === 'paid' ? 'paid' : 'open') : 'none',
    dayContactPhone: contact?.person.phone || contact?.person.whatsapp,
    venueAddress: !!venue && (!!venue.street || venue.lat != null),
    loadingEntrance: !!venue?.loadingEntrance,
    wishes: (gig.musicWishes ?? []).length,
    packList: pack && !pack.deletedAt ? pack.status : undefined,
    drivers: day.drivers?.length ?? 0,
  });
  const fixLink: Record<string, string> = {
    contract: '/contracts', deposit: '/invoicing', contact: `/bookings/gigs/${gig.id}`, venue: `/gigday/${gig.id}/venue`,
    entrance: `/maps?gig=${gig.id}`, wishes: `/gigday/${gig.id}/music`, gear: `/gear/gigs/${gig.id}`, drivers: '#drivers',
  };
  const up = (p: Parameters<typeof updateGigDay>[1]) => updateGigDay(gig.id, p, lang);
  const drivers = day.drivers ?? [];

  const planDone = async () => {
    await updateGigDay(gig.id, { status: day.status === 'draft' ? 'planned' : day.status, plannedAt: new Date().toISOString() });
    if (pack && pack.status === 'draft') await save<PackList>('packLists', { ...pack, status: 'confirmed' });
    const d = defaultsOf(settings);
    download(`gigday-${gig.date}-${me}.ics`, gigDayIcs({
      gigId: gig.id, title: gig.title, date: gig.date, me, steps, location: venue ? [venue.name, venueAddress(venue)].filter(Boolean).join(', ') : undefined,
      dayBeforeAt: d.dayBeforeAt, wrapUpAt: d.wrapUpAt, labels: { dayBefore: t('gd.ics.dayBefore'), wrapUp: t('gd.ics.wrapUp') },
    }), 'text/calendar');
    toast(t('gd.planDone'));
  };

  const arrive = steps.find((s) => s.kind === 'arrive');
  const phone = contact?.person.whatsapp || contact?.person.phone;
  const msg = t('gd.msg.dayBefore', { time: hhmm(arrive?.plannedAt), entrance: venue?.loadingEntrance?.note || venue?.loadInNotes || t('gd.msg.entranceAsk') });

  return (
    <div className="stack" style={{ gap: 'var(--s6)' }}>
      <Section title={t('gd.ready')}>
        <div className="stack" style={{ gap: 'var(--s2)' }}>
          {ready.map((r) => (
            <div key={r.key} className="gd-ready">
              <span className={r.ok ? 'ok' : r.na ? 'na' : 'todo'}>{r.ok ? '✓' : r.na ? '–' : '!'}</span>
              <span className="grow">{t(`gd.ready.${r.key}` as never)}</span>
              {!r.ok && !r.na && <Link className="btn small ghost" to={fixLink[r.key]}>{t('gd.fix')}</Link>}
            </div>
          ))}
        </div>
      </Section>

      <Section title={t('gd.dayPlan')} id="drivers">
        <div className="stack">
          <Chips label={t('gd.setup')} value={day.setup ?? 'standard'} onChange={(v) => void up({ setup: v })}
            options={[{ value: 'standard', label: t('gd.setup.standard') }, { value: 'dj_only', label: t('gd.setup.dj_only') }]} />
          <div className="grid3">
            <label className="field"><span>{t('gd.doors')}</span><input type="time" value={day.doorsAt ?? ''} onChange={(e) => void up({ doorsAt: e.target.value || undefined })} /></label>
            <label className="field"><span>{t('gd.curfew')}</span><input type="time" value={day.curfew ?? ''} onChange={(e) => void up({ curfew: e.target.value || undefined })} /></label>
            <label className="field"><span>{t('gd.noiseLimit')}</span><input inputMode="numeric" value={day.noiseLimitDb ?? ''} onChange={(e) => void up({ noiseLimitDb: Number(e.target.value) || undefined })} /></label>
          </div>
          <Chips multi label={t('gd.drivers')} value={drivers} onChange={(m) => void up({ drivers: drivers.includes(m) ? drivers.filter((x) => x !== m) : [...drivers, m] })}
            options={MEMBERS.map((m) => ({ value: m, label: m === 'gijs' ? 'Gijs' : 'Coen' }))} />
          {drivers.map((m) => (
            <label key={m} className="field"><span>{t('gd.travelFor', { who: m === 'gijs' ? 'Gijs' : 'Coen' })}</span>
              <input inputMode="numeric" placeholder={day.route ? t('gd.travelFromMaps', { min: Math.round(day.route.seconds / 60) }) : t('gd.travelEstimate')}
                value={day.travelByMember?.[m] ?? ''} onChange={(e) => void up({ travelByMember: { ...(day.travelByMember ?? {}), [m]: Number(e.target.value) || undefined } })} />
            </label>
          ))}
          <div className="grid2">
            <label className="field"><span>{t('gd.pickupBy')}</span>
              <select value={day.pickup?.by ?? ''} onChange={(e) => void up({ pickup: e.target.value ? { by: e.target.value as MemberId, minutes: day.pickup?.minutes ?? 20 } : undefined })}>
                <option value="">{t('gd.noPickup')}</option>
                {MEMBERS.map((m) => <option key={m} value={m}>{t('gd.pickupFrom', { who: m === 'gijs' ? 'Gijs' : 'Coen', at: m === 'gijs' ? 'Coen' : 'Gijs' })}</option>)}
              </select>
            </label>
            {day.pickup && <label className="field"><span>{t('gd.pickupMinutes')}</span><input inputMode="numeric" value={day.pickup.minutes} onChange={(e) => void up({ pickup: { ...day.pickup!, minutes: Number(e.target.value) || 0 } })} /></label>}
          </div>
          <button className="btn small ghost" onClick={() => void regenerate(gig.id, lang).then(() => toast(t('gd.regenerated')))}>{t('gd.regenerate')}</button>
        </div>
      </Section>

      <Section title={t('gd.tab.timeline')}><TimelineList /></Section>

      <Section title={t('gd.tasks')}><TaskSplit tasks={tasks} me={me} gigId={gig.id} /></Section>

      <div className="stack">
        <button className="btn primary gd-main" onClick={() => void planDone()}>{t('gd.planReady')}</button>
        <div className="row">
          {phone && <a className="btn small" href={whatsAppLink(phone, msg)} target="_blank" rel="noreferrer">{t('gd.msgDayContact')}</a>}
          <button className="btn small ghost" onClick={async () => download(`plan-${gig.date}.fqday.json`, JSON.stringify(await exportPlan(gig.id)), 'application/json')}>{t('gd.sharePlan')}</button>
        </div>
        <p className="tiny muted">{t('gd.planReadyHint')}</p>
      </div>
    </div>
  );
}

function TaskSplit({ tasks, me, gigId }: { tasks: DayTask[]; me: MemberId; gigId: string }) {
  const { t } = useI18n();
  const [title, setTitle] = useState('');
  const [phase, setPhase] = useState<DayPhase>('setup');
  const cycle = (o: DayTask['owner']): DayTask['owner'] => (o === 'gijs' ? 'coen' : o === 'coen' ? 'both' : 'gijs');
  return (
    <div className="stack">
      {DAY_PHASES.map((p) => {
        const list = tasks.filter((x) => x.phase === p);
        if (!list.length) return null;
        return (
          <div key={p}>
            <div className="legend">{t(`gd.phaseTask.${p}` as never)}</div>
            {list.map((x) => (
              <div key={x.id} className="row gd-split">
                <span className={`grow ${x.done ? 'muted' : ''}`}>{x.done ? '✓ ' : ''}{x.title}</span>
                <button className="chip" onClick={() => void save<DayTask>('dayTasks', { ...x, owner: cycle(x.owner) })}>{x.owner === 'both' ? t('gd.both') : x.owner === 'gijs' ? 'Gijs' : 'Coen'}</button>
              </div>
            ))}
          </div>
        );
      })}
      <div className="row">
        <select value={phase} onChange={(e) => setPhase(e.target.value as DayPhase)}>{DAY_PHASES.map((p) => <option key={p} value={p}>{t(`gd.phaseTask.${p}` as never)}</option>)}</select>
        <input className="grow" placeholder={t('gd.newTask')} value={title} onChange={(e) => setTitle(e.target.value)} />
        <button className="btn small" disabled={!title.trim()} onClick={async () => { await addTask(gigId, phase, title.trim(), me); setTitle(''); }}>{t('common.add')}</button>
      </div>
      <details><summary className="tiny muted">{t('gd.myTasksAll')}</summary><TaskTicks tasks={tasks.filter((x) => x.owner === me || x.owner === 'both')} me={me} /></details>
    </div>
  );
}
