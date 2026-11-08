import { Link, useNavigate } from 'react-router-dom';
import { useI18n, type Key } from '../../../core/i18n';
import { Empty, Section, useToast } from '../../../core/ui';
import { fmtDate, fmtDateTime } from '../../../core/format';
import { addDays, toDateStr, todayStr } from '../../../core/dates';
import { useGigs } from '../../bookings/data';
import { createDraft, useConsents, usePosts } from '../data';
import { postState, suggestionsFor } from '../domain/promo';
import { PostPill } from '../components';

/** The content calendar: what's due, what to make for coming gigs, what's planned. */
export default function Calendar() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const nav = useNavigate();
  const posts = usePosts();
  const consents = useConsents();
  const gigs = useGigs();
  const gigById = new Map(gigs.map((g) => [g.id, g]));
  const from = toDateStr(addDays(new Date(), -7));
  const to = toDateStr(addDays(new Date(), 90));
  const soon = gigs.filter((g) => g.date >= from && g.date <= to).sort((a, b) => a.date.localeCompare(b.date));
  const suggestions = soon.map((g) => ({ g, kinds: suggestionsFor(g, posts, consents) })).filter((x) => x.kinds.length);
  const due = posts.filter((p) => postState(p) === 'due');
  const planned = posts.filter((p) => ['idea', 'draft', 'ready'].includes(postState(p))).sort((a, b) => (a.plannedAt ?? '9').localeCompare(b.plannedAt ?? '9'));
  const done = posts.filter((p) => p.status === 'published').sort((a, b) => (b.confirmedAt ?? '').localeCompare(a.confirmedAt ?? '')).slice(0, 12);

  const row = (p: (typeof posts)[number]) => {
    const g = p.gigId ? gigById.get(p.gigId) : undefined;
    return (
      <Link key={p.id} to={`/promo/posts/${p.id}`} className="list-item row between" style={{ textDecoration: 'none' }}>
        <div>
          <div className="strong">{t(`pr.kind.${p.kind}` as Key)} · {t(`pr.format.${p.format}` as Key)}</div>
          <div className="tiny muted">{p.plannedAt ? fmtDateTime(p.plannedAt, lang) : t('pr.noTime')}{g ? ` · ${g.title}` : ''}</div>
        </div>
        <PostPill post={p} />
      </Link>
    );
  };

  return (
    <div>
      <div className="page-head row between">
        <h1>{t('app.promo')}</h1>
        <Link className="btn small" to="/promo/posts/new">+ {t('pr.newPost')}</Link>
      </div>
      <p className="banner info"><span className="txt">{t('pr.rule')}</span></p>

      {due.length > 0 && (
        <Section title={t('pr.nav.due')}>
          <div className="list">{due.map(row)}</div>
        </Section>
      )}

      <Section title={t('pr.suggestions')}>
        {suggestions.length ? (
          <div className="stack">
            {suggestions.map(({ g, kinds }) => (
              <div key={g.id} className="card">
                <div className="tiny muted">{fmtDate(g.date, lang)}</div>
                <div className="strong">{g.title}</div>
                <div className="row" style={{ flexWrap: 'wrap', marginTop: 'var(--s2)' }}>
                  {kinds.map((k) => (
                    <button key={k} className="btn small" onClick={async () => {
                      const p = await createDraft(g, k);
                      toast(t('pr.draftMade'));
                      nav(`/promo/posts/${p.id}`);
                    }}>+ {t(`pr.kind.${k}` as Key)}</button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : <Empty>{t('pr.noSuggestions')}</Empty>}
      </Section>

      <Section title={t('pr.planned')}>
        {planned.length ? <div className="list">{planned.map(row)}</div> : <Empty>{t('pr.noPlanned')}</Empty>}
      </Section>

      {done.length > 0 && (
        <Section title={t('pr.published')}>
          <div className="list">{done.map(row)}</div>
        </Section>
      )}
      <p className="tiny muted">{t('pr.today', { date: fmtDate(todayStr(), lang) })}</p>
    </div>
  );
}
