import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../../core/db';
import { useI18n } from '../../../core/i18n';
import { useSession } from '../../../core/session';
import { Check, Chips, Empty, Field, MemberChips, Section, StagePill, useToast } from '../../../core/ui';
import { centsFromInput, euro, fmtDate, fmtDateLong, inputFromCents } from '../../../core/format';
import { addDays, addMonths, parseDate, toDateStr } from '../../../core/dates';
import { nowIso, save, softDelete, uid } from '../../../core/repo';
import {
  EVENT_TYPES, WISH_KINDS, type Gig, type GigContact, type MemberId, type MusicWish, type Product, type Quote, type QuoteLine,
  type Review, type SetSlot,
} from '../../../core/types';
import { blankGig, byId, changeStage, createGig, mapsLink, personLabel, useGigs, useOrgs, usePersons, useQuotes, useTasks, useVenues } from '../data';
import { ConflictList, History, MessageComposer, NewTaskButton, StageDialog, TaskRow, Timeline, useConflicts } from '../components/parts';
import { QuickCreate } from '../components/forms';
import { nextStage, quoteTotals } from '../domain/pipeline';

type Draft = ReturnType<typeof blankGig>;
const TABS = ['overview', 'venue', 'client', 'music', 'money', 'timeline', 'tasks', 'history'] as const;
type Tab = (typeof TABS)[number];

