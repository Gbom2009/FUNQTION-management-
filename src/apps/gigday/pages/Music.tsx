import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../../core/db';
import { useI18n } from '../../../core/i18n';
import { Modal, Section } from '../../../core/ui';
import type { MusicWish } from '../../../core/types';
import { addWish, regenerate, setWish } from '../data';
import { hhmm, useGigCtx } from '../components';

/** Special moments in time order, must-plays to tick, the do-not-play list always in sight, and a "mag dit?" search. */
export default function Music() {
  const { t, lang } = useI18n();
  const { gig, steps } = useGigCtx();
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<MusicWish | 'new' | null>(null);
  const wishes = gig.musicWishes ?? [];
  const moments = wishes.filter((w) => w.kind === 'special_moment')
    .map((w) => ({ w, at: steps.find((s) => s.kind === 'moment' && s.sourceRef === w.id)?.plannedAt }))
    .sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''));
  const must = wishes.filter((w) => w.kind === 'must_play');
  const dont = wishes.filter((w) => w.kind === 'do_not_play');
  const genres = wishes.filter((w) => w.kind === 'genre');
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const hit = q.trim() ? dont.filter((w) => norm(`${w.text} ${w.track ?? ''}`).includes(norm(q.trim()))) : [];

  const plan = useLiveQuery(() => db.setPlans.where('gigId').equals(gig.id).first(), [gig.id]);
  return (
    <div className="stack" style={{ gap: 'var(--s6)' }}>
      <div className="row">
        {plan ? <Link className="btn" to={`/sets/${plan.id}`}>{t('sets.openPlan')} ({plan.items.length})</Link> : <Link className="btn" to="/sets">{t('sets.makePlan')}</Link>}
        {plan && <Link className="btn ghost" to={`/sets/${plan.id}/live`}>{t('sets.live')}</Link>}
      </div>
      <div className="field">
        <span>{t('gd.mayWe')}</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('gd.mayWeHint')} />
        {q.trim() && <div className={hit.length ? 'banner danger' : 'banner'}><div className="txt">{hit.length ? `${t('gd.onDontList')}: ${hit.map((h) => h.text).join(', ')}` : t('gd.notOnDontList')}</div></div>}
      </div>

      <Section title={t('gd.moments')} actions={<button className="btn small" onClick={() => setEdit('new')}>+ {t('gd.moment')}</button>}>
        <div className="stack" style={{ gap: 'var(--s2)' }}>
          {moments.map(({ w, at }) => (
            <div key={w.id} className={`gd-moment ${w.done ? 'done' : ''}`}>
              <span className="mono-num gd-step-time">{w.at || hhmm(at)}</span>
              <span className="grow" onClick={() => setEdit(w)} role="button" tabIndex={0}>
                <span className="strong">{w.text}</span>
                {w.track && <span className="small"> · {w.track}</span>}
                {w.cue && <span className="tiny muted"> · {w.cue}</span>}
                {w.mc && w.mc !== 'none' && <span className="tiny"> · 🎤 {w.mc === 'gijs' ? 'Gijs' : 'Coen'}</span>}
              </span>
              <button className={`btn small ${w.done ? 'ghost' : 'primary'}`} onClick={() => void setWish(gig.id, w.id, w.done ? { done: false, doneAt: undefined } : { done: true, doneAt: new Date().toISOString() })}>{w.done ? '✓' : t('gd.done')}</button>
            </div>
          ))}
          {!moments.length && <p className="muted small">{t('gd.noMoments')}</p>}
        </div>
      </Section>

      <Section title={t('gd.mustPlay')}>
        {must.map((w) => (
          <button key={w.id} className={`gd-task ${w.done ? 'done' : ''}`} onClick={() => void setWish(gig.id, w.id, { done: !w.done, doneAt: w.done ? undefined : new Date().toISOString() })}>
            <span className="gd-box">{w.done ? '✓' : ''}</span><span className="grow">{w.text}</span>
          </button>
        ))}
        {!must.length && <p className="muted small">–</p>}
      </Section>

      <Section title={t('gd.doNotPlay')}>
        <ul className="gd-dont">{dont.map((w) => <li key={w.id}>{w.text}</li>)}</ul>
        {!dont.length && <p className="muted small">–</p>}
      </Section>

      {genres.length > 0 && <Section title={t('gd.genres')}><p>{genres.map((g) => g.text).join(' · ')}</p></Section>}

      {edit && <MomentModal w={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} onSave={async (p) => {
        if (edit === 'new') await addWish(gig.id, { kind: 'special_moment', text: p.text ?? '', ...p });
        else await setWish(gig.id, edit.id, p);
        await regenerate(gig.id, lang);
        setEdit(null);
      }} />}
    </div>
  );
}

function MomentModal({ w, onClose, onSave }: { w?: MusicWish; onClose: () => void; onSave: (p: Partial<MusicWish>) => void }) {
  const { t } = useI18n();
  const [p, setP] = useState<Partial<MusicWish>>({ text: w?.text ?? '', at: w?.at ?? '', track: w?.track ?? '', cue: w?.cue ?? '', mc: w?.mc ?? 'none' });
  const f = (k: 'text' | 'at' | 'track' | 'cue', label: string, type = 'text') => (
    <label className="field"><span>{label}</span><input type={type} value={(p[k] as string) ?? ''} onChange={(e) => setP({ ...p, [k]: e.target.value })} /></label>
  );
  return (
    <Modal title={w ? w.text : t('gd.moment')} onClose={onClose} footer={<button className="btn primary" disabled={!p.text?.trim()} onClick={() => onSave({ ...p, at: p.at || undefined })}>{t('common.save')}</button>}>
      {f('text', t('gd.momentTitle'))}
      {f('at', t('gd.momentAt'), 'time')}
      <p className="tiny muted">{t('gd.momentAtHint')}</p>
      {f('track', t('gd.momentTrack'))}
      {f('cue', t('gd.momentCue'))}
      <label className="field"><span>{t('gd.momentMc')}</span>
        <select value={p.mc} onChange={(e) => setP({ ...p, mc: e.target.value as MusicWish['mc'] })}>
          <option value="none">–</option><option value="gijs">Gijs</option><option value="coen">Coen</option>
        </select>
      </label>
    </Modal>
  );
}
