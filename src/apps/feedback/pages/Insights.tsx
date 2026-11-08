import { useI18n, type Key } from '../../../core/i18n';
import { Empty, Section } from '../../../core/ui';
import { useGigs } from '../../bookings/data';
import { useReviews } from '../data';
import { SCORE_KEYS, summary } from '../domain/feedback';

export default function Insights() {
  const { t } = useI18n();
  const s = summary(useReviews(), useGigs());
  if (!s.count) return <div><div className="page-head"><h1>{t('fb.nav.insights')}</h1></div><Empty>{t('fb.noReviews')}</Empty></div>;
  return (
    <div>
      <div className="page-head"><h1>{t('fb.nav.insights')}</h1></div>
      <div className="grid3">
        <div className="stat card"><div className="tiny muted">{t('fb.avg')}</div><div className="big-text">{s.avg.toFixed(1)}</div></div>
        <div className="stat card"><div className="tiny muted">{t('fb.count')}</div><div className="big-text">{s.count}</div></div>
        <div className="stat card"><div className="tiny muted">{t('fb.nps')}</div><div className="big-text">{s.nps ?? '–'}</div></div>
      </div>
      <p className="tiny muted">{t('fb.npsHelp')}</p>
      <Section title={t('fb.scores')}>
        <div className="list">{SCORE_KEYS.map((k) => <div key={k} className="list-item row between"><span>{t(`fbp.score.${k}` as Key)}</span><span className="mono-num">{s.scoreAvg[k]?.toFixed(1) ?? '–'}</span></div>)}</div>
      </Section>
      <Section title={t('fb.byType')}>
        <div className="list">{s.byType.map((x) => <div key={x.type} className="list-item row between"><span>{t(`event.${x.type}` as Key)}</span><span className="mono-num">{x.avg.toFixed(1)} · {x.count}×</span></div>)}</div>
      </Section>
      {s.topHighlights.length > 0 && <Section title={t('fb.highlights')}>
        <div className="list">{s.topHighlights.map((x) => <div key={x.h} className="list-item row between"><span>{t(`fbp.h.${x.h}` as Key)}</span><span className="mono-num">{x.n}×</span></div>)}</div>
      </Section>}
      <p className="tiny muted">{t('fb.playsLater')}</p>
    </div>
  );
}
