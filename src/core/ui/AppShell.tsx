import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useI18n, type Key } from '../i18n';
import { useSession } from '../session';
import { Icon, Logo } from './index';

export interface NavItem { to: string; key: Key; icon: string; end?: boolean; badge?: number; mobile?: boolean }

/** Common chrome for every Funqtion app: sidebar on desktop, bottom tabs + FAB on mobile. */
export function AppShell({ title, nav, primary, settingsTo, children, topLinks = [] }: {
  title: Key;
  topLinks?: { to: string; label: string; badge?: number }[];
  nav: NavItem[];
  primary?: { to: string; label: string };
  settingsTo: string;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const { me, logout } = useSession();
  const Badge = ({ n }: { n?: number }) => (n ? <span className="tiny" style={{ marginLeft: 'auto', color: 'var(--fq-accent)' }}>{n}</span> : null);
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <Link to="/" className="row" style={{ textDecoration: 'none', gap: 'var(--s3)' }}>
            <Logo size={36} />
            <div><div className="strong small" style={{ textTransform: 'uppercase' }}>{t(title)}</div><div className="tiny" style={{ color: 'var(--fq-accent)', letterSpacing: '0.2em' }}>{t('app.tagline')}</div></div>
          </Link>
        </div>
        <nav aria-label={t(title)}>
          {nav.map((n) => <NavLink key={n.to} to={n.to} end={n.end}><Icon name={n.icon} /> {t(n.key)} <Badge n={n.badge} /></NavLink>)}
          {primary && <Link to={primary.to} className="btn primary" style={{ margin: 'var(--s4) var(--s5)', color: 'var(--fq-on-accent)' }}>+ {primary.label}</Link>}
        </nav>
        <div className="foot stack" style={{ gap: 'var(--s2)' }}>
          <NavLink to={settingsTo} className="row" style={{ textDecoration: 'none' }}><Icon name="settings" size={16} /> {t('nav.settings')}</NavLink>
          <Link to="/" className="row" style={{ textDecoration: 'none' }}><Icon name="hub" size={16} /> {t('nav.hub')}</Link>
          <button className="btn small ghost" style={{ justifyContent: 'flex-start', paddingLeft: 0 }} onClick={logout}><span className={`member ${me?.id}`}>{me?.name[0]}</span> {t('login.switch')}</button>
        </div>
      </aside>

      <main className="main">
        <div className="mobile-top">
          <Link to="/" className="row" style={{ textDecoration: 'none' }} aria-label={t('nav.hub')}><Logo size={30} /><span className="tiny" style={{ color: 'var(--fq-accent)', letterSpacing: '0.2em' }}>{t('app.tagline')}</span></Link>
          <div className="row">
            {topLinks.map((l) => <Link key={l.to} className="btn small ghost" to={l.to}>{l.label}{l.badge ? <span style={{ color: 'var(--fq-accent)' }}> {l.badge}</span> : null}</Link>)}
            <Link className="btn icon small ghost" to={settingsTo} aria-label={t('nav.settings')}><Icon name="settings" /></Link>
          </div>
        </div>
        {children}
      </main>

      <nav className="bottom-nav" aria-label={t(title)}>
        {nav.filter((n) => n.mobile !== false).slice(0, 5).map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end}><Icon name={n.icon} /><span>{t(n.key)}{n.badge ? ` ·${n.badge}` : ''}</span></NavLink>
        ))}
      </nav>
      {primary && <Link to={primary.to} className="fab" aria-label={primary.label}>+</Link>}
    </div>
  );
}
