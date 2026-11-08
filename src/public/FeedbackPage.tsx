import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useI18n, type Key } from '../core/i18n';
import { decodePayload } from '../core/share';
import { HIGHLIGHTS, SCORE_KEYS, answerMessage, type FeedbackAnswer, type FeedbackRequest, type Highlight, type ScoreKey } from '../apps/feedback/domain/feedback';
import { PublicShell } from './PublicShell';

const FACES = ['😕', '😐', '🙂', '😃', '🤩'];

export default function FeedbackPage() {
  const { data } = useParams();
  const req = useMemo(() => (data ? decodePayload<FeedbackRequest>(data) : null), [data]);
  const lang = req?.l === 'en' ? 'en' : 'nl';
  return <PublicShell lang={lang}>{req?.g ? <Form req={req} /> : <Broken />}</PublicShell>;
}

function Broken() {
  const { t } = useI18n();
  return <div className="public-card"><h1>{t('fbp.broken')}</h1><p>{t('fbp.brokenHelp')}</p></div>;
}

function Stars({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  return (
    <div className="public-stars" role="radiogroup" aria-label={label}>
      {FACES.map((f, i) => (
        <button key={i} type="button" role="radio" aria-checked={value === i + 1} aria-label={`${i + 1}/5`} className={value === i + 1 ? 'on' : ''} onClick={() => onChange(i + 1)}>{f}</button>
      ))}
    </div>
  );
}

function Form({ req }: { req: FeedbackRequest }) {
  const { t } = useI18n();
  const [step, setStep] = useState(0);
  const [r, setR] = useState(0);
  const [s, setS] = useState<Partial<Record<ScoreKey, number>>>({});
  const [rec, setRec] = useState<number | undefined>();
  const [h, setH] = useState<Highlight[]>([]);
  const [text, setText] = useState('');
  const [pub, setPub] = useState<FeedbackAnswer['pub']>('name');
  const [name, setName] = useState(req.n ?? '');
  const answer: FeedbackAnswer = { k: 'fb', g: req.g, at: new Date().toISOString(), r: r || 5, s, rec, h, t: text.trim() || undefined, pub, name: pub === 'name' ? name.trim() || undefined : undefined };
  const msg = answerMessage(req, answer);
  const steps = 4;

  return (
    <div className="public-card">
      <div className="tiny muted">{t('fbp.step', { n: Math.min(step + 1, steps), of: steps })} · {req.e}</div>
      <div className="public-progress"><span style={{ width: `${((step + 1) / (steps + 1)) * 100}%` }} /></div>

      {step === 0 && <>
        <h1>{t('fbp.hi', { name: req.n ?? '' })}</h1>
        <p>{t('fbp.intro')}</p>
        <h2>{t('fbp.overall')}</h2>
        <Stars value={r} onChange={(n) => { setR(n); setTimeout(() => setStep(1), 250); }} label={t('fbp.overall')} />
      </>}

      {step === 1 && <>
        <h2>{t('fbp.scores')}</h2>
        {SCORE_KEYS.map((k) => (
          <div key={k} className="public-row">
            <span>{t(`fbp.score.${k}` as Key)}</span>
            <Stars value={s[k] ?? 0} onChange={(n) => setS({ ...s, [k]: n })} label={t(`fbp.score.${k}` as Key)} />
          </div>
        ))}
        <h2>{t('fbp.recommend')}</h2>
        <div className="public-scale" role="radiogroup" aria-label={t('fbp.recommend')}>
          {Array.from({ length: 11 }, (_, i) => <button key={i} type="button" role="radio" aria-checked={rec === i} className={rec === i ? 'on' : ''} onClick={() => setRec(i)}>{i}</button>)}
        </div>
        <div className="row between tiny muted"><span>{t('fbp.notLikely')}</span><span>{t('fbp.veryLikely')}</span></div>
      </>}

      {step === 2 && <>
        <h2>{t('fbp.highlights')}</h2>
        <div className="chips">
          {HIGHLIGHTS.map((x) => <button key={x} type="button" className="chip" aria-pressed={h.includes(x)} onClick={() => setH(h.includes(x) ? h.filter((y) => y !== x) : [...h, x])}>{t(`fbp.h.${x}` as Key)}</button>)}
        </div>
        <h2>{t('fbp.words')}</h2>
        <textarea rows={5} value={text} maxLength={2000} placeholder={t('fbp.wordsPh')} onChange={(e) => setText(e.target.value)} />
      </>}

      {step === 3 && <>
        <h2>{t('fbp.share')}</h2>
        <p className="small muted">{t('fbp.shareHelp')}</p>
        <div className="stack">
          {(['name', 'anon', 'no'] as const).map((p) => (
            <label key={p} className="check public-choice"><input type="radio" name="pub" checked={pub === p} onChange={() => setPub(p)} /> {t(`fbp.pub.${p}` as Key)}</label>
          ))}
        </div>
        {pub === 'name' && <label className="field"><span>{t('fbp.nameAs')}</span><input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>}
      </>}

      {step === 4 && <>
        <h1>{t('fbp.thanks')} 🧡</h1>
        <p>{t('fbp.sendHelp')}</p>
        <div className="stack">
          {req.wa && <a className="btn primary" href={`https://wa.me/${req.wa}?text=${encodeURIComponent(msg)}`}>{t('fbp.sendWa')}</a>}
          {req.m && <a className="btn" href={`mailto:${req.m}?subject=${encodeURIComponent(`Feedback – ${req.e}`)}&body=${encodeURIComponent(msg)}`}>{t('fbp.sendMail')}</a>}
          <button className="btn ghost" type="button" onClick={() => navigator.clipboard?.writeText(msg)}>{t('fbp.copy')}</button>
        </div>
        <div className="stack" style={{ marginTop: 'var(--s6)' }}>
          {req.ig && <a className="btn" href={req.ig} target="_blank" rel="noopener noreferrer">{t('fbp.follow')}</a>}
          {req.gr && <a className="btn" href={req.gr} target="_blank" rel="noopener noreferrer">{t('fbp.google')}</a>}
        </div>
        <p className="tiny muted" style={{ marginTop: 'var(--s5)' }}>{t('fbp.privacy')}</p>
      </>}

      {step > 0 && step < 4 && (
        <div className="row between" style={{ marginTop: 'var(--s5)' }}>
          <button className="btn ghost" type="button" onClick={() => setStep(step - 1)}>{t('fbp.back')}</button>
          <button className="btn primary" type="button" onClick={() => setStep(step + 1)}>{step === 3 ? t('fbp.finish') : t('fbp.next')}</button>
        </div>
      )}
    </div>
  );
}
