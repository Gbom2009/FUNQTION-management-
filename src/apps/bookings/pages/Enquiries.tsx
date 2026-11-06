import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../../core/db';
import { useI18n } from '../../../core/i18n';
import { useSession } from '../../../core/session';
import { Chips, Empty, Field, Section, useToast } from '../../../core/ui';
import { fmtDate, fmtDateTime } from '../../../core/format';
import { nowIso, save } from '../../../core/repo';
import { CHANNELS, EVENT_TYPES, type Enquiry, type EventType, type Gig, type Person } from '../../../core/types';
import { blankGig, createGig, personLabel, useEnquiries, useGigs, usePersons } from '../data';
import { AvailabilityBanner, GigLine, MessageComposer, Timeline } from '../components/parts';

const STATUSES: Enquiry['status'][] = ['new', 'replied', 'converted', 'declined', 'spam'];

export function EnquiryList() {
  const { t, lang } = useI18n();
  const enquiries = useEnquiries();
  const [status, setStatus] = useState<Enquiry['status'] | 'all'>('new');
  const [q, setQ] = useState('');
  const rows = enquiries
    .filter((e) => status === 'all' || e.status === status)
    .filter((e) => !q || [e.contactName, e.locationText, e.rawMessage, e.contactPhone, e.contactEmail, e.contactInstagram].join(' ').toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  return (
    <div>
      <div className="page-head">
        <h1>{t('enq.title')}</h1>
        <Link className="btn primary" to="/bookings/enquiries/new">+ {t('enq.new')}</Link>
      </div>
      <div className="row" style={{ marginBottom: 'var(--s4)' }}>
        <div className="scroll-x grow">
          <div className="chips">
            {(['all', ...STATUSES] as const).map((s) => (
              <button key={s} className="chip" aria-pressed={status === s} onClick={() => setStatus(s)}>
                {s === 'all' ? t('common.all') : t(`enq.status.${s}`)} <span className="muted">{s === 'all' ? enquiries.length : enquiries.filter((e) => e.status === s).length}</span>
              </button>
            ))}
          </div>
        </div>
        <input className="input" style={{ maxWidth: 260 }} placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('common.search')} />
      </div>
      {rows.length === 0 ? <Empty>{t('enq.empty')}</Empty> : (
        <div className="list">
          {rows.map((e) => (
            <Link key={e.id} to={`/bookings/enquiries/${e.id}`} className="list-item">
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="strong">{e.contactName || '—'} {e.eventType && <span className="muted small">· {t(`event.${e.eventType}`)}</span>}</div>
                <div className="tiny muted">{t(`channel.${e.channel}`)} · {fmtDateTime(e.receivedAt, lang)} · {e.requestedDate ? fmtDate(e.requestedDate, lang) : e.requestedDateText ?? ''} {e.locationText ? `· ${e.locationText}` : ''}</div>
                {e.rawMessage && <div className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.rawMessage}</div>}
              </div>
              <span className="pill" style={{ color: e.status === 'new' ? 'var(--fq-accent)' : 'var(--fq-text-dim)' }}>{t(`enq.status.${e.status}`)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

type Draft = Omit<Enquiry, 'id' | 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'> & { id?: string };

function matchPersons(persons: Person[], d: Draft) {
  const norm = (s?: string) => (s ?? '').replace(/[^\d]/g, '').slice(-9);
  const phone = norm(d.contactPhone);
  const email = d.contactEmail?.trim().toLowerCase();
  const insta = d.contactInstagram?.replace('@', '').trim().toLowerCase();
  const name = d.contactName?.trim().toLowerCase();
  return persons.filter((p) => !p.anonymisedAt && (
    (phone.length >= 8 && (norm(p.phone) === phone || norm(p.whatsapp) === phone)) ||
    (email && p.email?.toLowerCase() === email) ||
    (insta && p.instagram?.replace('@', '').toLowerCase() === insta) ||
    (name && name.length > 3 && `${p.firstName} ${p.lastName}`.toLowerCase().includes(name))
  )).slice(0, 3);
}

export function EnquiryEditor() {
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const nav = useNavigate();
  const toast = useToast();
  const { t } = useI18n();
  const { me } = useSession();
  const persons = usePersons();
  const gigs = useGigs();
  const existing = useLiveQuery(() => (isNew ? undefined : db.enquiries.get(id!)), [id]);
  const linked = useLiveQuery(() => (existing?.personId ? db.persons.get(existing.personId) : undefined), [existing?.personId]);
  const [d, setD] = useState<Draft | null>(isNew ? {
    receivedAt: nowIso(), channel: 'instagram', status: 'new', ownerId: me?.id ?? 'gijs', eventType: '', contactName: '',
  } : null);
  const [dirty, setDirty] = useState(false);
  const [flex, setFlex] = useState(false);
  const [reply, setReply] = useState<false | 'available' | 'unavailable'>(false);
  useEffect(() => { if (existing && !dirty) { setD(existing); setFlex(!existing.requestedDate && !!existing.requestedDateText); } }, [existing, dirty]);
  const matches = useMemo(() => (d && !d.personId ? matchPersons(persons, d) : []), [persons, d]);
  if (!d) return existing === undefined && !isNew ? null : <Empty>{t('contacts.notFound')}</Empty>;
  const set = (p: Partial<Draft>) => { setD({ ...d, ...p }); setDirty(true); };
  const myGigs = gigs.filter((g) => g.enquiryId && g.enquiryId === d.id);

  async function persist(): Promise<Enquiry> {
    let personId = d!.personId;
    if (!personId && d!.contactName?.trim()) {
      const [first, ...rest] = d!.contactName.trim().split(/\s+/);
      const p = await save<Person>('persons', {
        firstName: first, lastName: rest.join(' '), phone: d!.contactPhone, email: d!.contactEmail,
        instagram: d!.contactInstagram, language: 'nl', tags: [],
        source: d!.channel === 'instagram' ? 'instagram' : d!.channel === 'website' ? 'website' : d!.channel === 'referral' ? 'referral' : '',
      });
      personId = p.id;
    }
    const saved = await save<Enquiry>('enquiries', { ...d!, personId, requestedDate: flex ? undefined : d!.requestedDate });
    setDirty(false);
    setD(saved);
    return saved;
  }

  async function toGig(enq?: Enquiry) {
    const e = enq ?? (await persist());
    const person = e.personId ? await db.persons.get(e.personId) : undefined;
    const title = [e.eventType ? t(`event.${e.eventType}`) : '', person ? personLabel(person) : e.contactName].filter(Boolean).join(' ');
    const g = await createGig(blankGig(e.ownerId, {
      title, enquiryId: e.id, clientPersonId: e.personId, date: e.requestedDate ?? '', eventType: (e.eventType || 'other') as EventType,
      expectedCrowd: e.guestCount, notesInternal: e.locationText ? `${t('enq.location')}: ${e.locationText}` : undefined,
      source: person?.source,
    }) as Gig);
    await save<Enquiry>('enquiries', { ...e, status: 'converted' });
    nav(`/bookings/gigs/${g.id}`);
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="legend"><Link to="/bookings/enquiries">← {t('enq.title')}</Link></div>
          <h1>{isNew ? t('enq.new') : d.contactName || t('enq.title')}</h1>
          {!isNew && <div className="sub">{t('enq.receivedAt')} {new Date(d.receivedAt).toLocaleString()} · {t(`enq.status.${d.status}`)}</div>}
        </div>
        {!isNew && (
          <div className="row">
            <button className="btn" onClick={() => setReply('available')}>{t('enq.reply')}</button>
            {d.status === 'new' && <button className="btn" onClick={async () => { await save<Enquiry>('enquiries', { ...(d as Enquiry), status: 'replied', firstResponseAt: nowIso() }); toast(t('common.saved')); }}>{t('enq.markReplied')}</button>}
            {d.status !== 'converted' && <button className="btn primary" onClick={() => toGig()}>{t('enq.toGig')}</button>}
          </div>
        )}
      </div>

      <div className="layout-2">
        <div>
          <Section>
            <div className="stack">
              <Chips label={t('enq.channel')} options={CHANNELS.map((c) => ({ value: c, label: t(`channel.${c}`) }))} value={d.channel} onChange={(v) => set({ channel: v })} />
              <Field label={t('enq.raw')}><textarea rows={5} value={d.rawMessage ?? ''} onChange={(e) => set({ rawMessage: e.target.value })} /></Field>
              <div className="grid2">
                <Field label={t('enq.contactName')}><input value={d.contactName ?? ''} onChange={(e) => set({ contactName: e.target.value })} autoComplete="off" /></Field>
                <Field label={t('common.phone')}><input type="tel" value={d.contactPhone ?? ''} onChange={(e) => set({ contactPhone: e.target.value })} /></Field>
                <Field label={t('common.email')}><input type="email" value={d.contactEmail ?? ''} onChange={(e) => set({ contactEmail: e.target.value })} /></Field>
                <Field label={t('common.instagram')}><input value={d.contactInstagram ?? ''} placeholder="@" onChange={(e) => set({ contactInstagram: e.target.value })} /></Field>
              </div>
              {linked ? (
                <div className="banner info"><span>↔</span><div className="txt">{t('enq.linked')} <Link to={`/bookings/contacts/person/${linked.id}`}>{personLabel(linked)}</Link>{' '}
                  <button className="btn small ghost" onClick={() => set({ personId: undefined })}>{t('enq.unlink')}</button></div></div>
              ) : d.personId ? null : matches.length > 0 && (
                <div className="banner warn"><span>?</span><div className="txt">
                  <div className="strong">{t('enq.existing')}</div>
                  {matches.map((p) => (
                    <div key={p.id} className="row" style={{ marginTop: 4 }}>
                      <span>{personLabel(p)} <span className="muted small">{[p.phone, p.email].filter(Boolean).join(' · ')}</span></span>
                      <button className="btn small" onClick={() => set({ personId: p.id, contactName: personLabel(p) })}>{t('enq.linkExisting')}</button>
                    </div>
                  ))}
                </div></div>
              )}
              <div className="grid2">
                <div className="stack" style={{ gap: 4 }}>
                  {!flex
                    ? <Field label={t('enq.requestedDate')}><input type="date" value={d.requestedDate ?? ''} onChange={(e) => set({ requestedDate: e.target.value })} /></Field>
                    : <Field label={t('enq.dateText')}><input value={d.requestedDateText ?? ''} onChange={(e) => set({ requestedDateText: e.target.value })} /></Field>}
                  <label className="check small"><input type="checkbox" checked={flex} onChange={(e) => { setFlex(e.target.checked); setDirty(true); }} /> {t('enq.flexible')}</label>
                </div>
                <Field label={t('enq.location')}><input value={d.locationText ?? ''} onChange={(e) => set({ locationText: e.target.value })} /></Field>
              </div>
              {!flex && <AvailabilityBanner date={d.requestedDate} />}
              <Chips label={t('gig.eventType')} options={EVENT_TYPES.map((e) => ({ value: e, label: t(`event.${e}`) }))} value={d.eventType ?? ''} onChange={(v) => set({ eventType: v })} />
              <div className="grid2">
                <Field label={t('enq.guests')}><input inputMode="numeric" value={d.guestCount ?? ''} onChange={(e) => set({ guestCount: e.target.value ? Number(e.target.value) : undefined })} /></Field>
                <Field label={t('common.owner')}>
                  <select value={d.ownerId} onChange={(e) => set({ ownerId: e.target.value as Enquiry['ownerId'] })}>
                    <option value="gijs">Gijs</option><option value="coen">Coen</option>
                  </select>
                </Field>
              </div>
              {!isNew && (
                <Field label={t('common.status')}>
                  <select value={d.status} onChange={(e) => set({ status: e.target.value as Enquiry['status'] })}>
                    {STATUSES.map((s) => <option key={s} value={s}>{t(`enq.status.${s}`)}</option>)}
                  </select>
                </Field>
              )}
              <Field label={t('common.notes')}><textarea value={d.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} /></Field>
            </div>
          </Section>
          {(isNew || dirty) && (
            <div className="savebar">
              <span className="small muted">{t('common.unsaved')}</span>
              <div className="row">
                <button className="btn" onClick={async () => { const e = await persist(); toast(t('common.saved')); if (isNew) nav(`/bookings/enquiries/${e.id}`, { replace: true }); }}>{t('common.save')}</button>
                <button className="btn primary" onClick={() => toGig()}>{t('enq.saveAndGig')}</button>
              </div>
            </div>
          )}
        </div>
        {!isNew && d.id && (
          <div>
            {myGigs.length > 0 && <Section title={t('enq.gigs')}><div className="list">{myGigs.map((g) => <GigLine key={g.id} gig={g} />)}</div></Section>}
            <Section title={t('gig.timeline')}><Timeline enquiryId={d.id} personId={d.personId} /></Section>
          </div>
        )}
      </div>
      {reply && <MessageComposer kind={reply === 'available' ? 'enquiry_available' : 'enquiry_unavailable'} enquiry={d as Enquiry} person={linked ?? undefined} onClose={() => setReply(false)} />}
    </div>
  );
}
