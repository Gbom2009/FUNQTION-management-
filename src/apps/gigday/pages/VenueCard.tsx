import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../../core/db';
import { alive, save } from '../../../core/repo';
import { useI18n } from '../../../core/i18n';
import { Empty, Modal, Section, useToast } from '../../../core/ui';
import { fmtDate } from '../../../core/format';
import { VENUE_NOTE_KINDS, type Venue, type VenueNote, type VenueNoteKind, type VenuePhoto } from '../../../core/types';
import { addVenueNote, addVenuePhoto, useVenueNotes, venueAddress } from '../data';
import { useGigCtx } from '../components';

type EditKey = 'stageSize' | 'powerPoints' | 'wifiName' | 'wifiPassword' | 'accessCode' | 'houseRules' | 'loadInNotes' | 'parkingNotes' | 'powerNotes' | 'curfew' | 'defaultDoors';

/** Everything about the venue for today: entrance, parking, power, Wi-Fi, limits, earlier notes and photos. */
export default function VenueCard() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const { gig, venue, day } = useGigCtx();
  const notes = useVenueNotes(venue?.id);
  const photos = (useLiveQuery(async () => (venue ? alive(await db.venuePhotos.where('venueId').equals(venue.id).toArray()) : []), [venue?.id]) ?? []) as VenuePhoto[];
  const [edit, setEdit] = useState(false);
  const [note, setNote] = useState(false);
  const [showStale, setShowStale] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  if (!venue) return <Empty>{t('gd.noVenue')} <Link to={`/bookings/gigs/${gig.id}`}>{t('gd.fix')}</Link></Empty>;

  const set = (k: EditKey, v: string) => void save<Venue>('venues', { ...venue, [k]: v || undefined });
  const copy = async (s: string) => { try { await navigator.clipboard.writeText(s); toast(t('gd.copied')); } catch { /* not allowed */ } };
  const curfew = day.curfew || venue.curfew;
  const noise = day.noiseLimitDb ?? venue.soundLimitDb;
  const live = notes.filter((n) => !n.stale);
  const stale = notes.filter((n) => n.stale);

  const field = (k: EditKey, label: string, opts: { copy?: boolean; area?: boolean } = {}) => {
    const v = (venue[k] as string | undefined) ?? '';
    if (edit) return (
      <label className="field" key={k}><span>{label}</span>
        {opts.area ? <textarea rows={2} value={v} onChange={(e) => set(k, e.target.value)} /> : <input value={v} onChange={(e) => set(k, e.target.value)} />}
      </label>
    );
    if (!v) return null;
    return (
      <div className="kv" key={k}><span className="tiny muted">{label}</span>
        <span className="row" style={{ justifyContent: 'space-between' }}><span>{v}</span>{opts.copy && <button className="btn small ghost" onClick={() => void copy(v)}>{t('gd.copy')}</button>}</span>
      </div>
    );
  };

  return (
    <div className="stack" style={{ gap: 'var(--s5)' }}>
      <div className="card">
        <div className="strong">{venue.name}</div>
        <div className="muted small">{venueAddress(venue) || t('gd.noAddress')}</div>
        <div className="row" style={{ marginTop: 'var(--s3)' }}>
          <Link className="btn primary" to={`/maps?gig=${gig.id}`}>{venue.loadingEntrance ? t('gd.routeEntrance') : t('gd.route')}</Link>
          <Link className="btn ghost" to={`/maps?gig=${gig.id}&pick=1`}>{t('gd.setEntrance')}</Link>
        </div>
        {venue.loadingEntrance?.note && <p className="small">{venue.loadingEntrance.note}</p>}
      </div>

      {(curfew || noise) && (
        <div className="gd-limits">
          {curfew && <div><div className="tiny muted">{t('gd.curfew')}</div><div className="gd-big mono-num">{curfew}</div></div>}
          {noise ? <div><div className="tiny muted">{t('gd.noiseLimit')}</div><div className="gd-big mono-num">{noise} dB</div></div> : null}
        </div>
      )}

      <Section title={t('gd.venueInfo')} actions={<button className="btn small ghost" onClick={() => setEdit(!edit)}>{edit ? t('gd.done') : t('common.edit')}</button>}>
        <div className="stack" style={{ gap: 'var(--s2)' }}>
          {field('loadInNotes', t('gd.v.loadIn'), { area: true })}
          {field('parkingNotes', t('gd.v.parking'), { area: true })}
          {field('powerPoints', t('gd.v.powerPoints'), { area: true })}
          {field('powerNotes', t('gd.v.powerNotes'), { area: true })}
          {field('stageSize', t('gd.v.stage'))}
          {field('wifiName', t('gd.v.wifi'), { copy: true })}
          {field('wifiPassword', t('gd.v.wifiPassword'), { copy: true })}
          {field('accessCode', t('gd.v.access'), { copy: true })}
          {field('houseRules', t('gd.v.rules'), { area: true })}
          {edit && field('curfew', t('gd.curfew'))}
          {edit && field('defaultDoors', t('gd.v.doors'))}
          {venue.contactName && !edit && <div className="kv"><span className="tiny muted">{t('gd.role.venue')}</span><span>{venue.contactName} {venue.contactPhone && <a href={`tel:${venue.contactPhone}`}>{venue.contactPhone}</a>}</span></div>}
          {edit && <p className="tiny muted">{t('gd.wifiNote')}</p>}
        </div>
      </Section>

      <Section title={t('gd.photos')} actions={<button className="btn small" onClick={() => file.current?.click()}>+ {t('gd.photo')}</button>}>
        <input ref={file} type="file" accept="image/*" capture="environment" hidden onChange={async (e) => {
          const f = e.target.files?.[0]; e.target.value = '';
          if (f) { await addVenuePhoto(venue.id, gig.id, f, 'other'); toast(t('gd.photoSaved')); }
        }} />
        {photos.length ? <div className="photo-row">{photos.map((p) => <Photo key={p.id} p={p} />)}</div> : <p className="muted small">{t('gd.noPhotos')}</p>}
      </Section>

      <Section title={t('gd.notes')} actions={<button className="btn small" onClick={() => setNote(true)}>+ {t('gd.note')}</button>}>
        <div className="stack" style={{ gap: 'var(--s2)' }}>
          {live.map((n) => <NoteRow key={n.id} n={n} lang={lang} />)}
          {!live.length && <p className="muted small">{t('gd.noNotes')}</p>}
          {stale.length > 0 && <button className="btn small ghost" onClick={() => setShowStale(!showStale)}>{t('gd.staleNotes', { n: stale.length })}</button>}
          {showStale && stale.map((n) => <NoteRow key={n.id} n={n} lang={lang} />)}
        </div>
      </Section>
      {note && <NoteModal onClose={() => setNote(false)} onSave={async (k, text) => { await addVenueNote(venue.id, gig.id, k, text); setNote(false); }} />}
    </div>
  );
}

