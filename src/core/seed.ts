import { db } from './db';
import { save, uid } from './repo';
import { DEFAULT_SETTINGS, type Member, type Package, type Product, type Template } from './types';
import { DEFAULT_TEMPLATES } from '../apps/bookings/domain/messaging';
import { TERMS_EN, TERMS_NL } from '../apps/invoicing/terms';

export const DEFAULT_MEMBERS: Member[] = [
  { id: 'gijs', name: 'Gijs', color: '#f68712' },
  { id: 'coen', name: 'Coen', color: '#5aa9ff' },
];

/** First-run setup: members, settings, templates and a starter price list. */
export async function ensureSeed() {
  if ((await db.members.count()) === 0) await db.members.bulkPut(DEFAULT_MEMBERS);
  const s = await db.settings.get('settings');
  const merged = { ...DEFAULT_SETTINGS, ...(s ?? {}) };
  if (!merged.termsNl) merged.termsNl = TERMS_NL;
  if (!merged.termsEn) merged.termsEn = TERMS_EN;
  await db.settings.put(merged);
  // Add any default template whose kind+language is missing (also after updates).
  const existing = await db.templates.toArray();
  for (const t of DEFAULT_TEMPLATES) {
    if (!existing.some((e) => e.kind === t.kind && e.language === t.language)) await save<Template>('templates', { ...t }, { actor: 'system' });
  }
  if ((await db.products.count()) === 0) {
    type P = Omit<Product, 'id' | 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>;
    const starter: (P & { key: string })[] = [
      { key: 'dj', name: 'DJ-set per uur', nameEn: 'DJ set per hour', category: 'performance', unit: 'hour', price: 15000, vatRate: 21, active: true },
      { key: 'sound', name: 'Geluidsset', nameEn: 'Sound system', category: 'sound', unit: 'flat', price: 15000, vatRate: 21, active: true },
      { key: 'light', name: 'Lichtset', nameEn: 'Lighting', category: 'light', unit: 'flat', price: 10000, vatRate: 21, active: true },
      { key: 'laser', name: 'Lasers & effecten', nameEn: 'Lasers & effects', category: 'effects', unit: 'flat', price: 12500, vatRate: 21, active: true, optionalByDefault: true },
      { key: 'extra', name: 'Extra uur', nameEn: 'Extra hour', category: 'extra', unit: 'hour', price: 12500, vatRate: 21, active: true, optionalByDefault: true },
      { key: 'early', name: 'Vroege opbouw', nameEn: 'Early set-up', category: 'extra', unit: 'flat', price: 5000, vatRate: 21, active: true, optionalByDefault: true },
      { key: 'km', name: 'Reiskosten per km', nameEn: 'Travel costs per km', category: 'travel', unit: 'km', price: 30, vatRate: 21, active: true },
    ];
    const ids: Record<string, string> = {};
    for (const { key, ...p } of starter) ids[key] = (await save<Product>('products', { ...p, id: uid() }, { actor: 'system' })).id;
    if ((await db.packages.count()) === 0) {
      await save<Package>('packages', { name: 'Bruiloft compleet', eventTypes: ['wedding', 'private_party', 'company'], active: true,
        items: [{ productId: ids.dj, quantity: 5 }, { productId: ids.sound, quantity: 1 }, { productId: ids.light, quantity: 1 },
          { productId: ids.laser, quantity: 1, optional: true }, { productId: ids.extra, quantity: 1, optional: true }, { productId: ids.km, quantity: 30 }] }, { actor: 'system' });
      await save<Package>('packages', { name: 'Dorpsfeest / tent', eventTypes: ['village_festival', 'carnival', 'festival'], active: true,
        items: [{ productId: ids.dj, quantity: 4 }, { productId: ids.km, quantity: 20 }, { productId: ids.light, quantity: 1, optional: true }] }, { actor: 'system' });
    }
  }
}
