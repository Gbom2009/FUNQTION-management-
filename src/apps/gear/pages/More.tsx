import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { strToU8, zipSync } from 'fflate';
import { db } from '../../../core/db';
import { useI18n } from '../../../core/i18n';
import { useSession } from '../../../core/session';
import { Field, Modal, Section, useToast } from '../../../core/ui';
import { centsFromInput, euro, fmtDate, inputFromCents } from '../../../core/format';
import { alive } from '../../../core/repo';
import { todayStr } from '../../../core/dates';
import { download } from '../../../core/backup';
import { GEAR_CATEGORIES, type GearCategory, type GearOwner, type GearRental, type WishItem } from '../../../core/types';
import { useGigs } from '../../bookings/data';
import {
  buyWish, exportGearCsv, importGearCsv, returnRental, saveRental, saveWish, useGearItems, useGearLocations, usePhotoMeta, useRentals, useWishlist,
} from '../data';
import { completeness, insuranceTotals } from '../domain/gear';
import starterCsv from '../../../../docs/gear-inventory/gear-list.csv?raw';

export function More() {
  const { t } = useI18n();
  const links: [string, string, string][] = [
    ['/gear/kits', t('g.kits'), t('g.kitsDesc')], ['/gear/rentals', t('g.rentals'), t('g.rentalsDesc')], ['/gear/insurance', t('g.insurance'), t('g.insuranceDesc')],
    ['/gear/labels', t('g.labels'), t('g.labelsDesc')], ['/gear/wishlist', t('g.wishlist'), t('g.wishlistDesc')], ['/gear/settings', t('nav.settings'), t('g.settingsDesc')],
  ];
  return (
    <div>
      <div className="page-head"><h1>{t('g.more')}</h1></div>
      <div className="dash">{links.map(([to, title, desc]) => <Link key={to} className="card link" to={to}><div className="strong">{title}</div><div className="small muted">{desc}</div></Link>)}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function Rentals() {
  const { t, lang } = useI18n();
  const rentals = useRentals().sort((a, b) => (a.returnedAt ? 1 : 0) - (b.returnedAt ? 1 : 0) || a.until.localeCompare(b.until));
  const gigs = new Map(useGigs().map((g) => [g.id, g]));
  const [edit, setEdit] = useState<Partial<GearRental> | null>(null);
  const today = todayStr();
  return (
    <div>
      <div className="page-head"><h1>{t('g.rentals')}</h1>
        <div className="row"><button className="btn" onClick={() => setEdit({ direction: 'out' })}>+ {t('g.lendOut')}</button><button className="btn primary" onClick={() => setEdit({ direction: 'in' })}>+ {t('g.rentIn')}</button></div></div>
      {rentals.length === 0 ? <p className="muted">{t('g.noRentals')}</p> : (
        <div className="list">{rentals.map((r) => (
          <div key={r.id} className="list-item" style={{ flexWrap: 'wrap' }}>
            <span className="pill">{r.direction === 'in' ? t('g.in') : t('g.out')}</span>
            <div className="grow"><div className="strong">{r.party}</div><div className="tiny muted">{r.lines.map((l) => `${l.qty}× ${l.description}`).join(', ')}{r.gigId ? ` · ${gigs.get(r.gigId)?.title ?? ''}` : ''}</div></div>
            <span className={`small${!r.returnedAt && r.until < today ? ' danger-text' : ''}`}>{fmtDate(r.from, lang)} → {fmtDate(r.until, lang)}</span>
            {r.price ? <span className="small">{euro(r.price, lang)}</span> : null}
            {r.returnedAt ? <span className="pill">✓ {t('g.returned')}</span> : <button className="btn small primary" onClick={() => returnRental(r)}>{t('g.markReturned')}</button>}
          </div>
        ))}</div>
      )}
      {edit && <RentalDialog init={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function RentalDialog({ init, onClose }: { init: Partial<GearRental>; onClose: () => void }) {
  const { t } = useI18n();
  const items = useGearItems().filter((i) => i.status === 'available');
  const gigs = useGigs().filter((g) => g.date >= todayStr()).sort((a, b) => a.date.localeCompare(b.date));
  const [d, setD] = useState({ direction: init.direction ?? 'in', party: '', gigId: '', from: todayStr(), until: todayStr(), price: '', deposit: '', note: '', desc: '', itemIds: [] as string[] });
  const out = d.direction === 'out';
  const ok = d.party.trim() && (out ? d.itemIds.length : d.desc.trim());
  return (
    <Modal title={out ? t('g.lendOut') : t('g.rentIn')} onClose={onClose} footer={<button className="btn primary" disabled={!ok} onClick={async () => {
      const byId = new Map(items.map((i) => [i.id, i]));
      await saveRental({ direction: d.direction, party: d.party.trim(), gigId: d.gigId || undefined, from: d.from, until: d.until, price: centsFromInput(d.price), deposit: centsFromInput(d.deposit), note: d.note || undefined,
        lines: out ? d.itemIds.map((id) => ({ itemId: id, description: `${byId.get(id)?.code} ${byId.get(id)?.name}`, qty: 1 })) : d.desc.split('\n').filter((x) => x.trim()).map((x) => ({ description: x.trim(), qty: 1 })) });
      onClose();
    }}>{t('common.save')}</button>}>
      <div className="grid2">
        <Field label={out ? t('g.to') : t('g.from')}><input value={d.party} onChange={(e) => setD({ ...d, party: e.target.value })} /></Field>
        <Field label={t('g.gig')}><select value={d.gigId} onChange={(e) => setD({ ...d, gigId: e.target.value })}><option value="">—</option>{gigs.map((g) => <option key={g.id} value={g.id}>{g.date} {g.title}</option>)}</select></Field>
        <Field label={t('g.fromDate')}><input type="date" value={d.from} onChange={(e) => setD({ ...d, from: e.target.value })} /></Field>
        <Field label={t('g.untilDate')}><input type="date" value={d.until} onChange={(e) => setD({ ...d, until: e.target.value })} /></Field>
        <Field label={t('g.price')} hint={!out ? t('g.priceHint') : undefined}><input inputMode="decimal" value={d.price} onChange={(e) => setD({ ...d, price: e.target.value })} /></Field>
        <Field label={t('g.deposit')}><input inputMode="decimal" value={d.deposit} onChange={(e) => setD({ ...d, deposit: e.target.value })} /></Field>
      </div>
      {out ? (
        <div className="field"><span>{t('g.items')}</span>
          <div className="stack" style={{ maxHeight: 220, overflow: 'auto', gap: 0 }}>{items.map((i) => <label key={i.id} className="check"><input type="checkbox" checked={d.itemIds.includes(i.id)} onChange={(e) => setD({ ...d, itemIds: e.target.checked ? [...d.itemIds, i.id] : d.itemIds.filter((x) => x !== i.id) })} />{i.code} {i.name}</label>)}</div>
        </div>
      ) : <Field label={t('g.whatRented')} hint={t('g.onePerLine')}><textarea value={d.desc} onChange={(e) => setD({ ...d, desc: e.target.value })} /></Field>}
      <Field label={t('common.notes')}><input value={d.note} onChange={(e) => setD({ ...d, note: e.target.value })} /></Field>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

export function Insurance() {
  const { t, lang } = useI18n();
  const { settings, updateSettings } = useSession();
  const items = useGearItems();
  const locs = useGearLocations();
  const photoIds = new Set(usePhotoMeta().map((p) => p.itemId));
  const totals = insuranceTotals(items);
  const live = items.filter((i) => i.status !== 'disposed');
  const gaps = live.map((i) => ({ i, c: completeness(i, photoIds) })).filter((x) => Object.values(x.c).some((v) => !v));
  const complete = live.length - gaps.length;
  async function pdf() {
    const [{ insuranceList }, { pdfBlob }] = await Promise.all([import('../domain/pdfDocs'), import('../../invoicing/pdf')]);
    const rows = live.sort((a, b) => a.code.localeCompare(b.code)).map((item) => ({ item, locationName: locs.find((l) => l.id === item.locationId)?.name ?? '', hasPhoto: photoIds.has(item.id), hasReceipt: !!item.expenseId }));
    return pdfBlob(insuranceList(rows, { lang, businessName: settings.businessName, date: todayStr(), total: totals.replacement, insurer: settings.gearInsurer }));
  }
  async function zip() {
    const files: Record<string, Uint8Array> = { 'gear-list.csv': strToU8(await exportGearCsv()), 'verzekering.pdf': new Uint8Array(await (await pdf()).arrayBuffer()) };
    const byId = new Map(items.map((i) => [i.id, i]));
    for (const p of alive(await db.gearPhotos.toArray())) {
      const it = byId.get(p.itemId);
      if (it) files[`fotos/${it.code}-${p.id.slice(0, 6)}.jpg`] = new Uint8Array(await p.blob.arrayBuffer());
    }
    const receipts = alive(await db.receipts.toArray());
    for (const it of live) for (const r of receipts.filter((x) => x.expenseId === it.expenseId && it.expenseId)) files[`bonnen/${it.code}-${r.id.slice(0, 6)}.${r.mime.includes('pdf') ? 'pdf' : 'jpg'}`] = new Uint8Array(await r.blob.arrayBuffer());
    download(`funqtion-gear-${todayStr()}.zip`, zipSync(files, { level: 6 }), 'application/zip');
  }
  return (
    <div>
      <div className="page-head"><h1>{t('g.insurance')}</h1>
        <div className="row"><button className="btn" onClick={async () => download(`funqtion-verzekering-${todayStr()}.pdf`, await pdf(), 'application/pdf')}>PDF</button><button className="btn primary" onClick={zip}>{t('g.exportZip')}</button></div></div>
      {!settings.gearInsurer && <div className="banner warn" style={{ marginBottom: 'var(--s4)' }}><span>!</span><div className="txt">{t('g.uninsuredLong', { amount: euro(totals.replacement, lang) })}</div></div>}
      <div className="layout-2">
        <div>
          <Section title={t('g.totals')}>
            <dl className="kv">
              <dt>{t('g.items')}</dt><dd>{totals.count}</dd>
              <dt>{t('g.purchasePrice')}</dt><dd>{euro(totals.purchase, lang)}</dd>
              <dt>{t('g.currentValue')}</dt><dd className="strong">{euro(totals.replacement, lang)}</dd>
              {(['gijs', 'coen', 'shared', 'unknown'] as GearOwner[]).map((o) => <span key={o} style={{ display: 'contents' }}><dt>{t(`g.owner.${o}`)}</dt><dd>{euro(totals.byOwner[o], lang)}</dd></span>)}
              {totals.withoutValue > 0 && <><dt>{t('g.withoutValue')}</dt><dd className="danger-text">{totals.withoutValue}</dd></>}
            </dl>
          </Section>
          <Section title={t('g.completeness', { done: complete, total: live.length })}>
            <div className="list">{gaps.slice(0, 50).map(({ i, c }) => (
              <Link key={i.id} className="list-item" to={`/gear/items/${i.id}`}><span className="grow">{i.code} {i.name}</span><span className="tiny muted">{(Object.keys(c) as (keyof typeof c)[]).filter((k) => !c[k]).map((k) => t(`g.gap.${k}`)).join(', ')}</span></Link>
            ))}</div>
          </Section>
        </div>
        <div>
          <Section title={t('g.policy')}>
            <div className="stack">
              <Field label={t('g.insurer')} hint={t('g.insurerHint')}><input defaultValue={settings.gearInsurer ?? ''} onBlur={(e) => updateSettings({ gearInsurer: e.target.value.trim() || undefined })} /></Field>
              <Field label={t('g.insuredSum')}><input inputMode="decimal" defaultValue={inputFromCents(settings.gearInsuredSum)} onBlur={(e) => updateSettings({ gearInsuredSum: centsFromInput(e.target.value) })} /></Field>
              {settings.gearInsuredSum != null && settings.gearInsuredSum < totals.replacement && <div className="banner warn"><span>!</span><div className="txt small">{t('g.underinsured')}</div></div>}
              <p className="tiny muted">{t('g.policyHint')}</p>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

export function Wishlist() {
  const { t, lang } = useI18n();
  const wishes = useWishlist().filter((w) => w.status !== 'dropped');
  const [edit, setEdit] = useState<Partial<WishItem> | null>(null);
  const order = { must: 0, nice: 1, dream: 2 };
  const active = wishes.filter((w) => w.status !== 'bought').sort((a, b) => order[a.priority] - order[b.priority]);
  return (
    <div>
      <div className="page-head"><h1>{t('g.wishlist')}</h1><button className="btn primary" onClick={() => setEdit({ priority: 'nice', for: 'shared', status: 'idea' })}>+ {t('g.wish')}</button></div>
      {(['must', 'nice', 'dream'] as const).map((p) => {
        const list = active.filter((w) => w.priority === p);
        if (!list.length) return null;
        return (
          <Section key={p} title={`${t(`g.prio.${p}`)} · ${euro(list.reduce((s, w) => s + (w.price ?? 0), 0), lang)}`}>
            <div className="list">{list.map((w) => (
              <div key={w.id} className="list-item" style={{ flexWrap: 'wrap' }}>
                <div className="grow"><div className="strong">{w.name}</div><div className="tiny muted">{t(`g.owner.${w.for}`)} · {t(`g.wstatus.${w.status}`)}{w.reason ? ` · ${w.reason}` : ''}{w.link ? <> · <a href={w.link} target="_blank" rel="noreferrer">link</a></> : null}</div></div>
                <span className="small">{euro(w.price, lang)}</span>
                <button className="btn small ghost" onClick={() => setEdit(w)}>{t('common.edit')}</button>
                <BoughtButton wish={w} />
              </div>
            ))}</div>
          </Section>
        );
      })}
      {!active.length && <p className="muted">{t('g.noWishes')}</p>}
      {edit && <WishDialog init={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function BoughtButton({ wish }: { wish: WishItem }) {
  const { t } = useI18n();
  const toast = useToast();
  return <button className="btn small primary" onClick={async () => { const it = await buyWish(wish); toast(t('g.boughtToast', { code: it.code })); }}>{t('g.bought')}</button>;
}

function WishDialog({ init, onClose }: { init: Partial<WishItem>; onClose: () => void }) {
  const { t } = useI18n();
  const [d, setD] = useState(init);
  return (
    <Modal title={d.name || t('g.wish')} onClose={onClose} footer={<button className="btn primary" disabled={!d.name?.trim()} onClick={async () => { await saveWish({ priority: 'nice', for: 'shared', status: 'idea', ...d, name: d.name!.trim() } as WishItem); onClose(); }}>{t('common.save')}</button>}>
      <Field label={t('g.name')}><input value={d.name ?? ''} onChange={(e) => setD({ ...d, name: e.target.value })} /></Field>
      <div className="grid2">
        <Field label={t('g.price')}><input inputMode="decimal" defaultValue={inputFromCents(d.price)} onBlur={(e) => setD({ ...d, price: centsFromInput(e.target.value) })} /></Field>
        <Field label={t('g.category')}><select value={d.category ?? ''} onChange={(e) => setD({ ...d, category: (e.target.value || undefined) as GearCategory | undefined })}><option value="">—</option>{GEAR_CATEGORIES.map((c) => <option key={c} value={c}>{t(`g.cat.${c}`)}</option>)}</select></Field>
        <Field label={t('g.priority')}><select value={d.priority} onChange={(e) => setD({ ...d, priority: e.target.value as WishItem['priority'] })}>{(['must', 'nice', 'dream'] as const).map((p) => <option key={p} value={p}>{t(`g.prio.${p}`)}</option>)}</select></Field>
        <Field label={t('g.for')}><select value={d.for} onChange={(e) => setD({ ...d, for: e.target.value as GearOwner })}>{(['gijs', 'coen', 'shared'] as const).map((o) => <option key={o} value={o}>{t(`g.owner.${o}`)}</option>)}</select></Field>
        <Field label={t('g.statusLabel')}><select value={d.status} onChange={(e) => setD({ ...d, status: e.target.value as WishItem['status'] })}>{(['idea', 'saving', 'ordered', 'dropped'] as const).map((s) => <option key={s} value={s}>{t(`g.wstatus.${s}`)}</option>)}</select></Field>
        <Field label="Link"><input value={d.link ?? ''} onChange={(e) => setD({ ...d, link: e.target.value || undefined })} /></Field>
      </div>
      <Field label={t('g.why')}><input value={d.reason ?? ''} onChange={(e) => setD({ ...d, reason: e.target.value || undefined })} /></Field>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

export function GearSettings() {
  const { t } = useI18n();
  const toast = useToast();
  const { settings, updateSettings } = useSession();
  const num = (k: 'gearTrailerMaxKg' | 'gearTrailerEmptyKg' | 'gearBufferMinutes' | 'gearSafetyMonths' | 'gearSafetyMonthsPower', label: string, hint?: string) => (
    <Field label={label} hint={hint}><input inputMode="numeric" value={settings[k] ?? ''} onChange={(e) => updateSettings({ [k]: e.target.value === '' && k === 'gearTrailerEmptyKg' ? undefined : Number(e.target.value) || 0 })} /></Field>
  );
  const itemsCount = useLiveQuery(() => db.gearItems.count(), []) ?? 0;
  return (
    <div>
      <div className="page-head"><h1>{t('g.settingsTitle')}</h1></div>
      <div className="dash">
        <Section title={t('g.trailerSection')}>
          <div className="stack">
            {num('gearTrailerMaxKg', t('g.trailerMax'), t('g.trailerMaxHint'))}
            {num('gearTrailerEmptyKg', t('g.trailerEmptyKg'), t('g.trailerEmptyHint'))}
            {num('gearBufferMinutes', t('g.buffer'), t('g.bufferHint'))}
          </div>
        </Section>
        <Section title={t('g.safety')}>
          <div className="stack">
            <label className="check"><input type="checkbox" checked={settings.gearSafetyTests} onChange={(e) => updateSettings({ gearSafetyTests: e.target.checked })} />{t('g.safetyOn')}</label>
            {settings.gearSafetyTests && <>{num('gearSafetyMonths', t('g.safetyMonths'))}{num('gearSafetyMonthsPower', t('g.safetyMonthsPower'))}</>}
            <p className="tiny muted">{t('g.safetyHint')}</p>
          </div>
        </Section>
        <Section title={t('g.importExport')}>
          <div className="stack">
            <p className="small muted">{t('g.importHint', { n: itemsCount })}</p>
            <button className="btn" onClick={async () => { const r = await importGearCsv(starterCsv); toast(t('g.importedSkipped', { n: r.added, s: r.skipped, u: r.updated })); }}>{t('g.importStarter')}</button>
            <label className="btn">{t('g.importFile')}<input type="file" accept=".csv,text/csv" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) { const r = await importGearCsv(await f.text()); toast(t('g.importedSkipped', { n: r.added, s: r.skipped, u: r.updated })); } e.target.value = ''; }} /></label>
            <button className="btn" onClick={async () => download(`gear-list-${todayStr()}.csv`, await exportGearCsv(), 'text/csv')}>{t('g.exportCsv')}</button>
          </div>
        </Section>
      </div>
    </div>
  );
}
