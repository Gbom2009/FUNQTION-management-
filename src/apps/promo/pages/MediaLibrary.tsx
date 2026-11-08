import { useRef, useState } from 'react';
import { useI18n, type Key } from '../../../core/i18n';
import { Chips, Empty, Field, Modal, Section, useToast } from '../../../core/ui';
import { patch, softDelete } from '../../../core/repo';
import { MEDIA_KINDS, type MediaAsset, type MediaKind } from '../../../core/types';
import { useGigs } from '../../bookings/data';
import { addMediaFiles, addMediaLink, mediaUrl, useConsents, useMedia } from '../data';
import { Thumb } from '../components';

const PEOPLE: MediaAsset['people'][] = ['none', 'crowd_unrecognisable', 'recognisable'];
const USAGE: MediaAsset['usage'][] = ['internal', 'promo_ok', 'press_ok'];

/** One library for Promo, the Press Kit and the client portal. */
export default function MediaLibrary() {
  const { t } = useI18n();
  const toast = useToast();
  const file = useRef<HTMLInputElement>(null);
  const gigs = useGigs().sort((a, b) => b.date.localeCompare(a.date));
  const [kind, setKind] = useState<MediaKind | 'all'>('all');
  const [gigId, setGigId] = useState('');
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<MediaAsset | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const media = useMedia()
    .filter((m) => (kind === 'all' || m.kind === kind) && (!gigId || m.gigId === gigId))
    .filter((m) => !q || `${m.title} ${m.tags.join(' ')} ${m.photographer ?? ''}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (b.takenAt ?? b.createdAt).localeCompare(a.takenAt ?? a.createdAt));

  return (
    <div>
      <div className="page-head row between">
        <h1>{t('pr.nav.media')}</h1>
        <div className="row">
          <button className="btn small ghost" onClick={() => setLinkOpen(true)}>+ {t('pr.addLink')}</button>
          <button className="btn small" onClick={() => file.current?.click()}>+ {t('pr.upload')}</button>
        </div>
        <input ref={file} type="file" multiple accept="image/*,video/*,audio/*,.svg,.ttf,.otf,.woff,.woff2,.pdf" hidden onChange={async (e) => {
          const files = [...(e.target.files ?? [])]; e.target.value = '';
          if (!files.length) return;
          const r = await addMediaFiles(files, gigId ? { gigId } : {});
          toast(t('pr.uploaded', { n: r.added, d: r.duplicates }));
        }} />
      </div>
      <p className="small muted">{t('pr.mediaHelp')}</p>
      <div className="grid3">
        <Field label={t('pr.kindLabel')}>
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="all">{t('pr.all')}</option>
            {MEDIA_KINDS.map((k) => <option key={k} value={k}>{t(`pr.mk.${k}` as Key)}</option>)}
          </select>
        </Field>
        <Field label={t('pr.gig')}>
          <select value={gigId} onChange={(e) => setGigId(e.target.value)}>
            <option value="">{t('pr.all')}</option>
            {gigs.map((g) => <option key={g.id} value={g.id}>{g.date} · {g.title}</option>)}
          </select>
        </Field>
        <Field label={t('pr.search')}><input value={q} onChange={(e) => setQ(e.target.value)} /></Field>
      </div>
      <Section>
        {media.length ? (
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {media.map((m) => (
              <button key={m.id} className="btn ghost stack" style={{ padding: 2, gap: 2, alignItems: 'flex-start' }} onClick={() => setEdit(m)}>
                <Thumb m={m} size={120} />
                <span className="tiny" style={{ color: m.people === 'recognisable' && !(m.consentIds?.length) ? 'var(--warning)' : 'var(--fq-text-dim)' }}>
                  {t(`pr.usage.${m.usage}` as Key)}{m.people === 'recognisable' ? ' · 👤' : ''}
                </span>
              </button>
            ))}
          </div>
        ) : <Empty>{t('pr.noMediaYet')}</Empty>}
      </Section>
      {edit && <EditMedia m={edit} onClose={() => setEdit(null)} />}
      {linkOpen && <LinkModal onClose={() => setLinkOpen(false)} />}
    </div>
  );
}

function EditMedia({ m, onClose }: { m: MediaAsset; onClose: () => void }) {
  const { t } = useI18n();
  const gigs = useGigs().sort((a, b) => b.date.localeCompare(a.date));
  const consents = useConsents().filter((c) => !c.withdrawnAt && c.given && (!m.gigId || c.gigId === m.gigId || !c.gigId));
  const [v, setV] = useState<MediaAsset>(m);
  const [tags, setTags] = useState(m.tags.join(', '));
  const set = (c: Partial<MediaAsset>) => setV({ ...v, ...c });
  return (
    <Modal title={m.title} onClose={onClose} footer={<>
      <button className="btn ghost danger-text" onClick={async () => { await softDelete('mediaAssets', m.id); onClose(); }}>{t('pr.delete')}</button>
      <button className="btn primary" onClick={async () => { await patch<MediaAsset>('mediaAssets', m.id, { ...v, tags: tags.split(',').map((x) => x.trim()).filter(Boolean) }); onClose(); }}>{t('pr.save')}</button>
    </>}>
      <div className="stack">
        {m.blob || m.externalUrl ? <a href={mediaUrl(m)} target="_blank" rel="noreferrer"><Thumb m={m} size={200} /></a> : null}
        <Field label={t('pr.title')}><input value={v.title} onChange={(e) => set({ title: e.target.value })} /></Field>
        <div className="grid2">
          <Field label={t('pr.gig')}>
            <select value={v.gigId ?? ''} onChange={(e) => set({ gigId: e.target.value || undefined })}>
              <option value="">—</option>
              {gigs.map((g) => <option key={g.id} value={g.id}>{g.date} · {g.title}</option>)}
            </select>
          </Field>
          <Field label={t('pr.photographer')}><input value={v.photographer ?? ''} onChange={(e) => set({ photographer: e.target.value })} /></Field>
        </div>
        <Chips label={t('pr.people')} options={PEOPLE.map((p) => ({ value: p, label: t(`pr.people.${p}` as Key) }))} value={v.people} onChange={(p) => set({ people: p as MediaAsset['people'] })} />
        <Chips label={t('pr.usageLabel')} options={USAGE.map((p) => ({ value: p, label: t(`pr.usage.${p}` as Key) }))} value={v.usage} onChange={(p) => set({ usage: p as MediaAsset['usage'] })} />
        {v.people === 'recognisable' && (
          <Field label={t('pr.consentFor')} hint={t('pr.consentHint')}>
            <select multiple value={v.consentIds ?? []} onChange={(e) => set({ consentIds: [...e.target.selectedOptions].map((o) => o.value) })}>
              {consents.map((c) => <option key={c.id} value={c.id}>{c.subjectName} · {t(`pr.purpose.${c.purpose}` as Key)}</option>)}
            </select>
          </Field>
        )}
        <Field label={t('pr.tags')}><input value={tags} onChange={(e) => setTags(e.target.value)} /></Field>
        <div className="tiny muted">{m.mime}{m.width ? ` · ${m.width}×${m.height}` : ''}{m.sizeBytes ? ` · ${Math.round(m.sizeBytes / 1024)} KB` : ''}</div>
      </div>
    </Modal>
  );
}

function LinkModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<MediaKind>('video');
  return (
    <Modal title={t('pr.addLink')} onClose={onClose} footer={<button className="btn primary" disabled={!/^https:\/\//.test(url)} onClick={async () => { await addMediaLink(url.trim(), title || url, kind); onClose(); }}>{t('pr.save')}</button>}>
      <Field label="URL"><input value={url} placeholder="https://soundcloud.com/…" onChange={(e) => setUrl(e.target.value)} /></Field>
      <Field label={t('pr.title')}><input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
      <Field label={t('pr.kindLabel')}>
        <select value={kind} onChange={(e) => setKind(e.target.value as MediaKind)}>
          {(['video', 'audio', 'doc'] as const).map((k) => <option key={k} value={k}>{t(`pr.mk.${k}` as Key)}</option>)}
        </select>
      </Field>
    </Modal>
  );
}
