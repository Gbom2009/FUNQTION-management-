import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../../core/db';
import { useI18n } from '../../../core/i18n';
import { useSession } from '../../../core/session';
import { Empty, Field, Modal, Section, useToast } from '../../../core/ui';
import { centsFromInput, euro, fmtDate, fmtDateTime, inputFromCents } from '../../../core/format';
import { alive, softDelete } from '../../../core/repo';
import { todayStr } from '../../../core/dates';
import { GEAR_CATEGORIES, type GearCategory, type GearItem, type GearOwner, type GearStatus } from '../../../core/types';
import {
  addPhoto, addSafetyTest, blankItem, disposeItem, logMaintenance, markFound, moveItem, reportIssue, saveItem, useGearItems, useGearLocations, useIssues, useLogs,
  useMovements, usePhotoMeta, useSafetyTests, type ItemDraft,
} from '../data';
import { OwnerChip, StatusPill, Thumb } from '../components';
import { completeness } from '../domain/gear';

const OWNERS: GearOwner[] = ['gijs', 'coen', 'shared', 'unknown'];

export function ItemList() {
  const { t, lang } = useI18n();
  const items = useGearItems();
  const locs = useGearLocations();
  const photos = new Set(usePhotoMeta().map((p) => p.itemId));
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<GearCategory | ''>('');
  const [owner, setOwner] = useState<GearOwner | ''>('');
  const [status, setStatus] = useState<GearStatus | 'active'>('active');
  const needle = q.trim().toLowerCase();
  const rows = items
    .filter((i) => (status === 'active' ? i.status !== 'disposed' : i.status === status))
    .filter((i) => !cat || i.category === cat)
    .filter((i) => !owner || i.owner === owner)
    .filter((i) => !needle || [i.name, i.code, i.brand, i.model, i.serial].some((x) => x?.toLowerCase().includes(needle)))
    .sort((a, b) => a.code.localeCompare(b.code));
  return (
    <div>
      <div className="page-head"><h1>{t('g.items')}</h1><Link className="btn primary" to="/gear/items/new">+ {t('g.newItem')}</Link></div>
      <div className="stack" style={{ marginBottom: 'var(--s4)' }}>
        <input className="input" type="search" placeholder={t('g.search')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('g.search')} />
        <div className="row">
          <select className="input" style={{ width: 'auto' }} value={cat} onChange={(e) => setCat(e.target.value as GearCategory | '')} aria-label={t('g.category')}><option value="">{t('g.allCategories')}</option>{GEAR_CATEGORIES.map((c) => <option key={c} value={c}>{t(`g.cat.${c}`)}</option>)}</select>
          <select className="input" style={{ width: 'auto' }} value={owner} onChange={(e) => setOwner(e.target.value as GearOwner | '')} aria-label={t('g.owner')}><option value="">{t('g.allOwners')}</option>{OWNERS.map((o) => <option key={o} value={o}>{t(`g.owner.${o}`)}</option>)}</select>
          <select className="input" style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value as GearStatus | 'active')} aria-label={t('g.statusLabel')}>
            <option value="active">{t('g.allActive')}</option>{(['available', 'out', 'out_of_service', 'in_repair', 'lent', 'missing', 'disposed'] as GearStatus[]).map((s) => <option key={s} value={s}>{t(`g.status.${s}`)}</option>)}
          </select>
        </div>
      </div>
      {rows.length === 0 ? <Empty>{t('g.noItems')}</Empty> : (
        <div className="list">
          {rows.map((i) => {
            const c = completeness(i, photos);
            const gaps = Object.values(c).filter((x) => !x).length;
            return (
              <Link key={i.id} to={`/gear/items/${i.id}`} className="list-item">
                <Thumb itemId={i.id} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="strong">{i.name}{i.kind === 'counted' ? ` × ${i.quantity}` : ''}</div>
                  <div className="tiny muted mono">{i.code} · {t(`g.cat.${i.category}`)} · {locs.find((l) => l.id === i.locationId)?.name ?? '—'}{gaps ? ` · ${t('g.gaps', { n: gaps })}` : ''}</div>
                </div>
                <OwnerChip owner={i.owner} />
                {i.status !== 'available' && <StatusPill status={i.status} />}
                <span className="tiny muted" style={{ minWidth: 70, textAlign: 'right' }}>{euro(i.replacementValue ?? i.purchasePrice, lang)}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ItemPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const isNew = id === 'new';
  const nav = useNavigate();
  const toast = useToast();
  const { t, lang } = useI18n();
  const { settings } = useSession();
  const stored = useLiveQuery(() => (isNew ? undefined : db.gearItems.get(id!)), [id]);
  const items = useGearItems();
  const locs = useGearLocations();
  const expenses = alive(useLiveQuery(() => db.expenses.toArray(), []) ?? []).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 200);
  const assets = alive(useLiveQuery(() => db.assets.toArray(), []) ?? []);
  const [d, setD] = useState<ItemDraft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [dialog, setDialog] = useState<null | 'issue' | 'safety'>(null);
  useEffect(() => {
    if (isNew && !d) setD({ ...blankItem(), code: params.get('code') ?? undefined, homeLocationId: locs.find((l) => l.key === 'home_gijs')?.id });
    else if (stored && !dirty) setD(stored);
  }, [stored, dirty, isNew, locs.length]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return null;
  const set = (p: Partial<ItemDraft>) => { setD({ ...d, ...p }); setDirty(true); };
  const containers = items.filter((i) => i.kind === 'container' && i.id !== d.id);
  async function persist() {
    if (!d!.name.trim()) return;
    const s = await saveItem(d!);
    setDirty(false); toast(t('common.saved'));
    if (isNew) nav(`/gear/items/${s.id}`, { replace: true });
  }
  const txt = (k: 'name' | 'brand' | 'model' | 'serial' | 'supplier' | 'firmware' | 'laserClass' | 'notes', label: string) => (
    <Field label={label}><input value={d[k] ?? ''} onChange={(e) => set({ [k]: e.target.value || undefined } as Partial<ItemDraft>)} /></Field>
  );
  const numF = (k: 'weightKg' | 'powerW' | 'quantity', label: string) => (
    <Field label={label}><input inputMode="decimal" value={d[k] ?? ''} onChange={(e) => set({ [k]: e.target.value ? Number(e.target.value.replace(',', '.')) : undefined } as Partial<ItemDraft>)} /></Field>
  );
  const money = (k: 'purchasePrice' | 'replacementValue', label: string) => (
    <Field label={label}><input inputMode="decimal" defaultValue={inputFromCents(d[k])} key={`${k}${stored?.updatedAt}`} onBlur={(e) => set({ [k]: centsFromInput(e.target.value) } as Partial<ItemDraft>)} /></Field>
  );
  return (
    <div>
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <div className="legend"><Link to="/gear/items">← {t('g.items')}</Link></div>
          <h1 style={{ overflowWrap: 'anywhere' }}>{isNew ? t('g.newItem') : d.name}</h1>
          {!isNew && stored && <div className="sub row"><span className="mono">{stored.code}</span><StatusPill status={stored.status} /><OwnerChip owner={stored.owner} /></div>}
        </div>
        {!isNew && stored && (
          <div className="row">
            <button className="btn" onClick={() => setDialog('issue')}>{t('g.reportIssue')}</button>
            {stored.status === 'missing' && <button className="btn" onClick={() => markFound(stored)}>{t('g.found')}</button>}
          </div>
        )}
      </div>
      <div className="layout-2">
        <div>
          {!isNew && stored && <Photos itemId={stored.id} />}
          <Section title={t('g.details')}>
            <div className="stack">
              <div className="grid2">{txt('name', t('g.name'))}
                <Field label={t('g.category')}><select value={d.category} onChange={(e) => set({ category: e.target.value as GearCategory })}>{GEAR_CATEGORIES.map((c) => <option key={c} value={c}>{t(`g.cat.${c}`)}</option>)}</select></Field></div>
              <div className="chips" role="group" aria-label={t('g.kind')}>
                {(['unique', 'counted', 'container'] as const).map((k) => <button key={k} className="chip" aria-pressed={d.kind === k} onClick={() => set({ kind: k, quantity: k === 'counted' ? d.quantity : 1 })}>{t(`g.kind.${k}`)}</button>)}
              </div>
              <p className="tiny muted">{t(`g.kindHint.${d.kind}`)}</p>
              <div className="grid3">{txt('brand', t('g.brand'))}{txt('model', t('g.model'))}{txt('serial', t('g.serial'))}</div>
              <div className="grid3">
                {d.kind === 'counted' && numF('quantity', t('g.quantity'))}
                <Field label={t('g.owner')}><select value={d.owner} onChange={(e) => set({ owner: e.target.value as GearOwner })}>{OWNERS.map((o) => <option key={o} value={o}>{t(`g.owner.${o}`)}</option>)}</select></Field>
                <Field label={t('g.transport')}><select value={d.transport} onChange={(e) => set({ transport: e.target.value as GearItem['transport'] })}><option value="trailer">{t('g.trailer')}</option><option value="car">{t('g.car')}</option></select></Field>
              </div>
              <div className="grid3">
                <Field label={t('g.home')}><select value={d.homeLocationId ?? ''} onChange={(e) => set({ homeLocationId: e.target.value || undefined })}><option value="">—</option>{locs.filter((l) => l.type === 'home' || l.type === 'storage').map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
                <Field label={t('g.container')}><select value={d.parentId ?? ''} onChange={(e) => set({ parentId: e.target.value || undefined })}><option value="">—</option>{containers.map((c) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}</select></Field>
                {numF('weightKg', t('g.weight'))}
              </div>
            </div>
          </Section>
          <Section title={t('g.valueSection')}>
            <div className="stack">
              <div className="grid3">
                <Field label={t('g.purchaseDate')}><input type="date" value={d.purchaseDate ?? ''} onChange={(e) => set({ purchaseDate: e.target.value || undefined })} /></Field>
                {money('purchasePrice', t('g.purchasePrice'))}{money('replacementValue', t('g.replacementValue'))}
              </div>
              <div className="grid3">{txt('supplier', t('g.supplier'))}
                <Field label={t('g.warranty')}><input type="date" value={d.warrantyUntil ?? ''} onChange={(e) => set({ warrantyUntil: e.target.value || undefined })} /></Field></div>
              <div className="grid2">
                <Field label={t('g.expense')} hint={t('g.expenseHint')}><select value={d.expenseId ?? ''} onChange={(e) => set({ expenseId: e.target.value || undefined })}><option value="">—</option>{expenses.map((x) => <option key={x.id} value={x.id}>{x.date} · {x.supplier} · {euro(x.amount, lang)}</option>)}</select></Field>
                <Field label={t('g.asset')}><select value={d.assetId ?? ''} onChange={(e) => set({ assetId: e.target.value || undefined })}><option value="">—</option>{assets.map((x) => <option key={x.id} value={x.id}>{x.name} · {euro(x.cost, lang)}</option>)}</select></Field>
              </div>
            </div>
          </Section>
          <Section title={t('g.technical')}>
            <div className="grid3">
              <Field label={t('g.electrical')}><select value={d.electrical} onChange={(e) => set({ electrical: e.target.value as GearItem['electrical'] })}>{(['none', 'class1', 'class2'] as const).map((x) => <option key={x} value={x}>{t(`g.el.${x}`)}</option>)}</select></Field>
              {numF('powerW', t('g.power'))}{txt('firmware', t('g.firmware'))}
              {d.category === 'lasers' && txt('laserClass', t('g.laserClass'))}
            </div>
            <Field label={t('common.notes')}><textarea value={d.notes ?? ''} onChange={(e) => set({ notes: e.target.value || undefined })} /></Field>
          </Section>
        </div>
        <div>
          {!isNew && stored && <ItemSide item={stored} onSafety={() => setDialog('safety')} safetyOn={settings.gearSafetyTests} />}
        </div>
      </div>
      {(dirty || isNew) && (
        <div className="savebar">
          <span className="small muted">{t('common.unsaved')}</span>
          <div className="row"><button className="btn ghost" onClick={() => (isNew ? nav('/gear/items') : (setDirty(false), setD(stored!)))}>{t('common.cancel')}</button><button className="btn primary" disabled={!d.name.trim()} onClick={persist}>{t('common.save')}</button></div>
        </div>
      )}
      {dialog === 'issue' && stored && <IssueDialog item={stored} onClose={() => setDialog(null)} />}
      {dialog === 'safety' && stored && <SafetyDialog item={stored} onClose={() => setDialog(null)} />}
    </div>
  );
}

function Photos({ itemId }: { itemId: string }) {
  const { t } = useI18n();
  const photos = useLiveQuery(() => db.gearPhotos.where('itemId').equals(itemId).toArray(), [itemId]) ?? [];
  const [urls, setUrls] = useState<{ id: string; url: string }[]>([]);
  useEffect(() => {
    const list = photos.filter((p) => !p.deletedAt).map((p) => ({ id: p.id, url: URL.createObjectURL(p.blob) }));
    setUrls(list);
    return () => list.forEach((x) => URL.revokeObjectURL(x.url));
  }, [photos]);
  return (
    <Section title={t('g.photos')}>
      <div className="photo-row">
        {urls.map((p) => (
          <div key={p.id} className="photo-cell"><img src={p.url} alt="" /><button className="btn icon small" aria-label={t('common.delete')} onClick={() => softDelete('gearPhotos', p.id)}>✕</button></div>
        ))}
        <label className="photo-cell add"><input type="file" accept="image/*" capture="environment" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) await addPhoto(itemId, f); e.target.value = ''; }} />+ {t('g.addPhoto')}</label>
      </div>
      <p className="tiny muted">{t('g.photoHint')}</p>
    </Section>
  );
}

function ItemSide({ item, onSafety, safetyOn }: { item: GearItem; onSafety: () => void; safetyOn: boolean }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const locs = useGearLocations();
  const moves = useMovements(item.id);
  const issues = useIssues().filter((i) => i.itemId === item.id);
  const logs = useLogs().filter((l) => l.itemId === item.id).sort((a, b) => b.doneAt.localeCompare(a.doneAt));
  const tests = useSafetyTests().filter((x) => x.itemId === item.id).sort((a, b) => b.date.localeCompare(a.date));
  const gigs = new Map((useLiveQuery(() => db.gigs.toArray(), []) ?? []).map((g) => [g.id, g]));
  return (
    <>
      <Section title={t('g.where')}>
        <dl className="kv">
          <dt>{t('g.location')}</dt><dd>{locs.find((l) => l.id === item.locationId)?.name ?? '—'}</dd>
          <dt>{t('g.usage')}</dt><dd>{t('g.usageValue', { h: item.usageHours, n: item.usageGigs })}</dd>
        </dl>
        <div className="row" style={{ marginTop: 'var(--s3)' }}>
          <select className="input" style={{ width: 'auto' }} value="" aria-label={t('g.moveTo')} onChange={async (e) => { if (e.target.value) { await moveItem(item, e.target.value); toast(t('common.saved')); } }}>
            <option value="">{t('g.moveTo')}</option>{locs.filter((l) => l.type !== 'on_the_road').map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <button className="btn small ghost" onClick={async () => { await logMaintenance(item, undefined, 'ok', t('g.checkedOk')); toast(t('common.saved')); }}>{t('g.checkedOk')}</button>
          {item.status !== 'disposed' && <button className="btn small danger" onClick={async () => { if (window.confirm(t('g.disposeConfirm'))) await disposeItem(item); }}>{t('g.dispose')}</button>}
        </div>
      </Section>
      {issues.length > 0 && (
        <Section title={t('g.issues')}>
          <div className="list">{issues.map((i) => <Link key={i.id} className="list-item" to="/gear/care"><span className="grow small">{i.title}</span><span className="pill">{t(`g.issue.${i.status}`)}</span></Link>)}</div>
        </Section>
      )}
      {safetyOn && item.electrical !== 'none' && (
        <Section title={t('g.safety')} actions={<button className="btn small" onClick={onSafety}>+ {t('g.addTest')}</button>}>
          {tests.length === 0 ? <p className="small muted">{t('g.neverTested')}</p> : (
            <div className="list">{tests.map((x) => <div key={x.id} className="list-item small"><span className="grow">{fmtDate(x.date, lang)} · {x.inspector}</span><span className="pill">{x.passed ? t('g.passed') : t('g.failed')}</span><span className="tiny muted">{t('g.nextDue')} {fmtDate(x.nextDue, lang)}</span></div>)}</div>
          )}
        </Section>
      )}
      {logs.length > 0 && (
        <Section title={t('g.maintenance')}>
          <div className="list">{logs.slice(0, 10).map((l) => <div key={l.id} className="list-item small"><span className="tiny muted" style={{ minWidth: 80 }}>{fmtDate(l.doneAt, lang)}</span><span className="grow">{l.note ?? ''}</span><span className="pill">{l.result === 'ok' ? '✓' : '!'}</span></div>)}</div>
        </Section>
      )}
      <Section title={t('g.history')}>
        {moves.length === 0 ? <p className="small muted">—</p> : (
          <div className="list">{moves.slice(0, 20).map((m) => (
            <div key={m.id} className="list-item small"><span className="tiny muted" style={{ minWidth: 120 }}>{fmtDateTime(m.at, lang)}</span>
              <span className="grow">{t(`g.move.${m.type}`)}{m.gigId ? ` · ${gigs.get(m.gigId)?.title ?? ''}` : ''}{m.toLocationId ? ` → ${locs.find((l) => l.id === m.toLocationId)?.name ?? ''}` : ''}{m.note ? ` · ${m.note}` : ''}</span></div>
          ))}</div>
        )}
      </Section>
    </>
  );
}

export function IssueDialog({ item, gigId, onClose }: { item: GearItem; gigId?: string; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<'minor' | 'out_of_service'>('minor');
  const [guests, setGuests] = useState(false);
  return (
    <Modal title={`${t('g.reportIssue')}: ${item.name}`} onClose={onClose} footer={<button className="btn primary" disabled={!title.trim()} onClick={async () => {
      await reportIssue(item, { title: title.trim(), description: description || undefined, severity, gigId, causedByGuests: guests || undefined });
      toast(t('common.saved')); onClose();
    }}>{t('common.save')}</button>}>
      <Field label={t('g.issueTitle')}><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('g.issuePlaceholder')} /></Field>
      <Field label={t('common.notes')}><textarea value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      <div className="chips">
        <button className="chip" aria-pressed={severity === 'minor'} onClick={() => setSeverity('minor')}>{t('g.sev.minor')}</button>
        <button className="chip" aria-pressed={severity === 'out_of_service'} onClick={() => setSeverity('out_of_service')}>{t('g.sev.out_of_service')}</button>
      </div>
      {gigId && <label className="check"><input type="checkbox" checked={guests} onChange={(e) => setGuests(e.target.checked)} />{t('g.byGuests')}</label>}
    </Modal>
  );
}

function SafetyDialog({ item, onClose }: { item: GearItem; onClose: () => void }) {
  const { t } = useI18n();
  const [date, setDate] = useState(todayStr());
  const [inspector, setInspector] = useState('');
  const [passed, setPassed] = useState(true);
  const [labelNo, setLabelNo] = useState('');
  const [note, setNote] = useState('');
  return (
    <Modal title={`${t('g.addTest')}: ${item.name}`} onClose={onClose} footer={<button className="btn primary" disabled={!inspector.trim()} onClick={async () => { await addSafetyTest(item, { date, inspector, passed, labelNo: labelNo || undefined, note: note || undefined }); onClose(); }}>{t('common.save')}</button>}>
      <div className="grid2">
        <Field label={t('g.testDate')}><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label={t('g.inspector')}><input value={inspector} onChange={(e) => setInspector(e.target.value)} /></Field>
        <Field label={t('g.labelNo')}><input value={labelNo} onChange={(e) => setLabelNo(e.target.value)} /></Field>
      </div>
      <div className="chips"><button className="chip" aria-pressed={passed} onClick={() => setPassed(true)}>{t('g.passed')}</button><button className="chip" aria-pressed={!passed} onClick={() => setPassed(false)}>{t('g.failed')}</button></div>
      <Field label={t('common.notes')}><textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
    </Modal>
  );
}
