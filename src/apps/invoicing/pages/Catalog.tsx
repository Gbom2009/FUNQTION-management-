import { useState } from 'react';
import { useI18n } from '../../../core/i18n';
import { Field, Section } from '../../../core/ui';
import { centsFromInput, euro, inputFromCents } from '../../../core/format';
import { save, softDelete } from '../../../core/repo';
import { EVENT_TYPES, type Package, type Product } from '../../../core/types';
import { useSession } from '../../../core/session';
import { usePackages, useProducts } from '../data';

const CATS = ['performance', 'sound', 'light', 'effects', 'travel', 'extra', 'fee', 'other'] as const;

export default function Catalog() {
  const { t } = useI18n();
  const [tab, setTab] = useState<'items' | 'packages'>('items');
  return (
    <div>
      <div className="page-head"><h1>{t('inv.catalog')}</h1></div>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'items'} onClick={() => setTab('items')}>{t('c.items')}</button>
        <button role="tab" aria-selected={tab === 'packages'} onClick={() => setTab('packages')}>{t('c.packages')}</button>
      </div>
      {tab === 'items' ? <Items /> : <Packages />}
    </div>
  );
}

function Items() {
  const { t } = useI18n();
  const { settings } = useSession();
  const products = useProducts().sort((a, b) => (a.category ?? 'z').localeCompare(b.category ?? 'z') || a.name.localeCompare(b.name));
  const upd = (p: Product, c: Partial<Product>) => save<Product>('products', { ...p, ...c });
  return (
    <Section actions={<button className="btn small" onClick={() => save<Product>('products', { name: '', unit: 'flat', price: 0, vatRate: 21, active: true, category: 'extra' } as Product)}>+ {t('settings.newProduct')}</button>}>
      <div className="table-wrap">
        <table className="tbl">
          <thead><tr><th>{t('common.name')}</th><th>{t('c.nameEn')}</th><th>{t('c.category')}</th><th>{t('quote.unit')}</th><th>{t('quote.price')}</th>{settings.vatMode === 'vat' && <th>{t('quote.vat')}</th>}<th>{t('q.optional')}</th><th /></tr></thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id} style={{ opacity: p.active ? 1 : 0.5 }}>
                <td style={{ minWidth: 180 }}><input className="input" defaultValue={p.name} onBlur={(e) => e.target.value !== p.name && upd(p, { name: e.target.value })} aria-label={t('common.name')} /></td>
                <td style={{ minWidth: 150 }}><input className="input" defaultValue={p.nameEn ?? ''} onBlur={(e) => e.target.value !== (p.nameEn ?? '') && upd(p, { nameEn: e.target.value })} aria-label={t('c.nameEn')} /></td>
                <td style={{ width: 130 }}><select className="input" value={p.category ?? 'other'} onChange={(e) => upd(p, { category: e.target.value as Product['category'] })} aria-label={t('c.category')}>
                  {CATS.map((c) => <option key={c} value={c}>{t(`c.cat.${c}`)}</option>)}</select></td>
                <td style={{ width: 96 }}><select className="input" value={p.unit} onChange={(e) => upd(p, { unit: e.target.value as Product['unit'] })} aria-label={t('quote.unit')}>
                  {(['hour', 'piece', 'km', 'flat'] as const).map((u) => <option key={u} value={u}>{t(`unit.${u}`)}</option>)}</select></td>
                <td style={{ width: 110 }}><input className="input" inputMode="decimal" defaultValue={inputFromCents(p.price)} onBlur={(e) => upd(p, { price: centsFromInput(e.target.value) ?? 0 })} aria-label={t('quote.price')} /></td>
                {settings.vatMode === 'vat' && <td style={{ width: 80 }}><select className="input" value={p.vatRate} onChange={(e) => upd(p, { vatRate: Number(e.target.value) })} aria-label={t('quote.vat')}>{[21, 9, 0].map((r) => <option key={r} value={r}>{r}%</option>)}</select></td>}
                <td><input type="checkbox" checked={!!p.optionalByDefault} onChange={(e) => upd(p, { optionalByDefault: e.target.checked })} aria-label={t('c.optionalDefault')} /></td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn small ghost" onClick={() => upd(p, { active: !p.active })}>{p.active ? '●' : '○'}</button>
                  <button className="btn icon small" aria-label={t('common.delete')} onClick={() => softDelete('products', p.id)}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function Packages() {
  const { t, lang } = useI18n();
  const packages = usePackages();
  const products = useProducts().filter((p) => p.active);
  const upd = (p: Package, c: Partial<Package>) => save<Package>('packages', { ...p, ...c });
  return (
    <div>
      <div className="row" style={{ marginBottom: 'var(--s4)' }}>
        <button className="btn primary" onClick={() => save<Package>('packages', { name: t('c.newPackage'), eventTypes: [], items: [], active: true })}>+ {t('c.newPackage')}</button>
      </div>
      <div className="dash">
        {packages.map((p) => {
          const total = p.items.reduce((s, it) => s + (it.optional ? 0 : (products.find((x) => x.id === it.productId)?.price ?? 0) * it.quantity), 0);
          return (
            <Section key={p.id}>
              <div className="stack">
                <Field label={t('common.name')}><input defaultValue={p.name} onBlur={(e) => upd(p, { name: e.target.value })} /></Field>
                <Field label={t('c.description')}><input defaultValue={p.description ?? ''} onBlur={(e) => upd(p, { description: e.target.value })} /></Field>
                <div className="field"><span>{t('c.eventTypes')}</span>
                  <div className="chips">{EVENT_TYPES.map((e) => <button key={e} className="chip" aria-pressed={p.eventTypes.includes(e)}
                    onClick={() => upd(p, { eventTypes: p.eventTypes.includes(e) ? p.eventTypes.filter((x) => x !== e) : [...p.eventTypes, e] })}>{t(`event.${e}`)}</button>)}</div>
                </div>
                <div className="list">
                  {p.items.map((it, i) => {
                    const prod = products.find((x) => x.id === it.productId);
                    return (
                      <div key={i} className="list-item" style={{ flexWrap: 'wrap' }}>
                        <span className="grow">{prod?.name ?? '?'}</span>
                        <input className="input" style={{ width: 70 }} inputMode="decimal" defaultValue={String(it.quantity)} aria-label={t('quote.qty')}
                          onBlur={(e) => upd(p, { items: p.items.map((x, j) => (j === i ? { ...x, quantity: Number(e.target.value.replace(',', '.')) || 1 } : x)) })} />
                        <label className="check tiny" style={{ minHeight: 0 }}><input type="checkbox" checked={!!it.optional} onChange={(e) => upd(p, { items: p.items.map((x, j) => (j === i ? { ...x, optional: e.target.checked } : x)) })} />{t('q.optional')}</label>
                        <button className="btn icon small" aria-label={t('common.delete')} onClick={() => upd(p, { items: p.items.filter((_, j) => j !== i) })}>✕</button>
                      </div>
                    );
                  })}
                </div>
                <select className="input" value="" aria-label={t('c.addItem')} onChange={(e) => e.target.value && upd(p, { items: [...p.items, { productId: e.target.value, quantity: 1 }] })}>
                  <option value="">{t('c.addItem')}</option>{products.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
                <div className="row between"><span className="small">{t('c.packageTotal', { amount: euro(total, lang) })}</span>
                  <button className="btn small danger" onClick={() => softDelete('packages', p.id)}>{t('common.delete')}</button></div>
              </div>
            </Section>
          );
        })}
      </div>
    </div>
  );
}
