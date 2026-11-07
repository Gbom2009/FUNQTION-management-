import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../../core/db';
import { translate, type Key } from '../../../core/i18n';
import { useSession } from '../../../core/session';
import { Logo } from '../../../core/ui';
import { euro, fmtDate } from '../../../core/format';
import { signClient, type SignResult } from '../data';
import { SignaturePad, SnapshotView } from '../components';

// Full-screen, client-facing signing view for an in-person signature on our
// phone/tablet. No app navigation, all texts in the contract's language.

export default function SignHere() {
  const { id } = useParams();
  const nav = useNavigate();
  const { me } = useSession();
  const c = useLiveQuery(() => db.contracts.get(id!), [id]);
  const v = useLiveQuery(() => (c?.currentVersionId ? db.contractVersions.get(c.currentVersionId) : undefined), [c?.currentVersionId]);
  const [read, setRead] = useState(false);
  const [agree, setAgree] = useState(false);
  const [terms, setTerms] = useState(false);
  const [photoOptOut, setPhotoOptOut] = useState(false);
  const [extras, setExtras] = useState<string[]>([]);
  const [name, setName] = useState<string | null>(null);
  const [role, setRole] = useState('');
  const [place, setPlace] = useState('');
  const [typed, setTyped] = useState(false);
  const [img, setImg] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<SignResult | null>(null);
  if (!c || !me) return null;
  const back = () => nav(`/contracts/${c.id}`);
  if (!v || v.status !== 'sent') {
    return <main className="signhere"><p>—</p><button className="btn" onClick={back}>←</button></main>;
  }
  const s = v.snapshot;
  const t = (k: Key, p?: Record<string, string | number>) => translate(s.language, k, p);
  const signer = name ?? (s.client.attention || s.client.name);
  const ready = read && agree && terms && signer.trim().length > 1 && (typed || !!img) && !busy;

  if (done) {
    return (
      <main className="signhere">
        <div className="signhere-done">
          <Logo size={64} />
          <h1>{t('ct.sign.doneTitle')}</h1>
          <p>{t('ct.sign.doneText')}</p>
          {done.conflict && <div className="banner warn"><span>!</span><div className="txt">{translate('nl', 'q.conflictWarn')}</div></div>}
          <button className="btn primary" onClick={back}>{t('ct.sign.backToApp')}</button>
        </div>
      </main>
    );
  }

  async function sign() {
    setBusy(true);
    try {
      const r = await signClient(c!, v!, { name: signer.trim(), role: role || undefined, method: 'drawn_on_device', channel: 'in_person', imageDataUrl: typed ? undefined : img,
        photoOptOut, selectedExtras: extras, place: place || undefined, email: s.client.email }, me!.id);
      setDone(r);
    } finally { setBusy(false); }
  }

  return (
    <main className="signhere">
      <header className="signhere-head">
        <Logo size={40} />
        <div className="grow">
          <div className="legend" style={{ color: 'var(--fq-accent)' }}>{t('ct.sign.yourAgreement')}</div>
          <h1>{s.event.title}</h1>
          <div className="small">{fmtDate(s.event.date, s.language, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · {s.event.venueName}</div>
        </div>
        <button className="btn ghost icon" aria-label={t('common.cancel')} onClick={() => { if (window.confirm(t('ct.sign.leave'))) back(); }}>✕</button>
      </header>

      <section className="card stack">
        <div className="legend">{t('ct.pdf.summary')}</div>
        <dl className="kv">
          <dt>{t('ct.pdf.times')}</dt><dd>{s.event.sets.map((x) => `${x.start}–${x.end}`).join(', ')}</dd>
          <dt>{t('ct.pdf.price')}</dt><dd><strong>{euro(s.price.total, s.language)}</strong></dd>
          <dt>{t('ct.pdf.deposit')}</dt><dd>{euro(s.price.depositAmount, s.language)} ({s.price.depositPct}%)</dd>
          <dt>{t('ct.pdf.cancellation')}</dt><dd>{s.cancellation.map((r) => `${r.pct}%`).join(' → ')} <span className="tiny muted">({t('ct.sign.seeArticle')})</span></dd>
        </dl>
      </section>

      <section>
        <div className="legend">{t('ct.sign.readAll')}</div>
        <div className="signhere-doc" onScroll={(e) => { const el = e.currentTarget; if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) setRead(true); }}>
          <SnapshotView s={s} />
        </div>
        {!read && <button className="btn small ghost" onClick={() => setRead(true)}>{t('ct.sign.readDone')}</button>}
      </section>

      {s.extras.length > 0 && (
        <section className="card stack">
          <div className="legend">{t('q.chooseExtras')}</div>
          {s.extras.map((x) => (
            <label key={x.id} className="check"><input type="checkbox" checked={extras.includes(x.id)} onChange={(e) => setExtras(e.target.checked ? [...extras, x.id] : extras.filter((y) => y !== x.id))} />{x.description} (+ {euro(x.amount, s.language)})</label>
          ))}
        </section>
      )}

      <section className="card stack">
        <label className="check"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />{t('ct.sign.consentContract')}</label>
        <label className="check"><input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} />{t('ct.sign.consentTerms', { version: s.terms.version })}</label>
        {s.clauses.some((x) => x.key === 'R1') && <label className="check"><input type="checkbox" checked={photoOptOut} onChange={(e) => setPhotoOptOut(e.target.checked)} />{t('ct.sig.photoOptOut')}</label>}
      </section>

      <section className="card stack">
        <label className="field"><span>{t('ct.sig.name')}</span><input value={signer} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>
        {s.clientKind === 'business' && <label className="field"><span>{t('ct.sig.role')}</span><input value={role} onChange={(e) => setRole(e.target.value)} placeholder={t('ct.sig.rolePlaceholder')} /></label>}
        <label className="field"><span>{t('ct.sig.place')}</span><input value={place} onChange={(e) => setPlace(e.target.value)} /></label>
        <div className="chips">
          <button type="button" className="chip" aria-pressed={!typed} onClick={() => setTyped(false)}>{t('ct.sign.draw')}</button>
          <button type="button" className="chip" aria-pressed={typed} onClick={() => setTyped(true)}>{t('ct.sign.typed')}</button>
        </div>
        {typed ? <p className="signhere-typed">{signer}</p> : <SignaturePad label={t('ct.sign.drawHere')} onChange={setImg} />}
        {!read && <p className="tiny muted">{t('ct.sign.readFirst')}</p>}
        <button className="btn primary signhere-btn" disabled={!ready} onClick={sign}>{t('ct.sign.button')}</button>
        <p className="tiny muted">{t('ct.sign.legal', { label: v.label })}</p>
      </section>
      <p className="tiny muted" style={{ textAlign: 'center' }}><Link to={`/contracts/${c.id}`} onClick={(e) => { if (!window.confirm(t('ct.sign.leave'))) e.preventDefault(); }}>Team Funqtion · FEEL THE MUSIQ</Link></p>
    </main>
  );
}