export default function GigPage() {
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const [params] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const { t, lang } = useI18n();
  const { me } = useSession();
  const stored = useLiveQuery(() => (isNew ? undefined : db.gigs.get(id!)), [id]);
  const [d, setD] = useState<Draft | null>(isNew ? blankGig(me?.id ?? 'gijs', { date: params.get('date') ?? '' }) : null);
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');
  const [stageOpen, setStageOpen] = useState<false | Gig['stage'] | true>(false);
  const [msg, setMsg] = useState(false);

  useEffect(() => { if (stored && !dirty) setD(stored); }, [stored, dirty]);
  const conflicts = useConflicts((d ?? blankGig('gijs')) as Gig);

  if (!d) return stored === undefined && !isNew ? null : <Empty>{t('gig.notFound')}</Empty>;
  const set = (p: Partial<Draft>) => { setD({ ...d, ...p }); setDirty(true); };
  const gig = d as Gig;

  async function persist() {
    if (isNew) {
      const g = await createGig(d!);
      setDirty(false);
      toast(t('common.saved'));
      nav(`/bookings/gigs/${g.id}`, { replace: true });
    } else {
      const saved = await save<Gig>('gigs', d as Gig);
      setD(saved);
      setDirty(false);
      toast(t('common.saved'));
    }
  }

  async function duplicateNextYear() {
    const next = toDateStr(addMonths(parseDate(gig.date), 12));
    const { id: _i, reference: _r, ...rest } = gig;
    const g = await createGig({ ...rest, reference: '', date: next, stage: 'enquiry', stageChangedAt: nowIso(), musicWishes: [],
      quoteSentAt: undefined, playedAt: undefined, invoicedAt: undefined, paidAt: undefined, lostReason: undefined, lostNote: undefined,
      cancelledBy: undefined, cancellationFee: undefined, depositPaidAt: undefined, conflictOverride: undefined });
    nav(`/bookings/gigs/${g.id}`);
  }

  const next = !isNew ? nextStage(gig.stage) : null;
  const hard = conflicts.filter((c) => c.level === 'hard');

  return (
    <div>
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <div className="legend"><Link to="/bookings/pipeline">← {t('pipe.title')}</Link> {gig.reference && <>· {gig.reference}</>}</div>
          <h1 style={{ overflowWrap: 'anywhere' }}>{gig.title || t('gig.new')}</h1>
          <div className="sub row">
            {!isNew && <StagePill stage={gig.stage} />}
            <span>{gig.date ? fmtDateLong(gig.date, lang) : '—'} · {gig.startTime}–{gig.endTime}</span>
            <MemberChips ids={gig.performers} />
          </div>
        </div>
        {!isNew && (
          <div className="row">
            <button className="btn" onClick={() => setMsg(true)}>{t('msg.send')}</button>
            <button className="btn" onClick={() => setStageOpen(true)}>{t('stage.change')}</button>
            {next && <button className="btn primary" onClick={() => setStageOpen(next)} disabled={dirty}>{t('stage.next')}: {t(`stage.${next}`)}</button>}
          </div>
        )}
      </div>

      {gig.stage === 'lost' && gig.lostReason && <div className="banner danger" style={{ marginBottom: 'var(--s4)' }}><span>✕</span><div className="txt">{t('stage.lost')}: {t(`lost.${gig.lostReason}`)} {gig.lostNote && `– ${gig.lostNote}`}</div></div>}
      {gig.stage === 'cancelled' && <div className="banner danger" style={{ marginBottom: 'var(--s4)' }}><span>✕</span><div className="txt">{t('stage.cancelled')} ({t(`stage.cancelledBy.${gig.cancelledBy ?? 'client'}`)}) {gig.lostReason && `· ${t(`lost.${gig.lostReason}`)}`} {gig.cancellationFee ? `· ${euro(gig.cancellationFee, lang)}` : ''}</div></div>}
      {gig.conflictOverride && <div className="banner warn" style={{ marginBottom: 'var(--s4)' }}><span>!</span><div className="txt">{t('stage.override')}: {gig.conflictOverride}</div></div>}
      {conflicts.length > 0 && <div style={{ marginBottom: 'var(--s4)' }}><ConflictList conflicts={conflicts} /></div>}

      {!isNew && (
        <div className="tabs" role="tablist">
          {TABS.map((x) => (
            <button key={x} role="tab" aria-selected={tab === x} onClick={() => setTab(x)}>
              {t(x === 'overview' ? 'gig.overview' : x === 'venue' ? 'gig.venue' : x === 'client' ? 'gig.client' : x === 'music' ? 'gig.music'
                : x === 'money' ? 'gig.money' : x === 'timeline' ? 'gig.timeline' : x === 'tasks' ? 'gig.tasks' : 'gig.history')}
              {x === 'overview' && hard.length > 0 && <span style={{ color: 'var(--danger)' }}> ●</span>}
            </button>
          ))}
        </div>
      )}

      {(isNew || tab === 'overview') && <OverviewTab d={d} set={set} />}
      {isNew && <VenueTab d={d} set={set} />}
      {isNew && <ClientTab d={d} set={set} />}
      {!isNew && tab === 'venue' && <VenueTab d={d} set={set} />}
      {!isNew && tab === 'client' && <ClientTab d={d} set={set} />}
      {!isNew && tab === 'music' && <MusicTab d={d} set={set} />}
      {!isNew && tab === 'money' && <MoneyTab d={d} set={set} gig={stored as Gig} dirty={dirty} />}
      {!isNew && tab === 'timeline' && <Section title={t('gig.timeline')}><Timeline gigId={gig.id} personId={gig.clientPersonId} /></Section>}
      {!isNew && tab === 'tasks' && <GigTasks gig={gig} />}
      {!isNew && tab === 'history' && <Section title={t('gig.history')}><HistoryForGig gigId={gig.id} /></Section>}

      {!isNew && tab === 'overview' && (
        <div className="row" style={{ marginTop: 'var(--s4)' }}>
          {gig.date && <button className="btn small" onClick={duplicateNextYear}>{t('gig.duplicate')}</button>}
          <button className="btn small danger" onClick={async () => { if (confirm(t('common.confirmDelete'))) { await softDelete('gigs', gig.id); nav('/bookings/pipeline'); } }}>{t('common.delete')}</button>
        </div>
      )}

      {(isNew || dirty) && (
        <div className="savebar">
          <span className="small muted">{t('common.unsaved')}</span>
          <div className="row">
            {!isNew && <button className="btn ghost" onClick={() => { setDirty(false); if (stored) setD(stored); }}>{t('common.cancel')}</button>}
            <button className="btn primary" onClick={persist}>{t('common.save')}</button>
          </div>
        </div>
      )}
      {stageOpen && stored && <StageDialog gig={stored} to={stageOpen === true ? undefined : stageOpen} onClose={() => setStageOpen(false)} />}
      {msg && stored && <GigMessage gig={stored} onClose={() => setMsg(false)} />}
    </div>
  );
}

function GigMessage({ gig, onClose }: { gig: Gig; onClose: () => void }) {
  const person = useLiveQuery(() => (gig.clientPersonId ? db.persons.get(gig.clientPersonId) : undefined), [gig.clientPersonId]);
  const kind = gig.stage === 'quote_sent' ? 'quote_follow_up' : gig.stage === 'confirmed' ? 'final_check' : ['played', 'invoiced', 'paid'].includes(gig.stage) ? 'thank_you_review' : 'enquiry_available';
  return <MessageComposer kind={kind} gig={gig} person={person ?? undefined} onClose={onClose} />;
}