function Photo({ p }: { p: VenuePhoto }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => { const u = URL.createObjectURL(p.blob); setUrl(u); return () => URL.revokeObjectURL(u); }, [p.blob]);
  return url ? <a href={url} target="_blank" rel="noreferrer" className="photo-cell"><img src={url} alt={p.caption ?? ''} /></a> : null;
}

function NoteRow({ n, lang }: { n: VenueNote; lang: 'nl' | 'en' }) {
  const { t } = useI18n();
  return (
    <div className={`gd-note ${n.stale ? 'stale' : ''}`}>
      <div className="tiny muted">{t(`gd.noteKind.${n.kind}` as never)} · {fmtDate(n.createdAt.slice(0, 10), lang)}</div>
      <div>{n.text}</div>
      <button className="btn small ghost" onClick={() => void save<VenueNote>('venueNotes', { ...n, stale: !n.stale })}>{n.stale ? t('gd.noteValid') : t('gd.noteStale')}</button>
    </div>
  );
}

function NoteModal({ onClose, onSave }: { onClose: () => void; onSave: (k: VenueNoteKind, text: string) => void }) {
  const { t } = useI18n();
  const [kind, setKind] = useState<VenueNoteKind>('general');
  const [text, setText] = useState('');
  return (
    <Modal title={t('gd.note')} onClose={onClose} footer={<button className="btn primary" disabled={!text.trim()} onClick={() => onSave(kind, text.trim())}>{t('common.save')}</button>}>
      <select value={kind} onChange={(e) => setKind(e.target.value as VenueNoteKind)}>{VENUE_NOTE_KINDS.map((k) => <option key={k} value={k}>{t(`gd.noteKind.${k}` as never)}</option>)}</select>
      <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
    </Modal>
  );
}
