import { Link } from 'react-router-dom';
import { useI18n } from '../../../core/i18n';
import { useSession } from '../../../core/session';
import { Empty, Eq, MemberChips, Section, StagePill } from '../../../core/ui';
import { euro, fmtDateLong } from '../../../core/format';
import { addDays, todayStr, toDateStr } from '../../../core/dates';
import { byId, mapsLink, personLabel, useEnquiries, useGigs, usePersons, useQuotes, useTasks, useVenues } from '../data';
import { GigLine, TaskRow } from '../components/parts';
import { PIPELINE, isUpcoming, quoteTotals } from '../domain/pipeline';

export default function Today() {
  const { t, lang } = useI18n();
  const { me } = useSession();
  const gigs = useGigs();
  const tasks = useTasks();
  const enquiries = useEnquiries();
  const venues = byId(useVenues());
  const persons = byId(usePersons());
  const quotes = useQuotes();
  const now = new Date();
  const today = todayStr();

  const booked = gigs.filter((g) => ['confirmed', 'played', 'invoiced', 'paid'].includes(g.stage));
  const upcoming = booked.filter((g) => isUpcoming(g, now)).sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
  const next = upcoming[0];
  const in7 = toDateStr(addDays(now, 7));
  const week = gigs.filter((g) => g.date >= today && g.date <= in7 && g.stage !== 'lost' && g.stage !== 'cancelled')
    .sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));

  const myTasks = tasks.filter((x) => x.status === 'open' && (x.assignedTo === me?.id || x.assignedTo === 'both'))
    .filter((x) => new Date(x.snoozedUntil ?? x.dueAt) <= addDays(now, 1))
    .sort((a, b) => (a.snoozedUntil ?? a.dueAt).localeCompare(b.snoozedUntil ?? b.dueAt));

  const newEnq = enquiries.filter((e) => e.status === 'new').sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  const oldestH = newEnq[0] ? Math.round((now.getTime() - new Date(newEnq[0].receivedAt).getTime()) / 3600_000) : 0;
  const age = oldestH >= 48 ? t('enq.age.d', { n: Math.round(oldestH / 24) }) : t('enq.age.h', { n: oldestH });

  const year = String(now.getFullYear());
  const yearGigs = gigs.filter((g) => g.date.startsWith(year));
  const yearBooked = yearGigs.filter((g) => ['confirmed', 'played', 'invoiced', 'paid'].includes(g.stage));
  const revenue = yearBooked.reduce((s, g) => s + (g.agreedFee ?? 0) + (g.travelFee ?? 0), 0);
  const decided = yearGigs.filter((g) => g.stage !== 'enquiry' && g.stage !== 'option' && g.stage !== 'quote_sent');
  const conversion = decided.length ? Math.round((yearBooked.length / decided.length) * 100) : 0;
  const openQuotes = gigs.filter((g) => g.stage === 'quote_sent');
  const openQuoteValue = openQuotes.reduce((s, g) => {
    const q = quotes.filter((x) => x.gigId === g.id).sort((a, b) => b.version - a.version)[0];
    return s + (q ? quoteTotals(q.lines).total : g.agreedFee ?? 0);
  }, 0);

  const v = next?.venueId ? venues.get(next.venueId) : undefined;
  const isTonight = next?.date === today;
  const dayContact = next?.contacts.find((c) => c.role === 'day_contact');
  const contact = dayContact ? persons.get(dayContact.personId) : next?.clientPersonId ? persons.get(next.clientPersonId) : undefined;

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="legend">{fmtDateLong(today, lang)}</div>
          <h1>{t('today.greeting', { name: me?.name ?? '' })}</h1>
        </div>
        <div className="tagline only-desktop">{t('app.tagline')}</div>
      </div>

      <div className="today-grid">
        <div className="stack">
          {next ? (
            <Link to={`/bookings/gigs/${next.id}`} className="hero-card" style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className="row between"><span className="legend">{isTonight ? <><Eq /> {t('today.tonight')}</> : t('today.nextGig')}</span><StagePill stage={next.stage} /></div>
              <div className="big">{next.title || next.reference}</div>
              <dl className="kv">
                <dt>{t('common.date')}</dt><dd>{fmtDateLong(next.date, lang)}</dd>
                <dt>{t('common.time')}</dt><dd>{next.setupTime ? `${t('gig.setupTime')} ${next.setupTime} · ` : ''}{next.startTime}–{next.endTime}</dd>
                {v && <><dt>{t('gig.venue')}</dt><dd>{[v.name, v.street, v.city].filter(Boolean).join(', ')}</dd></>}
                {contact && <><dt>{t('gig.client')}</dt><dd>{personLabel(contact)} {contact.phone && <>· {contact.phone}</>}</dd></>}
                <dt>{t('gig.performers')}</dt><dd><MemberChips ids={next.performers} /></dd>
              </dl>
              <div className="row" onClick={(e) => e.stopPropagation()}>
                {v && <a className="btn small" href={mapsLink(v)} target="_blank" rel="noreferrer">{t('gig.navigate')}</a>}
                {contact?.phone && <a className="btn small" href={`tel:${contact.phone}`}>{t('common.phone')}</a>}
              </div>
            </Link>
          ) : <Empty>{t('today.noGigs')}</Empty>}

          <Section title={t('today.newEnquiries')} actions={<Link className="btn small" to="/bookings/enquiries/new">+ {t('enq.new')}</Link>}>
            {newEnq.length === 0 ? <p className="muted small">—</p> : (
              <>
                <p className="small"><span className="strong" style={{ color: 'var(--fq-accent)' }}>{newEnq.length}</span> · {t('today.oldestWaiting', { age })}</p>
                <div className="list">
                  {newEnq.slice(0, 5).map((e) => (
                    <Link key={e.id} to={`/bookings/enquiries/${e.id}`} className="list-item">
                      <div className="grow"><div className="strong">{e.contactName || '—'}</div><div className="tiny muted">{t(`channel.${e.channel}`)} · {e.requestedDate ?? e.requestedDateText ?? ''} {e.locationText ? `· ${e.locationText}` : ''}</div></div>
                    </Link>
                  ))}
                </div>
              </>
            )}
          </Section>
        </div>

        <Section title={t('today.tasks')} actions={<Link className="btn small ghost" to="/bookings/tasks">{t('nav.tasks')} →</Link>}>
          {myTasks.length === 0 ? <p className="muted small">{t('today.noTasks')}</p> : (
            <div className="list">{myTasks.slice(0, 8).map((x) => <TaskRow key={x.id} task={x} />)}</div>
          )}
        </Section>

        <div className="dash full">
        <Section title={t('today.next7')}>
          {week.length === 0 ? <p className="muted small">{t('cal.nothing')}</p> : <div className="list">{week.map((g) => <GigLine key={g.id} gig={g} />)}</div>}
        </Section>

        <Section title={`${t('today.stats')} ${year}`}>
          <div className="grid2">
            <div className="stat"><div className="legend">{t('today.stats.gigs')}</div><div className="v">{yearBooked.length}</div></div>
            <div className="stat"><div className="legend">{t('today.stats.revenue')}</div><div className="v">{euro(revenue, lang)}</div></div>
            <div className="stat"><div className="legend">{t('today.stats.conversion')}</div><div className="v">{conversion}%</div></div>
            <div className="stat"><div className="legend">{t('today.stats.awaiting')}</div><div className="v">{openQuotes.length}</div><div className="tiny muted">{euro(openQuoteValue, lang)}</div></div>
          </div>
          <div className="stack" style={{ marginTop: 'var(--s4)', gap: 'var(--s2)' }}>
            {PIPELINE.map((s) => {
              const n = gigs.filter((g) => g.stage === s && (s !== 'paid' || g.date.startsWith(year))).length;
              return <Link key={s} to={`/bookings/pipeline?stage=${s}`} className="row between small" style={{ textDecoration: 'none' }}><StagePill stage={s} /><span className="strong">{n}</span></Link>;
            })}
          </div>
        </Section>
        </div>
      </div>
    </div>
  );
}