function HistoryForGig({ gigId }: { gigId: string }) {
  const quotes = useQuotes(gigId);
  return <History rowIds={[gigId, ...quotes.map((q) => q.id)]} />;
}

type TabProps = { d: Draft; set: (p: Partial<Draft>) => void };

function OverviewTab({ d, set }: TabProps) {
  const { t } = useI18n();
  const togglePerformer = (m: MemberId) => set({ performers: d.performers.includes(m) ? d.performers.filter((x) => x !== m) : [...d.performers, m] });
  const setSlot = (i: number, p: Partial<SetSlot>) => set({ setSlots: d.setSlots.map((s, j) => (j === i ? { ...s, ...p } : s)) });
  return (
    <Section title={t('gig.overview')}>
      <div className="stack">
        <Field label={t('gig.title')}><input value={d.title} placeholder={t('gig.titlePlaceholder')} onChange={(e) => set({ title: e.target.value })} /></Field>
        <Chips label={t('gig.eventType')} options={EVENT_TYPES.map((e) => ({ value: e, label: t(`event.${e}`) }))} value={d.eventType} onChange={(v) => set({ eventType: v })} />
        <div className="grid4">
          <Field label={t('gig.date')}><input type="date" value={d.date} onChange={(e) => set({ date: e.target.value })} /></Field>
          <Field label={t('gig.setupTime')}><input type="time" value={d.setupTime ?? ''} onChange={(e) => set({ setupTime: e.target.value || undefined })} /></Field>
          <Field label={t('gig.start')}><input type="time" value={d.startTime} onChange={(e) => set({ startTime: e.target.value })} /></Field>
          <Field label={t('gig.end')}><input type="time" value={d.endTime} onChange={(e) => set({ endTime: e.target.value })} /></Field>
        </div>
        <Check label={t('gig.setupRequired')} checked={d.setupRequired} onChange={(v) => set({ setupRequired: v })} />
        <div className="field">
          <span>{t('gig.performers')}</span>
          <div className="chips">
            {(['gijs', 'coen'] as MemberId[]).map((m) => <button key={m} type="button" className="chip" aria-pressed={d.performers.includes(m)} onClick={() => togglePerformer(m)}>{m === 'gijs' ? 'Gijs' : 'Coen'}</button>)}
          </div>
        </div>
        <div className="grid3">
          <Field label={t('gig.crowd')}><input inputMode="numeric" value={d.expectedCrowd ?? ''} onChange={(e) => set({ expectedCrowd: e.target.value ? Number(e.target.value) : undefined })} /></Field>
          <Field label={t('gig.age')}><input value={d.ageProfile ?? ''} onChange={(e) => set({ ageProfile: e.target.value })} /></Field>
          <Field label={t('gig.setting')}>
            <select value={d.setting ?? ''} onChange={(e) => set({ setting: e.target.value as Gig['setting'] })}>
              <option value="">—</option><option value="indoor">{t('gig.setting.indoor')}</option><option value="outdoor">{t('gig.setting.outdoor')}</option><option value="both">{t('gig.setting.both')}</option>
            </select>
          </Field>
          <Field label={t('gig.owner')}>
            <select value={d.ownerId} onChange={(e) => set({ ownerId: e.target.value as MemberId })}><option value="gijs">Gijs</option><option value="coen">Coen</option></select>
          </Field>
          {(d.stage === 'option' || d.optionExpiresAt) && <Field label={t('gig.optionExpires')}><input type="date" value={d.optionExpiresAt ?? ''} onChange={(e) => set({ optionExpiresAt: e.target.value })} /></Field>}
          <Field label={t('gig.series')} hint={t('gig.seriesHint')}><input value={d.seriesName ?? ''} onChange={(e) => set({ seriesName: e.target.value })} /></Field>
        </div>

        <div className="field">
          <span>{t('gig.sets')}</span>
          {d.setSlots.map((s, i) => (
            <div key={s.id} className="row" style={{ alignItems: 'flex-end' }}>
              <input className="input" type="time" style={{ width: 120 }} value={s.start} onChange={(e) => setSlot(i, { start: e.target.value })} aria-label={t('gig.start')} />
              <input className="input" type="time" style={{ width: 120 }} value={s.end} onChange={(e) => setSlot(i, { end: e.target.value })} aria-label={t('gig.end')} />
              <input className="input grow" style={{ flex: 1, minWidth: 140 }} value={s.label ?? ''} placeholder={t('gig.setLabel')} onChange={(e) => setSlot(i, { label: e.target.value })} />
              <div className="chips">
                {(['gijs', 'coen'] as MemberId[]).map((m) => <button key={m} type="button" className="chip" aria-pressed={s.performers.includes(m)}
                  onClick={() => setSlot(i, { performers: s.performers.includes(m) ? s.performers.filter((x) => x !== m) : [...s.performers, m] })}>{m === 'gijs' ? 'G' : 'C'}</button>)}
              </div>
              <button className="btn icon small" aria-label={t('common.delete')} onClick={() => set({ setSlots: d.setSlots.filter((_, j) => j !== i) })}>✕</button>
            </div>
          ))}
          <div><button className="btn small" onClick={() => set({ setSlots: [...d.setSlots, { id: uid(), start: d.startTime, end: d.endTime, performers: [...d.performers] }] })}>+ {t('gig.addSet')}</button></div>
        </div>

        <div className="grid2">
          <Field label={t('gig.notesInternal')}><textarea value={d.notesInternal ?? ''} onChange={(e) => set({ notesInternal: e.target.value })} /></Field>
          <Field label={t('gig.notesClient')}><textarea value={d.notesClient ?? ''} onChange={(e) => set({ notesClient: e.target.value })} /></Field>
        </div>
      </div>
    </Section>
  );
}

