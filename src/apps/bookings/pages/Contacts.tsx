import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../../core/db';
import { useI18n } from '../../../core/i18n';
import { Empty, Section, StagePill, useToast } from '../../../core/ui';
import { euro, fmtDate } from '../../../core/format';
import { nowIso, save, softDelete } from '../../../core/repo';
import { download } from '../../../core/backup';
import type { Enquiry, Gig, Organisation, Person, Venue } from '../../../core/types';
import { byId, mapsLink, personLabel, useGigs, useOrgs, usePersons, useVenues } from '../data';
import { OrgFields, PersonFields, VenueFields } from '../components/forms';
import { History, Timeline } from '../components/parts';

type Kind = 'person' | 'org' | 'venue';

export function ContactList() {
  const { t } = useI18n();
  const [kind, setKind] = useState<Kind>(() => { try { return (sessionStorage.getItem('fq.contacts.tab') as Kind) || 'person'; } catch { return 'person'; } });
  const [q, setQ] = useState('');
  const persons = usePersons();
  const orgs = useOrgs();
  const venues = useVenues();
  const gigs = useGigs();
  const omap = byId(orgs);
  useEffect(() => { try { sessionStorage.setItem('fq.contacts.tab', kind); } catch { /* ignore */ } }, [kind]);
  const match = (s: string) => !q || s.toLowerCase().includes(q.toLowerCase());
  const countFor = (k: Kind, id: string) => gigs.filter((g) => (k === 'person' ? g.clientPersonId === id || g.contacts.some((c) => c.personId === id) : k === 'org' ? g.clientOrganisationId === id : g.venueId === id)).length;

  return (
    <div>
      <div className="page-head">
        <h1>{t('contacts.title')}</h1>
        <Link className="btn primary" to={`/bookings/contacts/${kind}/new`}>+ {kind === 'person' ? t('contacts.newPerson') : kind === 'org' ? t('contacts.newOrg') : t('contacts.newVenue')}</Link>
      </div>
      <div className="tabs" role="tablist">
        {(['person', 'org', 'venue'] as Kind[]).map((k) => (
          <button key={k} role="tab" aria-selected={kind === k} onClick={() => setKind(k)}>
            {k === 'person' ? t('contacts.persons') : k === 'org' ? t('contacts.organisations') : t('contacts.venues')}
          </button>
        ))}
      </div>
      <input className="input" style={{ marginBottom: 'var(--s4)', maxWidth: 420 }} placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('common.search')} />
      {kind === 'person' && (() => {
        const rows = persons.filter((p) => match([p.firstName, p.lastName, p.email, p.phone, p.instagram, p.organisationId ? omap.get(p.organisationId)?.name : '', ...(p.tags ?? [])].join(' ')))
          .sort((a, b) => personLabel(a).localeCompare(personLabel(b)));
        return rows.length === 0 ? <Empty>{t('contacts.empty')}</Empty> : (
          <div className="list">{rows.map((p) => (
            <Link key={p.id} to={`/bookings/contacts/person/${p.id}`} className="list-item">
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="strong">{p.anonymisedAt ? t('contacts.anonymised') : personLabel(p)} {p.organisationId && <span className="muted small">· {omap.get(p.organisationId)?.name}</span>}</div>
                <div className="tiny muted">{[p.phone, p.email, p.instagram].filter(Boolean).join(' · ')} {p.tags?.length ? `· ${p.tags.join(', ')}` : ''}</div>
              </div>
              <span className="small muted">{countFor('person', p.id)} {t('contacts.gigs').toLowerCase()}</span>
            </Link>
          ))}</div>
        );
      })()}
      {kind === 'org' && (() => {
        const rows = orgs.filter((o) => match([o.name, o.kvk, o.invoiceEmail].join(' '))).sort((a, b) => a.name.localeCompare(b.name));
        return rows.length === 0 ? <Empty>{t('contacts.empty')}</Empty> : (
          <div className="list">{rows.map((o) => (
            <Link key={o.id} to={`/bookings/contacts/org/${o.id}`} className="list-item">
              <div className="grow"><div className="strong">{o.name}</div><div className="tiny muted">{t(`org.type.${o.type}`)}</div></div>
              <span className="small muted">{countFor('org', o.id)} {t('contacts.gigs').toLowerCase()}</span>
            </Link>
          ))}</div>
        );
      })()}
      {kind === 'venue' && (() => {
        const rows = venues.filter((v) => match([v.name, v.city, v.street].join(' '))).sort((a, b) => a.name.localeCompare(b.name));
        return rows.length === 0 ? <Empty>{t('contacts.empty')}</Empty> : (
          <div className="list">{rows.map((v) => (
            <Link key={v.id} to={`/bookings/contacts/venue/${v.id}`} className="list-item">
              <div className="grow"><div className="strong">{v.name}</div><div className="tiny muted">{[v.street, v.city].filter(Boolean).join(', ')}</div></div>
              <span className="small muted">{countFor('venue', v.id)} {t('contacts.gigs').toLowerCase()}</span>
            </Link>
          ))}</div>
        );
      })()}
    </div>
  );
}

