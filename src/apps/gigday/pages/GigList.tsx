import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../../../core/i18n';
import { useToast, Empty, Section } from '../../../core/ui';
import { fmtDate } from '../../../core/format';
import { addDays, toDateStr, todayStr } from '../../../core/dates';
import type { Gig } from '../../../core/types';
import { useGigs, useVenues } from '../../bookings/data';
import { importPlan, useAllGigDays } from '../data';

const ACTIVE: Gig['stage'][] = ['option', 'quote_sent', 'confirmed', 'played'];

/** Today first, tomorrow (prep), then the coming weeks; and gig days still to wrap up. */
export default function GigList() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const file = useRef<HTMLInputElement>(null);
  const today = todayStr();
  const tomorrow = toDateStr(addDays(new Date(), 1));
  const days = new Map(useAllGigDays().map((d) => [d.gigId, d]));
  const venues = new Map(useVenues().map((v) => [v.id, v]));
  const gigs = useGigs().filter((g) => ACTIVE.includes(g.stage)).sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`));
  // "Yesterday" counts as today until noon: gigs end after midnight.
  const yesterday = toDateStr(addDays(new Date(), -1));
  const isToday = (g: Gig) => g.date === today || (g.date === yesterday && new Date().getHours() < 12);
  const todays = gigs.filter(isToday);
  const tomorrows = gigs.filter((g) => g.date === tomorrow);
  const upcoming = gigs.filter((g) => g.date > tomorrow && g.date <= toDateStr(addDays(new Date(), 60)));
  const wrapping = gigs.filter((g) => g.date < today && !isToday(g) && days.get(g.id)?.status && days.get(g.id)?.status !== 'closed');

  const card = (g: Gig, big = false) => {
    const d = days.get(g.id);
    const v = g.venueId ? venues.get(g.venueId) : undefined;
    const action = !d?.status ? t('gd.next.plan') : d.status === 'closed' ? t('gd.next.closed') : d.status === 'wrapping_up' || (g.date < today && !isToday(g)) ? t('gd.next.wrap') : d.status === 'live' ? t('gd.next.live') : t('gd.next.open');
    return (
      <Link key={g.id} to={`/gigday/${g.id}`} className={`card gd-card ${big ? 'big' : ''}`}>
        <div className="tiny muted">{fmtDate(g.date, lang)} · {g.setupTime || g.startTime}–{g.endTime}</div>
        <div className="gd-card-title">{g.title}</div>
        {v && <div className="small muted">{v.name}{v.city ? `, ${v.city}` : ''}</div>}
        <div className="gd-card-go">{action} →</div>
      </Link>
    );
  };

  return (
    <div>
      <div className="page-head row between">
        <h1>{t('app.gigday')}</h1>
        <button className="btn small ghost" onClick={() => file.current?.click()}>{t('gd.importPlan')}</button>
        <input ref={file} type="file" accept=".json,.fqday,application/json" hidden onChange={async (e) => {
          const f = e.target.files?.[0]; e.target.value = '';
          if (!f) return;
          try { const r = await importPlan(await f.text()); toast(t('gd.importDone', { n: r.inserted + r.updated })); }
          catch { toast(t('gd.importFailed')); }
        }} />
      </div>
      {todays.length > 0 && <Section title={t('gd.today')}><div className="stack">{todays.map((g) => card(g, true))}</div></Section>}
      {tomorrows.length > 0 && <Section title={t('gd.tomorrow')}><div className="stack">{tomorrows.map((g) => card(g))}</div></Section>}
      {wrapping.length > 0 && <Section title={t('gd.toWrap')}><div className="stack">{wrapping.map((g) => card(g))}</div></Section>}
      <Section title={t('gd.upcoming')}>
        {upcoming.length ? <div className="stack">{upcoming.map((g) => card(g))}</div> : <Empty>{t('gd.noUpcoming')}</Empty>}
      </Section>
    </div>
  );
}
