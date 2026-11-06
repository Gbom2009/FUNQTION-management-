import { useState } from 'react';
import { useI18n } from './i18n';
import { useSession } from './session';
import { Logo } from './ui';
import type { MemberId } from './types';

export default function Login() {
  const { t } = useI18n();
  const { members, login, me } = useSession();
  const [picked, setPicked] = useState<MemberId | null>(me?.id ?? null);
  const [pin, setPin] = useState('');
  const [err, setErr] = useState(false);
  const member = members.find((m) => m.id === picked);

  async function choose(id: MemberId) {
    setPicked(id);
    setErr(false);
    const m = members.find((x) => x.id === id);
    if (!m?.pinHash) await login(id);
  }

  return (
    <main className="login">
      <div className="login-box">
        <div style={{ display: 'grid', placeItems: 'center', gap: 'var(--s3)' }}>
          <Logo size={96} />
          <div className="tagline">{t('app.tagline')}</div>
        </div>
        <h1>{t('login.title')}</h1>
        <div className="who">
          {members.map((m) => (
            <button key={m.id} className={`btn ${picked === m.id ? 'primary' : 'bracket'}`} onClick={() => choose(m.id)}>{m.name}</button>
          ))}
        </div>
        {member?.pinHash && (
          <form className="stack" onSubmit={async (e) => { e.preventDefault(); setErr(!(await login(member.id, pin))); }}>
            <label className="field"><span>{t('login.pin')}</span>
              <input type="password" inputMode="numeric" autoFocus autoComplete="current-password" value={pin} onChange={(e) => setPin(e.target.value)} />
            </label>
            {err && <div className="banner danger"><span>✕</span><div className="txt">{t('login.wrongPin')}</div></div>}
            <button className="btn primary">{t('login.unlock')}</button>
          </form>
        )}
        <p className="tiny muted">{t('login.localNote')}</p>
      </div>
    </main>
  );
}