const TABLE: Record<Kind, 'persons' | 'organisations' | 'venues'> = { person: 'persons', org: 'organisations', venue: 'venues' };

export function ContactDetail({ kind }: { kind: Kind }) {
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const nav = useNavigate();
  const toast = useToast();
  const { t, lang } = useI18n();
  const stored = useLiveQuery(() => (isNew ? undefined : db.table(TABLE[kind]).get(id!)), [id, kind]) as Person | Organisation | Venue | undefined;
  const [d, setD] = useState<Record<string, unknown> | null>(isNew ? (kind === 'person' ? { language: 'nl', tags: [], firstName: '', lastName: '' } : kind === 'org' ? { type: 'company', name: '' } : { name: '' }) : null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (stored && !dirty) setD(stored as unknown as Record<string, unknown>); }, [stored, dirty]);
  const gigs = useGigs();
  const persons = usePersons();
  if (!d) return stored === undefined && !isNew ? null : <Empty>{t('contacts.notFound')}</Empty>;
  const set = (p: Record<string, unknown>) => { setD({ ...d, ...p }); setDirty(true); };
  const rid = d.id as string | undefined;
  const related: Gig[] = rid ? gigs.filter((g) => (kind === 'person' ? g.clientPersonId === rid || g.contacts.some((c) => c.personId === rid) : kind === 'org' ? g.clientOrganisationId === rid : g.venueId === rid))
    .sort((a, b) => b.date.localeCompare(a.date)) : [];
  const revenue = related.filter((g) => ['confirmed', 'played', 'invoiced', 'paid'].includes(g.stage)).reduce((s, g) => s + (g.agreedFee ?? 0), 0);
  const title = kind === 'person' ? (d.anonymisedAt ? t('contacts.anonymised') : `${d.firstName ?? ''} ${d.lastName ?? ''}`.trim()) : String(d.name ?? '');

  async function persist() {
    if (kind === 'person' && !d!.firstName) return;
    if (kind !== 'person' && !d!.name) return;
    const saved = await save(TABLE[kind], d as never);
    setDirty(false);
    toast(t('common.saved'));
    if (isNew) nav(`/bookings/contacts/${kind}/${(saved as { id: string }).id}`, { replace: true });
  }

  async function exportPerson() {
    const p = stored as Person;
    const [enq, inter, tasks] = await Promise.all([
      db.enquiries.where('personId').equals(p.id).toArray(), db.interactions.where('personId').equals(p.id).toArray(), db.tasks.where('personId').equals(p.id).toArray(),
    ]);
    download(`funqtion-person-${p.id}.json`, JSON.stringify({ person: p, gigs: related, enquiries: enq, interactions: inter, tasks }, null, 2));
  }

  async function anonymise() {
    if (!confirm(t('contacts.anonymiseConfirm'))) return;
    const p = stored as Person;
    await save<Person>('persons', { id: p.id, createdAt: p.createdAt, createdBy: p.createdBy, updatedAt: p.updatedAt, updatedBy: p.updatedBy,
      firstName: '—', lastName: '', language: p.language, tags: [], anonymisedAt: nowIso() } as Person);
    const enqs = await db.enquiries.where('personId').equals(p.id).toArray();
    for (const e of enqs) await save<Enquiry>('enquiries', { ...e, contactName: '—', contactEmail: undefined, contactPhone: undefined, contactInstagram: undefined, rawMessage: undefined, notes: undefined });
    const inter = await db.interactions.where('personId').equals(p.id).toArray();
    for (const i of inter) await softDelete('interactions', i.id);
    // Scrub personal values from the audit log for this person and their enquiries.
    const ids = [p.id, ...enqs.map((e) => e.id)];
    const logs = await db.audit.where('rowId').anyOf(ids).toArray();
    for (const l of logs) await db.audit.put({ ...l, changes: Object.fromEntries(Object.keys(l.changes).map((k) => [k, ['•', '•']])) });
    toast(t('contacts.anonymised'));
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="legend"><Link to="/bookings/contacts">← {t('contacts.title')}</Link></div>
          <h1>{title || (kind === 'person' ? t('contacts.newPerson') : kind === 'org' ? t('contacts.newOrg') : t('contacts.newVenue'))}</h1>
        </div>
        {!isNew && kind === 'venue' && <a className="btn" href={mapsLink(d as unknown as Venue)} target="_blank" rel="noreferrer">{t('gig.navigate')}</a>}
        {!isNew && kind === 'person' && (
          <div className="row">
            {typeof d.phone === 'string' && d.phone && <a className="btn" href={`tel:${d.phone}`}>{t('common.phone')}</a>}
            {typeof d.email === 'string' && d.email && <a className="btn" href={`mailto:${d.email}`}>{t('common.email')}</a>}
            {typeof d.instagram === 'string' && d.instagram && <a className="btn" href={`https://instagram.com/${d.instagram.replace('@', '')}`} target="_blank" rel="noreferrer">Instagram</a>}
          </div>
        )}
      </div>
      <div className="layout-2">
        <div>
          <Section>
            {kind === 'person' && <PersonFields d={d as Partial<Person>} set={set} />}
            {kind === 'org' && <OrgFields d={d as Partial<Organisation>} set={set} />}
            {kind === 'venue' && <VenueFields d={d as Partial<Venue>} set={set} />}
          </Section>
          {(isNew || dirty) && (
            <div className="savebar"><span className="small muted">{t('common.unsaved')}</span>
              <div className="row">{!isNew && <button className="btn ghost" onClick={() => { setDirty(false); setD(stored as never); }}>{t('common.cancel')}</button>}<button className="btn primary" onClick={persist}>{t('common.save')}</button></div></div>
          )}
          {!isNew && rid && <Section title={t('gig.history')}><History rowIds={[rid]} /></Section>}
        </div>
        {!isNew && rid && (
          <div>
            <Section title={`${t('contacts.gigs')} · ${related.length}`}>
              <p className="small muted">{t('contacts.revenue')}: <span className="strong">{euro(revenue, lang)}</span></p>
              {related.length === 0 ? <p className="muted small">—</p> : (
                <div className="list">{related.map((g) => (
                  <Link key={g.id} to={`/bookings/gigs/${g.id}`} className="list-item"><span className="small" style={{ minWidth: 84 }}>{fmtDate(g.date, lang, { day: 'numeric', month: 'short', year: 'numeric' })}</span><span className="grow">{g.title}</span><StagePill stage={g.stage} /></Link>
                ))}</div>
              )}
            </Section>
            {kind === 'org' && (
              <Section title={t('contacts.people')}>
                <div className="list">{persons.filter((p) => p.organisationId === rid).map((p) => <Link key={p.id} className="list-item" to={`/bookings/contacts/person/${p.id}`}>{personLabel(p)} <span className="muted small">{p.orgRole}</span></Link>)}</div>
              </Section>
            )}
            {kind === 'person' && <Section title={t('gig.timeline')}><Timeline personId={rid} /></Section>}
            {kind === 'person' && (
              <Section title={t('contacts.privacy')}>
                <div className="row">
                  <button className="btn small" onClick={exportPerson}>{t('contacts.exportData')}</button>
                  {!d.anonymisedAt && <button className="btn small danger" onClick={anonymise}>{t('contacts.anonymise')}</button>}
                </div>
              </Section>
            )}
            <div className="row"><button className="btn small danger" onClick={async () => { if (confirm(t('common.confirmDelete'))) { await softDelete(TABLE[kind], rid); nav('/bookings/contacts'); } }}>{t('common.delete')}</button></div>
          </div>
        )}
      </div>
    </div>
  );
}
