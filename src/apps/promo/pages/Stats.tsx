import { Link } from 'react-router-dom';
import { useI18n, type Key } from '../../../core/i18n';
import { Empty, Section } from '../../../core/ui';
import { POST_KINDS } from '../../../core/types';
import { usePosts } from '../data';
import { engagement } from '../domain/promo';

export default function Stats() {
  const { t } = useI18n();
  const posts = usePosts();
  const all = engagement(posts);
  const pub = posts.filter((p) => p.status === 'published').sort((a, b) => (b.confirmedAt ?? '').localeCompare(a.confirmedAt ?? ''));
  return (
    <div>
      <div className="page-head"><h1>{t('pr.nav.stats')}</h1></div>
      <p className="small muted">{t('pr.statsHelp')}</p>
      <div className="grid3">
        <div className="stat card"><div className="tiny muted">{t('pr.statPosts')}</div><div className="big-text">{all.posts}</div></div>
        <div className="stat card"><div className="tiny muted">{t('pr.statReach')}</div><div className="big-text">{all.avgReach}</div></div>
        <div className="stat card"><div className="tiny muted">{t('pr.statLikes')}</div><div className="big-text">{all.avgLikes}</div></div>
      </div>
      <Section title={t('pr.byKind')}>
        <div className="table-wrap"><table className="tbl">
          <thead><tr><th>{t('pr.kindLabel')}</th><th>{t('pr.statPosts')}</th><th>{t('pr.statReach')}</th><th>{t('pr.statLikes')}</th></tr></thead>
          <tbody>
            {POST_KINDS.map((k) => { const e = engagement(posts.filter((p) => p.kind === k)); return e.posts ? <tr key={k}><td>{t(`pr.kind.${k}` as Key)}</td><td>{e.posts}</td><td>{e.avgReach}</td><td>{e.avgLikes}</td></tr> : null; })}
          </tbody>
        </table></div>
      </Section>
      <Section title={t('pr.published')}>
        {pub.length ? (
          <div className="list">
            {pub.map((p) => { const s = p.stats?.[p.stats.length - 1]; return (
              <Link key={p.id} to={`/promo/posts/${p.id}`} className="list-item row between" style={{ textDecoration: 'none' }}>
                <span>{t(`pr.kind.${p.kind}` as Key)} · {p.confirmedAt?.slice(0, 10)}</span>
                <span className="tiny muted mono-num">{s ? `${s.reach ?? '–'} ${t('pr.stat.reach')} · ${s.likes ?? '–'} ♥ · ${s.saves ?? '–'} ⤓` : t('pr.noStats')}</span>
              </Link>
            ); })}
          </div>
        ) : <Empty>{t('pr.noPublished')}</Empty>}
      </Section>
    </div>
  );
}