function VenueTab({ d, set }: TabProps) {
  const { t } = useI18n();
  const venues = useVenues();
  const [create, setCreate] = useState(false);
  const v = venues.find((x) => x.id === d.venueId);
  return (
    <Section title={t('gig.venue')} actions={<button className="btn small" onClick={() => setCreate(true)}>+ {t('gig.newVenue')}</button>}>
      <div className="stack">
        <Field label={t('gig.chooseVenue')}>
          <select value={d.venueId ?? ''} onChange={(e) => set({ venueId: e.target.value || undefined })}>
            <option value="">—</option>
            {venues.sort((a, b) => a.name.localeCompare(b.name)).map((x) => <option key={x.id} value={x.id}>{[x.name, x.city].filter(Boolean).join(', ')}</option>)}
          </select>
        </Field>
        {v && (
          <div className="card">
            <div className="row between">
              <div className="strong">{v.name}</div>
              <div className="row"><a className="btn small" href={mapsLink(v)} target="_blank" rel="noreferrer">{t('gig.navigate')}</a><Link className="btn small ghost" to={`/bookings/contacts/venue/${v.id}`}>{t('common.edit')}</Link></div>
            </div>
            <dl className="kv" style={{ marginTop: 'var(--s2)' }}>
              <dt>{t('venue.street')}</dt><dd>{[v.street, v.postcode, v.city].filter(Boolean).join(', ') || '—'}</dd>
              <dt>{t('venue.loadIn')}</dt><dd>{v.loadInNotes || '—'}</dd>
              <dt>{t('venue.parking')}</dt><dd>{v.parkingNotes || '—'}</dd>
              <dt>{t('venue.power')}</dt><dd>{v.powerNotes || '—'}</dd>
              <dt>{t('venue.houseSound')}</dt><dd>{v.houseSound ? t('common.yes') : t('common.no')}</dd>
              {v.curfew && <><dt>{t('venue.curfew')}</dt><dd>{v.curfew}</dd></>}
              {v.soundLimitDb && <><dt>{t('venue.dbLimit')}</dt><dd>{v.soundLimitDb} dB</dd></>}
            </dl>
          </div>
        )}
      </div>
      {create && <QuickCreate kind="venue" onClose={() => setCreate(false)} onCreated={(id) => set({ venueId: id })} />}
    </Section>
  );
}

