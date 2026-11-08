import { useEffect, type ReactNode } from 'react';
import { I18nProvider } from '../core/i18n';
import { Logo } from '../core/ui';
import type { Lang } from '../core/types';

/** Calm, branded frame for pages clients and guests open (no login, no app chrome). */
export function PublicShell({ lang, children }: { lang: Lang; children: ReactNode }) {
  useEffect(() => {
    document.documentElement.removeAttribute('data-theme'); // follow the phone (light outdoors)
    document.documentElement.lang = lang;
    const robots = document.createElement('meta');
    robots.name = 'robots'; robots.content = 'noindex, nofollow';
    const ref = document.createElement('meta');
    ref.name = 'referrer'; ref.content = 'no-referrer';
    document.head.append(robots, ref);
    return () => { robots.remove(); ref.remove(); };
  }, [lang]);
  return (
    <I18nProvider lang={lang}>
      <main className="public">
        <header className="public-head">
          <Logo size={44} />
          <div>
            <div className="strong" style={{ textTransform: 'uppercase' }}>Team Funqtion</div>
            <div className="tiny" style={{ color: 'var(--fq-accent)', letterSpacing: '0.2em' }}>FEEL THE MUSIQ</div>
          </div>
        </header>
        {children}
      </main>
    </I18nProvider>
  );
}
