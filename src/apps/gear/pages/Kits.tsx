import { useState } from 'react';
import { useI18n } from '../../../core/i18n';
import { Field, Modal, Section, useToast } from '../../../core/ui';
import { save } from '../../../core/repo';
import { KIT_ROLES, type GearKit, type KitRole, type Product } from '../../../core/types';
import { useProducts } from '../../invoicing/data';
import { useGearItems, useGearKits } from '../data';

export default function Kits() {
  const { t } = useI18n();
  const kits = useGearKits().sort((a, b) => KIT_ROLES.indexOf(a.role) - KIT_ROLES.indexOf(b.role));
  const items = useGearItems();
  const products = useProducts().filter((p) => p.active);
  const [edit, setEdit] = useState<GearKit | null>(null);
  const byId = new Map(items.map((i) => [i.id, i]));
  return (
    <div>
      <div className="page-head"><h1>{t('g.kits')}</h1>
        <button className="btn primary" onClick={() => setEdit({ id: '', createdAt: '', createdBy: 'system', updatedAt: '', updatedBy: 'system', name: '', role: 'custom', lines: [] })}>+ {t('g.newKit')}</button></div>
      <p className="small muted" style={{ marginBottom: 'var(--s4)' }}>{t('g.kitsHint')}</p>
      <div className="dash">
        {kits.map((k) => (
          <Section key={k.id} title={k.name} actions={<button className="btn small" onClick={() => setEdit(k)}>{t('common.edit')}</button>}>
            <div className="tiny muted" style={{ marginBottom: 'var(--s2)' }}>{t(`g.role.${k.role}`)}</div>
            {k.lines.length === 0 ? <p className="small muted">{t('g.kitEmpty')}</p> : (
              <ul className="small">{k.lines.map((l) => { const it = byId.get(l.itemId); return <li key={l.itemId}>{l.qty > 1 ? `${l.qty}× ` : ''}{it?.name ?? '?'} <span className="muted mono tiny">{it?.code}</span></li>; })}</ul>
            )}
          </Section>
        ))}
      </div>
      <Section title={t('g.productKits')}>
        <p className="small muted">{t('g.productKitsHint')}</p>
        <div className="list">
          {products.map((p) => <ProductKitRow key={p.id} product={p} kits={kits} />)}
        </div>
      </Section>
      {edit && <KitEditor kit={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function ProductKitRow({ product, kits }: { product: Product; kits: GearKit[] }) {
  const ids = product.kitIds ?? [];
  const toggle = (id: string) => save<Product>('products', { ...product, kitIds: ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id] });
  return (
    <div className="list-item" style={{ flexWrap: 'wrap' }}>
      <span className="grow">{product.name}</span>
      <div className="chips">{kits.filter((k) => k.role !== 'always').map((k) => <button key={k.id} className="chip" aria-pressed={ids.includes(k.id)} onClick={() => toggle(k.id)}>{k.name}</button>)}</div>
    </div>
  );
}

function KitEditor({ kit, onClose }: { kit: GearKit; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const items = useGearItems().filter((i) => i.status !== 'disposed');
  const [d, setD] = useState(kit);
  const byId = new Map(items.map((i) => [i.id, i]));
  return (
    <Modal title={d.name || t('g.newKit')} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>{t('common.cancel')}</button>
      <button className="btn primary" disabled={!d.name.trim()} onClick={async () => { const { id, ...rest } = d; await save<GearKit>('gearKits', id ? d : rest); toast(t('common.saved')); onClose(); }}>{t('common.save')}</button></>}>
      <div className="grid2">
        <Field label={t('g.name')}><input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /></Field>
        <Field label={t('g.roleLabel')}><select value={d.role} onChange={(e) => setD({ ...d, role: e.target.value as KitRole })}>{KIT_ROLES.map((r) => <option key={r} value={r}>{t(`g.role.${r}`)}</option>)}</select></Field>
      </div>
      <div className="list">
        {d.lines.map((l, i) => (
          <div key={l.itemId} className="list-item">
            <span className="grow">{byId.get(l.itemId)?.name ?? '?'} <span className="tiny muted mono">{byId.get(l.itemId)?.code}</span></span>
            {byId.get(l.itemId)?.kind === 'counted' && <input className="input" style={{ width: 70 }} inputMode="numeric" value={l.qty} onChange={(e) => setD({ ...d, lines: d.lines.map((x, j) => (j === i ? { ...x, qty: Math.max(1, Number(e.target.value) || 1) } : x)) })} aria-label="qty" />}
            <button className="btn icon small ghost" aria-label={t('common.delete')} onClick={() => setD({ ...d, lines: d.lines.filter((_, j) => j !== i) })}>✕</button>
          </div>
        ))}
      </div>
      <select className="input" value="" aria-label={t('g.addItem')} onChange={(e) => { const it = byId.get(e.target.value); if (it) setD({ ...d, lines: [...d.lines, { itemId: it.id, qty: it.kind === 'counted' ? it.quantity : 1 }] }); }}>
        <option value="">+ {t('g.addItem')}</option>
        {items.filter((i) => !d.lines.some((l) => l.itemId === i.id)).sort((a, b) => a.name.localeCompare(b.name)).map((i) => <option key={i.id} value={i.id}>{i.code} {i.name}</option>)}
      </select>
    </Modal>
  );
}
