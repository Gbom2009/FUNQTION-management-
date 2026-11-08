import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useI18n, type Key } from '../core/i18n';
import { decodePayload } from '../core/share';
import type { WishKind } from '../core/types';
import { isPrivateEvent } from '../apps/promo/domain/promo';
import { wishesMessage, type Snapshot, type WishesAnswer } from '../apps/portal/domain/portal';
import { PublicShell } from './PublicShell';

type Snap = Snapshot & { fl?: string };
const KINDS: WishKind[] = ['must_play', 'special_moment', 'do_not_play', 'genre'];

export default function PortalPage() {
  const { data } = useParams();
  const snap = useMemo(() => (data ? decodePayload<Snap>(data) : null), [data]);
  return <PublicShell lang={snap?.l === 'en' ? 'en' : 'nl'}>{snap?.g ? <Page s={snap} /> : <Broken />}</PublicShell>;
}

function Broken() {
  const { t } = useI18n();
  return <div className="public-card"><h1>{t('fbp.broken')}</h1><p>{t('fbp.brokenHelp')}</p></div>;
}

const money = (c: number, lang: string) => new Intl.NumberFormat(lang === 'nl' ? 'nl-NL' : 'en-GB', { style: 'currency', currency: 'EUR' }).format(c / 100);

function Page({ s }: { s: Snap }) {
  const { t, lang } = useI18n();
  const on = (x: Snapshot['sec'][number]) => s.sec.includes(x);
  const today = new Date().toISOString().slice(0, 10);
  const days = Math.round((new Date(s.d + 'T12:00:00').getTime() - Date.now()) / 86400_000);
  const date = new Date(s.d + 'T12:00:00').toLocaleDateString(lang === 'nl' ? 'nl-NL' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const locked = !!s.lock && today > s.lock;
  const [wishes, setWishes] = useState<WishesAnswer['w']>([]);
  const [kind, setKind] = useState<WishKind>('must_play');
  const [text, setText] = useState('');
  const [time, setTime] = useState('');
  const [contacts, setContacts] = useState<[string, string, string?][]>([]);
  const [cName, setCName] = useState(''); const [cRole, setCRole] = useState(''); const [cPhone, setCPhone] = useState('');
  const [photo, setPhoto] = useState<boolean | undefined>();
  const [event, setEvent] = useState<boolean | undefined>();
  const [note, setNote] = useState('');
  const answer: WishesAnswer = { k: 'wishes', g: s.g, at: new Date().toISOString(), w: wishes, c: contacts, ok: { photo, event }, note: note.trim() || undefined };
  const msg = wishesMessage(s, answer);
  const somethingToSend = wishes.length || contacts.length || photo !== undefined || event !== undefined || note.trim();
  const privateParty = isPrivateEvent(s.et);

  return (
    <div className="public-card">
      <h1>{s.n ? t('pop.hi', { name: s.n }) : s.e}</h1>
      <p className="strong">{s.e}</p>
      {s.w && <p style={{ whiteSpace: 'pre-wrap' }}>{s.w}</p>}

      {on('overview') && <div className="card stack">
        <div className="tiny muted">{t(`stage.${s.st}` as Key)}</div>
        <div className="strong" style={{ textTransform: 'capitalize' }}>{date}</div>
        <div>{t('pop.times', { s: s.s, f: s.f })}</div>
        {s.ven && <div>{s.ven.n}{s.ven.a ? `, ${s.ven.a}` : ''}{s.ven.c ? `, ${s.ven.c}` : ''}</div>}
        {days > 0 && <div style={{ color: 'var(--fq-accent)' }}>{t('pop.countdown', { n: days })}</div>}
      </div>}

      {on('timeline') && !!s.tl?.length && <>
        <h2>{t('po.sec.timeline')}</h2>
        <div className="list">{s.tl.map(([at, label], i) => <div key={i} className="list-item row"><span className="mono-num strong" style={{ minWidth: 56 }}>{at}</span><span>{label}</span></div>)}</div>
        <p className="tiny muted">{t('pop.timelineNote')}</p>
      </>}

      {on('contacts') && (!!s.us?.length || !!s.co?.length) && <>
        <h2>{t('po.sec.contacts')}</h2>
        <div className="list">
          {s.us?.map(([n, p]) => <a key={n} className="list-item row between" href={`tel:${p}`}><span>{n} · Team Funqtion</span><span className="mono-num">{p}</span></a>)}
          {s.co?.map(([n, r, p]) => <div key={n} className="list-item row between"><span>{n} · {r}</span>{p && <a className="mono-num" href={`tel:${p}`}>{p}</a>}</div>)}
        </div>
      </>}

      {on('documents') && !!s.docs?.length && <>
        <h2>{t('po.sec.documents')}</h2>
        <div className="list">
          {s.docs.map((d, i) => (
            <div key={i} className="list-item row between">
              <span>{t(`pop.doc.${d.k}` as Key)}{d.no ? ` ${d.no}` : ''}{d.amt != null ? ` · ${money(d.amt, lang)}` : ''}</span>
              <span className="tiny" style={{ color: ['paid', 'accepted', 'signed'].includes(d.st) ? 'var(--ok)' : d.st === 'overdue' ? 'var(--danger)' : 'var(--fq-text-dim)' }}>{t(`pop.st.${d.st}` as Key)}{d.due && !['paid', 'credited'].includes(d.st) ? ` · ${t('pop.due', { d: d.due })}` : ''}</span>
            </div>
          ))}
        </div>
        <p className="tiny muted">{t('pop.docsNote')}</p>
      </>}

      {on('wishes') && <>
        <h2>{t('po.sec.wishes')}</h2>
        {!!s.wi?.length && <div className="list">{s.wi.map(([k, x, at], i) => <div key={i} className="list-item small">{t(`wish.${k}` as Key)}: {x}{at ? ` (${at})` : ''}</div>)}</div>}
        {locked ? <p className="small">{t('pop.locked')}</p> : <>
          <p className="small muted">{s.lock ? t('pop.lockOn', { d: new Date(s.lock + 'T12:00:00').toLocaleDateString(lang === 'nl' ? 'nl-NL' : 'en-GB', { day: 'numeric', month: 'long' }) }) : ''}</p>
          <div className="chips">{KINDS.map((k) => <button key={k} type="button" className="chip" aria-pressed={kind === k} onClick={() => setKind(k)}>{t(`wish.${k}` as Key)}</button>)}</div>
          <label className="field"><span>{kind === 'genre' ? t('pop.genre') : t('pop.track')}</span><input value={text} maxLength={200} placeholder={kind === 'genre' ? t('pop.genrePh') : t('pop.trackPh')} onChange={(e) => setText(e.target.value)} /></label>
          {kind === 'special_moment' && <label className="field"><span>{t('pop.when')}</span><input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>}
          <button className="btn" type="button" disabled={!text.trim()} onClick={() => { setWishes([...wishes, time && kind === 'special_moment' ? [kind, text.trim(), time] : [kind, text.trim()]]); setText(''); setTime(''); }}>+ {t('pop.add')}</button>
          {!!wishes.length && <div className="list">{wishes.map(([k, x, at], i) => (
            <div key={i} className="list-item row between"><span className="small">{t(`wish.${k}` as Key)}: {x}{at ? ` (${at})` : ''}</span><button className="btn icon small ghost" type="button" aria-label={t('pr.remove')} onClick={() => setWishes(wishes.filter((_, j) => j !== i))}>×</button></div>
          ))}</div>}
        </>}
      </>}

      {on('contacts') && !locked && <>
        <h2>{t('pop.addContact')}</h2>
        <p className="small muted">{t('pop.addContactHelp')}</p>
        <div className="grid2">
          <label className="field"><span>{t('pop.name')}</span><input value={cName} onChange={(e) => setCName(e.target.value)} /></label>
          <label className="field"><span>{t('pop.role')}</span><input value={cRole} placeholder={t('pop.rolePh')} onChange={(e) => setCRole(e.target.value)} /></label>
        </div>
        <label className="field"><span>{t('pop.phone')}</span><input inputMode="tel" value={cPhone} onChange={(e) => setCPhone(e.target.value)} /></label>
        <button className="btn" type="button" disabled={!cName.trim()} onClick={() => { setContacts([...contacts, [cName.trim(), cRole.trim(), cPhone.trim() || undefined]]); setCName(''); setCRole(''); setCPhone(''); }}>+ {t('pop.add')}</button>
        {!!contacts.length && <div className="list">{contacts.map(([n, r], i) => <div key={i} className="list-item small">{n}{r ? ` · ${r}` : ''}</div>)}</div>}
      </>}

      {(on('wishes') || on('contacts')) && <>
        <h2>{t('pop.photos')}</h2>
        <label className="check public-choice"><input type="checkbox" checked={photo === true} onChange={(e) => setPhoto(e.target.checked ? true : false)} /> {t('pop.photoOk')}</label>
        {privateParty && <label className="check public-choice"><input type="checkbox" checked={event === true} onChange={(e) => setEvent(e.target.checked ? true : false)} /> {t('pop.eventOk')}</label>}
        <label className="field"><span>{t('pop.note')}</span><textarea rows={3} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} /></label>
        <h2>{t('pop.sendTitle')}</h2>
        <p className="small muted">{t('pop.sendHelp')}</p>
        <div className="stack">
          {s.wa && <a className={`btn primary${somethingToSend ? '' : ' disabled'}`} aria-disabled={!somethingToSend} href={somethingToSend ? `https://wa.me/${s.wa}?text=${encodeURIComponent(msg)}` : undefined}>{t('fbp.sendWa')}</a>}
          {s.m && <a className={`btn${somethingToSend ? '' : ' disabled'}`} aria-disabled={!somethingToSend} href={somethingToSend ? `mailto:${s.m}?subject=${encodeURIComponent(`${t('po.sec.wishes')} – ${s.e}`)}&body=${encodeURIComponent(msg)}` : undefined}>{t('fbp.sendMail')}</a>}
        </div>
      </>}

      {on('after') && (s.pl || s.ph || s.sp || s.fl) && <>
        <h2>{t('po.sec.after')}</h2>
        {s.fl && <a className="btn primary" href={s.fl}>{t('pop.feedback')}</a>}
        {s.ph && <a className="btn" href={s.ph} target="_blank" rel="noopener noreferrer">{t('pop.photosLink')}</a>}
        {s.sp && <a className="btn" href={s.sp} target="_blank" rel="noopener noreferrer">{t('pop.playlist')}</a>}
        {!!s.pl?.length && <><h2>{t('pop.played')}</h2><ol className="small">{s.pl.map((x, i) => <li key={i}>{x}</li>)}</ol></>}
      </>}

      <p className="tiny muted" style={{ marginTop: 'var(--s6)' }}>{t('pop.privacy', { at: new Date(s.at).toLocaleDateString(lang === 'nl' ? 'nl-NL' : 'en-GB') })}</p>
    </div>
  );
}

