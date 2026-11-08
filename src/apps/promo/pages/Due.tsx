import { Link } from 'react-router-dom';
import { useI18n, type Key } from '../../../core/i18n';
import { Empty, Section, useToast } from '../../../core/ui';
import { fmtDateTime } from '../../../core/format';
import { shareToInstagram, usePosts } from '../data';
import { fullCaption, postState } from '../domain/promo';

/** "Klaar om te posten": reminders whose time has come. Posting stays a manual step. */
export default function Due() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const due = usePosts().filter((p) => postState(p) === 'due').sort((a, b) => (a.plannedAt ?? '').localeCompare(b.plannedAt ?? ''));
  return (
    <div>
      <div className="page-head"><h1>{t('pr.nav.due')}</h1></div>
      <p className="small muted">{t('pr.dueHelp')}</p>
      <Section>
        {due.length ? (
          <div className="stack">
            {due.map((p) => (
              <div key={p.id} className="card stack">
                <div className="strong">{t(`pr.kind.${p.kind}` as Key)} · {t(`pr.format.${p.format}` as Key)}</div>
                <div className="tiny muted">{p.plannedAt && fmtDateTime(p.plannedAt, lang)}</div>
                <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{fullCaption(p).slice(0, 240)}{fullCaption(p).length > 240 ? '…' : ''}</div>
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  <button className="btn small" onClick={async () => toast(t((await shareToInstagram(p, fullCaption(p))) === 'shared' ? 'pr.shared' : 'pr.downloaded'))}>{t('pr.share')}</button>
                  <Link className="btn small primary" to={`/promo/posts/${p.id}`}>{t('pr.openToConfirm')}</Link>
                </div>
              </div>
            ))}
          </div>
        ) : <Empty>{t('pr.nothingDue')}</Empty>}
      </Section>
    </div>
  );
}