function ClientTab({ d, set }: TabProps) {
  const { t, lang } = useI18n();
  const persons = usePersons();
  const orgs = useOrgs();
  const gigs = useGigs();
  const pmap = byId(persons);
  const [create, setCreate] = useState<false | 'person' | 'org' | 'contact'>(false);
  const client = d.clientPersonId ? pmap.get(d.clientPersonId) : undefined;
  const previous = gigs.filter((g) => g.id !== d.id && ((d.clientPersonId && g.clientPersonId === d.clientPersonId) || (d.clientOrganisationId && g.clientOrganisationId === d.clientOrganisationId)));
  const sortedPersons = useMemo(() => [...persons].filter((p) => !p.anonymisedAt).sort((a, b) => personLabel(a).localeCompare(personLabel(b))), [persons]);
  const setContact = (i: number, p: Partial<GigContact>) => set({ contacts: d.contacts.map((c, j) => (j === i ? { ...c, ...p } : c)) });
  return (
    <Section title={t('gig.client')}>
      <div className="stack">
        <div className="grid2">
          <div className="stack" style={{ gap: 4 }}>
            <Field label={t('gig.chooseClient')}>
              <select value={d.clientPersonId ?? ''} onChange={(e) => {
                const p = pmap.get(e.target.value);
                set({ clientPersonId: e.target.value || undefined, clientOrganisationId: d.clientOrganisationId ?? p?.organisationId, source: d.source || p?.source });
              }}>
                <option value="">—</option>
                {sortedPersons.map((p) => <option key={p.id} value={p.id}>{personLabel(p)}</option>)}
              </select>
            </Field>
            <div><button className="btn small" onClick={() => setCreate('person')}>+ {t('contacts.newPerson')}</button></div>
          </div>
          <div className="stack" style={{ gap: 4 }}>
            <Field label={t('gig.chooseOrg')}>
              <select value={d.clientOrganisationId ?? ''} onChange={(e) => set({ clientOrganisationId: e.target.value || undefined })}>
                <option value="">—</option>
                {orgs.sort((a, b) => a.name.localeCompare(b.name)).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </Field>
            <div><button className="btn small" onClick={() => setCreate('org')}>+ {t('contacts.newOrg')}</button></div>
          </div>
        </div>
        {client && (
          <div className="card">
            <div className="row between"><Link className="strong" to={`/bookings/contacts/person/${client.id}`}>{personLabel(client)}</Link>
              <div className="row">{client.phone && <a className="btn small" href={`tel:${client.phone}`}>{t('common.phone')}</a>}{client.email && <a className="btn small" href={`mailto:${client.email}`}>{t('common.email')}</a>}</div></div>
            <div className="small muted">{[client.phone, client.email, client.instagram].filter(Boolean).join(' · ')}</div>
            {client.source && <div className="tiny muted">{t('source.label')} {t(`source.${client.source}`)} {client.sourceDetail ? `– ${client.sourceDetail}` : ''}</div>}
          </div>
        )}

        <div className="field">
          <span>{t('gig.contacts')}</span>
          {d.contacts.map((c, i) => (
            <div key={i} className="row">
              <select className="input grow" style={{ flex: 1, minWidth: 160 }} value={c.personId} onChange={(e) => setContact(i, { personId: e.target.value })} aria-label={t('common.name')}>
                {sortedPersons.map((p) => <option key={p.id} value={p.id}>{personLabel(p)}</option>)}
              </select>
              <select className="input" style={{ width: 'auto' }} value={c.role} onChange={(e) => setContact(i, { role: e.target.value as GigContact['role'] })} aria-label={t('contacts.role')}>
                {(['booker', 'day_contact', 'venue_manager', 'technician', 'planner', 'other'] as const).map((r) => <option key={r} value={r}>{t(`contactRole.${r}`)}</option>)}
              </select>
              {pmap.get(c.personId)?.phone && <a className="btn small" href={`tel:${pmap.get(c.personId)!.phone}`}>{t('common.phone')}</a>}
              <button className="btn icon small" aria-label={t('common.delete')} onClick={() => set({ contacts: d.contacts.filter((_, j) => j !== i) })}>✕</button>
            </div>
          ))}
          <div className="row">
            <button className="btn small" disabled={!sortedPersons.length} onClick={() => set({ contacts: [...d.contacts, { personId: sortedPersons[0]?.id, role: 'day_contact' }] })}>+ {t('gig.addContact')}</button>
            <button className="btn small ghost" onClick={() => setCreate('contact')}>+ {t('contacts.newPerson')}</button>
          </div>
        </div>

        {previous.length > 0 && (
          <div className="field"><span>{t('gig.previous')}</span>
            <div className="list">{previous.map((g) => <Link key={g.id} to={`/bookings/gigs/${g.id}`} className="list-item"><span className="small">{fmtDate(g.date, lang)}</span><span className="grow">{g.title}</span><StagePill stage={g.stage} /></Link>)}</div>
          </div>
        )}
      </div>
      {create === 'person' && <QuickCreate kind="person" onClose={() => setCreate(false)} onCreated={(id) => set({ clientPersonId: id })} />}
      {create === 'org' && <QuickCreate kind="org" onClose={() => setCreate(false)} onCreated={(id) => set({ clientOrganisationId: id })} />}
      {create === 'contact' && <QuickCreate kind="person" onClose={() => setCreate(false)} onCreated={(id) => set({ contacts: [...d.contacts, { personId: id, role: 'day_contact' }] })} />}
    </Section>
  );
}

function MusicTab({ d, set }: TabProps) {
  const { t } = useI18n();
  const setWish = (i: number, p: Partial<MusicWish>) => set({ musicWishes: d.musicWishes.map((w, j) => (j === i ? { ...w, ...p } : w)) });
  return (
    <Section title={t('gig.music')}>
      <div className="stack">
        {WISH_KINDS.map((k) => {
          const list = d.musicWishes.map((w, i) => ({ w, i })).filter((x) => x.w.kind === k);
          return (
            <div key={k} className="field">
              <span style={{ color: k === 'do_not_play' ? 'var(--danger)' : k === 'must_play' ? 'var(--ok)' : undefined }}>{t(`wish.${k}`)}</span>
              {list.map(({ w, i }) => (
                <div key={w.id} className="row">
                  <input className="input grow" style={{ flex: 2, minWidth: 160 }} value={w.text} placeholder={t('wish.text')} onChange={(e) => setWish(i, { text: e.target.value })} />
                  <input className="input grow" style={{ flex: 1, minWidth: 120 }} value={w.url ?? ''} placeholder={t('wish.url')} onChange={(e) => setWish(i, { url: e.target.value })} />
                  {w.url && <a className="btn small" href={w.url} target="_blank" rel="noreferrer">↗</a>}
                  <button className="btn icon small" aria-label={t('common.delete')} onClick={() => set({ musicWishes: d.musicWishes.filter((_, j) => j !== i) })}>✕</button>
                </div>
              ))}
              <div><button className="btn small ghost" onClick={() => set({ musicWishes: [...d.musicWishes, { id: uid(), kind: k, text: '' }] })}>+ {t('gig.addWish')}</button></div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function MoneyTab({ d, set, gig, dirty }: TabProps & { gig: Gig; dirty: boolean }) {
  const { t, lang } = useI18n();
  return (
    <>
      <Section title={t('gig.money')}>
        <div className="grid4">
          <Field label={t('gig.fee')}><input inputMode="decimal" value={inputFromCents(d.agreedFee)} onChange={(e) => set({ agreedFee: centsFromInput(e.target.value) })} /></Field>
          <Field label={t('gig.travelFee')}><input inputMode="decimal" value={inputFromCents(d.travelFee)} onChange={(e) => set({ travelFee: centsFromInput(e.target.value) })} /></Field>
          <Field label={t('gig.deposit')}><input inputMode="decimal" value={inputFromCents(d.deposit)} onChange={(e) => set({ deposit: centsFromInput(e.target.value) })} /></Field>
          <Field label={t('gig.depositPaid')}><input type="date" value={d.depositPaidAt ?? ''} onChange={(e) => set({ depositPaidAt: e.target.value || undefined })} /></Field>
        </div>
        <p className="small muted" style={{ marginTop: 'var(--s3)' }}>{t('quote.total')}: <span className="strong">{euro((d.agreedFee ?? 0) + (d.travelFee ?? 0), lang)}</span></p>
      </Section>
      <QuoteEditor gig={gig} disabled={dirty} />
      <ReviewBox gig={gig} />
    </>
  );
}

function QuoteEditor({ gig, disabled }: { gig: Gig; disabled: boolean }) {
  const { t, lang } = useI18n();
  const { settings } = useSession();
  const toast = useToast();
  const quotes = useQuotes(gig.id).sort((a, b) => b.version - a.version);
  const products = ((useLiveQuery(() => db.products.toArray(), []) ?? []) as Product[]).filter((p) => !p.deletedAt && p.active);
  const latest = quotes[0];
  const [lines, setLines] = useState<QuoteLine[] | null>(null);
  const [validUntil, setValidUntil] = useState<string | null>(null);
  const cur = lines ?? latest?.lines ?? [];
  const valid = validUntil ?? latest?.validUntil ?? '';
  const editable = !latest || latest.status === 'draft';
  const totals = quoteTotals(cur);
  const setLine = (i: number, p: Partial<QuoteLine>) => setLines(cur.map((l, j) => (j === i ? { ...l, ...p } : l)));

  async function persist(status?: Quote['status']) {
    const base: Partial<Quote> = latest && latest.status === 'draft' ? latest : {};
    const q = await save<Quote>('quotes', {
      ...base, gigId: gig.id, version: latest?.status === 'draft' ? latest.version : (latest?.version ?? 0) + 1, status: status ?? 'draft',
      lines: cur, validUntil: valid || toDateStr(addDays(new Date(), settings.quoteValidDays)),
      ...(status === 'sent' ? { sentAt: nowIso() } : {}),
    } as Quote);
    setLines(null); setValidUntil(null);
    return q;
  }
  async function newVersion() {
    if (latest) await save<Quote>('quotes', { ...latest, status: 'superseded' });
    await save<Quote>('quotes', { gigId: gig.id, version: (latest?.version ?? 0) + 1, status: 'draft', lines: latest?.lines.map((l) => ({ ...l, id: uid() })) ?? [],
      validUntil: toDateStr(addDays(new Date(), settings.quoteValidDays)) } as Quote);
  }
  async function markSent() {
    await persist('sent');
    if (['enquiry', 'option'].includes(gig.stage)) await changeStage(gig, { to: 'quote_sent' });
    toast(t('quote.sentOn', { date: fmtDate(toDateStr(new Date()), lang) }));
  }
  async function useAsFee() {
    await save<Gig>('gigs', { ...gig, agreedFee: totals.total });
    toast(t('common.saved'));
  }
  return (
    <Section title={`${t('quote.title')}${latest ? ` · ${t('quote.version', { v: latest.version })} · ${t(`quote.status.${latest.status}`)}` : ''}`}
      actions={latest && !editable ? <button className="btn small" onClick={newVersion}>{t('quote.newVersion')}</button> : undefined}>
      <div className="stack">
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>{t('quote.line')}</th><th>{t('quote.qty')}</th><th>{t('quote.unit')}</th><th>{t('quote.price')}</th><th>{t('quote.vat')}</th><th style={{ textAlign: 'right' }}>{t('quote.total')}</th>{editable && <th />}</tr></thead>
            <tbody>
              {cur.map((l, i) => (
                <tr key={l.id}>
                  <td>{editable ? <input className="input" value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} aria-label={t('quote.line')} /> : l.description}</td>
                  <td style={{ width: 80 }}>{editable ? <input className="input" inputMode="decimal" value={String(l.quantity)} onChange={(e) => setLine(i, { quantity: Number(e.target.value.replace(',', '.')) || 0 })} aria-label={t('quote.qty')} /> : l.quantity}</td>
                  <td style={{ width: 90 }}>{editable ? (
                    <select className="input" value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value as QuoteLine['unit'] })} aria-label={t('quote.unit')}>
                      {(['hour', 'piece', 'km', 'flat'] as const).map((u) => <option key={u} value={u}>{t(`unit.${u}`)}</option>)}
                    </select>) : t(`unit.${l.unit}`)}</td>
                  <td style={{ width: 110 }}>{editable ? <input className="input" inputMode="decimal" value={inputFromCents(l.unitPrice)} onChange={(e) => setLine(i, { unitPrice: centsFromInput(e.target.value) ?? 0 })} aria-label={t('quote.price')} /> : euro(l.unitPrice, lang)}</td>
                  <td style={{ width: 70 }}>{editable ? <input className="input" inputMode="numeric" value={String(l.vatRate)} onChange={(e) => setLine(i, { vatRate: Number(e.target.value) || 0 })} aria-label={t('quote.vat')} /> : `${l.vatRate}%`}</td>
                  <td style={{ textAlign: 'right' }}>{euro(Math.round(l.quantity * l.unitPrice), lang)}</td>
                  {editable && <td><button className="btn icon small" aria-label={t('common.delete')} onClick={() => setLines(cur.filter((_, j) => j !== i))}>✕</button></td>}
                </tr>
              ))}
              <tr><td colSpan={5} className="muted">{t('quote.subtotal')}</td><td style={{ textAlign: 'right' }}>{euro(totals.ex, lang)}</td>{editable && <td />}</tr>
              <tr><td colSpan={5} className="muted">{totals.vat === 0 ? t('quote.noVat') : t('quote.vatTotal')}</td><td style={{ textAlign: 'right' }}>{euro(totals.vat, lang)}</td>{editable && <td />}</tr>
              <tr><td colSpan={5} className="strong">{t('quote.total')}</td><td style={{ textAlign: 'right' }} className="strong">{euro(totals.total, lang)}</td>{editable && <td />}</tr>
            </tbody>
          </table>
        </div>
        {editable && (
          <div className="row">
            <button className="btn small" onClick={() => setLines([...cur, { id: uid(), description: '', quantity: 1, unit: 'flat', unitPrice: 0, vatRate: settings.defaultVatRate }])}>+ {t('quote.addLine')}</button>
            <select className="input" style={{ width: 'auto' }} value="" aria-label={t('quote.fromProduct')} onChange={(e) => {
              const p = products.find((x) => x.id === e.target.value);
              if (p) setLines([...cur, { id: uid(), description: p.name, quantity: 1, unit: p.unit, unitPrice: p.price, vatRate: p.vatRate }]);
            }}>
              <option value="">+ {t('quote.fromProduct')}</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name} · {euro(p.price, lang)}/{t(`unit.${p.unit}`)}</option>)}
            </select>
          </div>
        )}
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <Field label={t('quote.validUntil')}><input type="date" disabled={!editable} value={valid} onChange={(e) => setValidUntil(e.target.value)} /></Field>
          {latest?.sentAt && <span className="small muted">{t('quote.sentOn', { date: fmtDate(latest.sentAt.slice(0, 10), lang) })}</span>}
        </div>
        <div className="row">
          {editable && <button className="btn" disabled={!cur.length} onClick={async () => { await persist(); toast(t('common.saved')); }}>{t('common.save')}</button>}
          {editable && <button className="btn primary" disabled={!cur.length || disabled} onClick={markSent}>{t('quote.markSent')}</button>}
          {cur.length > 0 && totals.total !== gig.agreedFee && <button className="btn ghost" disabled={disabled} onClick={useAsFee}>{t('quote.useAsFee')}</button>}
        </div>
      </div>
    </Section>
  );
}

