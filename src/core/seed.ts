import { db } from './db';
import { save, uid } from './repo';
import { DEFAULT_SETTINGS, type Member, type Product, type Template } from './types';
import { DEFAULT_TEMPLATES } from '../apps/bookings/domain/messaging';

export const DEFAULT_MEMBERS: Member[] = [
  { id: 'gijs', name: 'Gijs', color: '#f68712' },
  { id: 'coen', name: 'Coen', color: '#5aa9ff' },
];

/** First-run setup: members, settings, templates and a starter price list. */
export async function ensureSeed() {
  if ((await db.members.count()) === 0) await db.members.bulkPut(DEFAULT_MEMBERS);
  const s = await db.settings.get('settings');
  await db.settings.put({ ...DEFAULT_SETTINGS, ...(s ?? {}) });
  if ((await db.templates.count()) === 0) {
    for (const t of DEFAULT_TEMPLATES) await save<Template>('templates', { ...t }, { actor: 'system' });
  }
  if ((await db.products.count()) === 0) {
    const starter: Omit<Product, 'id' | 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>[] = [
      { name: 'DJ-set per uur', unit: 'hour', price: 15000, vatRate: 0, active: true },
      { name: 'Geluidsset', unit: 'flat', price: 15000, vatRate: 0, active: true },
      { name: 'Lichtset', unit: 'flat', price: 10000, vatRate: 0, active: true },
      { name: 'Extra uur', unit: 'hour', price: 12500, vatRate: 0, active: true },
      { name: 'Reiskosten per km', unit: 'km', price: 30, vatRate: 0, active: true },
    ];
    for (const p of starter) await save<Product>('products', { ...p, id: uid() }, { actor: 'system' });
  }
}
