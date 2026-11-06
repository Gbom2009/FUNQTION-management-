import { useState } from 'react';
import { useI18n } from '../../../core/i18n';
import { Check, Field, Modal } from '../../../core/ui';
import { save } from '../../../core/repo';
import { LEAD_SOURCES, ORG_TYPES, type Organisation, type Person, type Venue } from '../../../core/types';
import { useOrgs } from '../data';

type Draft<T> = Partial<T>;

export function PersonFields({ d, set }: { d: Draft<Person>; set: (p: Draft<Person>) => void }) {
  const { t } = useI18n();
  const orgs = useOrgs();
  return (
    <div className="stack">
      <div className="grid2">
        <Field label={t('contacts.firstName')}><input value={d.firstName ?? ''} onChange={(e) => set({ firstName: e.target.value })} /></Field>
        <Field label={t('contacts.lastName')}><input value={d.lastName ?? ''} onChange={(e) => set({ lastName: e.target.value })} /></Field>
        <Field label={t('common.phone')}><input type="tel" value={d.phone ?? ''} onChange={(e) => set({ phone: e.target.value })} /></Field>
        <Field label={t('common.email')}><input type="email" value={d.email ?? ''} onChange={(e) => set({ email: e.target.value })} /></Field>
        <Field label={t('contacts.whatsapp')}><input type="tel" value={d.whatsapp ?? ''} onChange={(e) => set({ whatsapp: e.target.value })} /></Field>
        <Field label={t('common.instagram')}><input value={d.instagram ?? ''} placeholder="@" onChange={(e) => set({ instagram: e.target.value })} /></Field>
        <Field label={t('contacts.organisation')}>
          <select value={d.organisationId ?? ''} onChange={(e) => set({ organisationId: e.target.value || undefined })}>
            <option value="">—</option>
            {orgs.sort((a, b) => a.name.localeCompare(b.name)).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </Field>
        <Field label={t('contacts.role')}><input value={d.orgRole ?? ''} onChange={(e) => set({ orgRole: e.target.value })} /></Field>
        <Field label={t('source.label')}>
          <select value={d.source ?? ''} onChange={(e) => set({ source: e.target.value as Person['source'] })}>
            <option value="">—</option>
            {LEAD_SOURCES.map((s) => <option key={s} value={s}>{t(`source.${s}`)}</option>)}
          </select>
        </Field>
        <Field label={t('source.detail')}><input value={d.sourceDetail ?? ''} onChange={(e) => set({ sourceDetail: e.target.value })} /></Field>
        <Field label={t('contacts.language')}>
          <select value={d.language ?? 'nl'} onChange={(e) => set({ language: e.target.value as Person['language'] })}>
            <option value="nl">Nederlands</option><option value="en">English</option>
          </select>
        </Field>
        <Field label={t('contacts.tags')}><input value={(d.tags ?? []).join(', ')} onChange={(e) => set({ tags: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} /></Field>
      </div>
      <Field label={t('common.notes')}><textarea value={d.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} /></Field>
      <Check label={t('contacts.marketing')} checked={!!d.marketingOptIn} onChange={(v) => set({ marketingOptIn: v, marketingOptInAt: v ? new Date().toISOString() : undefined })} />
    </div>
  );
}

export function OrgFields({ d, set }: { d: Draft<Organisation>; set: (p: Draft<Organisation>) => void }) {
  const { t } = useI18n();
  return (
    <div className="stack">
      <div className="grid2">
        <Field label={t('common.name')}><input value={d.name ?? ''} onChange={(e) => set({ name: e.target.value })} /></Field>
        <Field label={t('common.type')}>
          <select value={d.type ?? 'company'} onChange={(e) => set({ type: e.target.value as Organisation['type'] })}>
            {ORG_TYPES.map((o) => <option key={o} value={o}>{t(`org.type.${o}`)}</option>)}
          </select>
        </Field>
        <Field label={t('org.kvk')}><input value={d.kvk ?? ''} onChange={(e) => set({ kvk: e.target.value })} /></Field>
        <Field label={t('org.vat')}><input value={d.vatNumber ?? ''} onChange={(e) => set({ vatNumber: e.target.value })} /></Field>
        <Field label={t('org.invoiceEmail')}><input type="email" value={d.invoiceEmail ?? ''} onChange={(e) => set({ invoiceEmail: e.target.value })} /></Field>
        <Field label={t('org.website')}><input value={d.website ?? ''} onChange={(e) => set({ website: e.target.value })} /></Field>
        <Field label={t('common.instagram')}><input value={d.instagram ?? ''} onChange={(e) => set({ instagram: e.target.value })} /></Field>
      </div>
      <Field label={t('org.billing')}><textarea rows={3} value={d.billingAddress ?? ''} onChange={(e) => set({ billingAddress: e.target.value })} /></Field>
      <Field label={t('common.notes')}><textarea value={d.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} /></Field>
    </div>
  );
}

export function VenueFields({ d, set }: { d: Draft<Venue>; set: (p: Draft<Venue>) => void }) {
  const { t } = useI18n();
  return (
    <div className="stack">
      <div className="grid2">
        <Field label={t('common.name')}><input value={d.name ?? ''} onChange={(e) => set({ name: e.target.value })} /></Field>
        <Field label={t('venue.street')}><input value={d.street ?? ''} onChange={(e) => set({ street: e.target.value })} /></Field>
        <Field label={t('venue.postcode')}><input value={d.postcode ?? ''} onChange={(e) => set({ postcode: e.target.value })} /></Field>
        <Field label={t('venue.city')}><input value={d.city ?? ''} onChange={(e) => set({ city: e.target.value })} /></Field>
        <Field label={t('venue.curfew')}><input type="time" value={d.curfew ?? ''} onChange={(e) => set({ curfew: e.target.value })} /></Field>
        <Field label={t('venue.dbLimit')}><input inputMode="numeric" value={d.soundLimitDb ?? ''} onChange={(e) => set({ soundLimitDb: e.target.value ? Number(e.target.value) : undefined })} /></Field>
      </div>
      <Check label={t('venue.houseSound')} checked={!!d.houseSound} onChange={(v) => set({ houseSound: v })} />
      <div className="grid3">
        <Field label={t('venue.loadIn')}><textarea rows={3} value={d.loadInNotes ?? ''} onChange={(e) => set({ loadInNotes: e.target.value })} /></Field>
        <Field label={t('venue.parking')}><textarea rows={3} value={d.parkingNotes ?? ''} onChange={(e) => set({ parkingNotes: e.target.value })} /></Field>
        <Field label={t('venue.power')}><textarea rows={3} value={d.powerNotes ?? ''} onChange={(e) => set({ powerNotes: e.target.value })} /></Field>
      </div>
      <Field label={t('common.notes')}><textarea value={d.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} /></Field>
    </div>
  );
}

/** Quick-create dialogs used from the gig screen. */
export function QuickCreate({ kind, onClose, onCreated }: { kind: 'person' | 'venue' | 'org'; onClose: () => void; onCreated: (id: string) => void }) {
  const { t } = useI18n();
  const [d, setD] = useState<Record<string, unknown>>(kind === 'person' ? { language: 'nl', tags: [] } : kind === 'org' ? { type: 'company' } : {});
  const set = (p: Record<string, unknown>) => setD({ ...d, ...p });
  async function create() {
    if (kind === 'person') { if (!d.firstName) return; const r = await save<Person>('persons', { lastName: '', ...(d as object) } as Person); onCreated(r.id); }
    if (kind === 'venue') { if (!d.name) return; const r = await save<Venue>('venues', d as unknown as Venue); onCreated(r.id); }
    if (kind === 'org') { if (!d.name) return; const r = await save<Organisation>('organisations', d as unknown as Organisation); onCreated(r.id); }
    onClose();
  }
  const title = kind === 'person' ? t('contacts.newPerson') : kind === 'venue' ? t('contacts.newVenue') : t('contacts.newOrg');
  return (
    <Modal title={title} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>{t('common.cancel')}</button><button className="btn primary" onClick={create}>{t('common.save')}</button></>}>
      {kind === 'person' && <PersonFields d={d as Draft<Person>} set={set} />}
      {kind === 'venue' && <VenueFields d={d as Draft<Venue>} set={set} />}
      {kind === 'org' && <OrgFields d={d as Draft<Organisation>} set={set} />}
    </Modal>
  );
}
