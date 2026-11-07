import type { Key } from '../core/i18n';

// Registry of every app in the Funqtion suite. Each app lives in
// src/apps/<id>/ and is developed on its own branch; adding it here makes it
// appear on the hub. `path` is set once the app is live.
export interface AppEntry {
  id: string;
  name: Key;
  desc: Key;
  path?: string;
}

export const APPS: AppEntry[] = [
  { id: 'bookings', name: 'app.bookings', desc: 'app.bookings.desc', path: '/bookings' },
  { id: 'invoicing', name: 'app.invoicing', desc: 'app.invoicing.desc', path: '/invoicing' },
  { id: 'accounting', name: 'app.accounting', desc: 'app.accounting.desc', path: '/money' },
  { id: 'contracts', name: 'app.contracts', desc: 'app.contracts.desc', path: '/contracts' },
  { id: 'gigday', name: 'app.gigday', desc: 'app.gigday.desc', path: '/gigday' },
  { id: 'gear', name: 'app.gear', desc: 'app.gear.desc', path: '/gear' },
  { id: 'portal', name: 'app.portal', desc: 'app.portal.desc' },
  { id: 'navigation', name: 'app.navigation', desc: 'app.navigation.desc', path: '/maps' },
];
