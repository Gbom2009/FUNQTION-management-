import { Link } from 'react-router-dom';
import { useI18n } from '../core/i18n';
import { useSession } from '../core/session';
import { Logo } from '../core/ui';
import { APPS } from './apps';

export default function Hub() {
  const { t } = useI18n();
  const { me, logout } = useSession();
  return (
    <main className="hub">
      <header className="hub-head">
        <div className="row" style={{ gap: 'var(--s4)' }}>
          <Logo size={56} />
          <div>
            <div className="legend">Team Funqtion · Aarle-Rixtel</div>
            <div className="tagline">{t('app.tagline')}</div>
          </div>
        </div>
        <div className="row">
          <span className={`member ${me?.id}`}>{me?.name[0]}</span>
          <Link className="btn small ghost" to="/settings">{t('nav.settings')}</Link>
          <button className="btn small ghost" onClick={logout}>{t('login.switch')}</button>
        </div>
      </header>
      <h1 className="hub-title">{t('app.hub')}</h1>
      <p className="muted" style={{ marginBottom: 'var(--s6)' }}>{t('today.greeting', { name: me?.name ?? '' })}</p>
      <div className="tiles">
        {APPS.map((a, i) => {
          const inner = (
            <>
              <span className="idx">{String(i + 1).padStart(2, '0')}</span>
              <span className="name">{t(a.name)}</span>
              <span className="desc">{t(a.desc)}</span>
              <span className="go">{a.path ? `${t('app.open')} →` : t('app.soon')}</span>
            </>
          );
          return a.path
            ? <Link key={a.id} to={a.path} className="tile live bracket">{inner}</Link>
            : <div key={a.id} className="tile soon" aria-disabled="true">{inner}</div>;
        })}
      </div>
    </main>
  );
}
