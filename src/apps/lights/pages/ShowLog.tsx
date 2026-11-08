import { useI18n, type Key } from '../../../core/i18n';
import { Empty, Section } from '../../../core/ui';
import { fmtDateTime } from '../../../core/format';
import { useGigs } from '../../bookings/data';
import { useShowLog, useShows } from '../data';
import { laserHours } from '../domain/live';

export default function ShowLog() {
  const { t, lang } = useI18n();
  const shows = useShows();
  const gigs = new Map(useGigs().map((g) => [g.id, g]));
  return (
    <div>
      <div className="page-head"><h1>{t('lt.nav.log')}</h1></div>
      <p className="small muted">{t('lt.logHelp')}</p>
      {shows.length ? shows.map((s) => <ShowCard key={s.id} id={s.id} title={`${fmtDateTime(s.startedAt, lang)} · ${s.gigId ? gigs.get(s.gigId)?.title ?? '' : t('lt.noGig')}`} />) : <Empty>{t('lt.noShows')}</Empty>}
    </div>
  );
  function ShowCard({ id, title }: { id: string; title: string }) {
    const log = useShowLog(id);
    return (
      <Section title={title}>
        <div className="tiny muted">{t('lt.laserHours', { h: laserHours(log) })}</div>
        <div className="list">{log.map((l) => <div key={l.id} className="list-item tiny">{new Date(l.at).toLocaleTimeString('nl-NL')} · {t(`lt.ev.${l.event}` as Key)}{l.detail ? ` · ${l.detail}` : ''}</div>)}</div>
      </Section>
    );
  }
}