function ReviewBox({ gig }: { gig: Gig }) {
  const { t } = useI18n();
  const review = useLiveQuery(() => db.reviews.where('gigId').equals(gig.id).first(), [gig.id]);
  if (!['played', 'invoiced', 'paid'].includes(gig.stage)) return null;
  const r: Partial<Review> = review ?? { gigId: gig.id };
  const upd = (p: Partial<Review>) => save<Review>('reviews', { ...r, ...p, gigId: gig.id } as Review);
  return (
    <Section title={t('gig.review')}>
      <div className="stack">
        <div className="grid3">
          <Field label={t('review.requested')}><input type="date" value={r.requestedAt?.slice(0, 10) ?? ''} onChange={(e) => upd({ requestedAt: e.target.value || undefined })} /></Field>
          <Field label={t('review.platform')}>
            <select value={r.platform ?? ''} onChange={(e) => upd({ platform: (e.target.value || undefined) as Review['platform'] })}>
              <option value="">—</option>{(['google', 'instagram', 'facebook', 'website', 'other'] as const).map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
          <Field label={t('review.rating')}>
            <select value={r.rating ?? ''} onChange={(e) => upd({ rating: e.target.value ? Number(e.target.value) : undefined, receivedAt: r.receivedAt ?? nowIso() })}>
              <option value="">—</option>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{'★'.repeat(n)}</option>)}
            </select>
          </Field>
        </div>
        <Field label={t('review.text')}><textarea key={review?.id ?? 'new'} defaultValue={r.text ?? ''} onBlur={(e) => e.target.value !== (r.text ?? '') && upd({ text: e.target.value })} /></Field>
        <Check label={t('review.mayPublish')} checked={!!r.mayPublish} onChange={(v) => upd({ mayPublish: v })} />
      </div>
    </Section>
  );
}

function GigTasks({ gig }: { gig: Gig }) {
  const { t } = useI18n();
  const tasks = useTasks().filter((x) => x.gigId === gig.id && x.status !== 'cancelled')
    .sort((a, b) => (a.status === b.status ? a.dueAt.localeCompare(b.dueAt) : a.status === 'open' ? -1 : 1));
  return (
    <Section title={t('gig.tasks')} actions={<NewTaskButton gigId={gig.id} personId={gig.clientPersonId} />}>
      {tasks.length === 0 ? <p className="muted small">{t('tasks.empty')}</p> : <div className="list">{tasks.map((x) => <TaskRow key={x.id} task={x} showLink={false} />)}</div>}
    </Section>
  );
}
