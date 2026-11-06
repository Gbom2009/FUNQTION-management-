import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import { setActor } from './repo';
import { ensureSeed } from './seed';
import { DEFAULT_SETTINGS, type Member, type MemberId, type Settings } from './types';
import { I18nProvider } from './i18n';
import { runTaskSync } from '../apps/bookings/domain/taskSync';

// Local "accounts": Gijs and Coen each have a profile with an optional PIN.
// The PIN is a privacy lock for a shared device, not server-grade security;
// real accounts arrive with the self-hosted server.

const KEY = 'fq.member';

export async function hashPin(pin: string, salt: string) {
  const data = new TextEncoder().encode(`${salt}:${pin}`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

interface SessionCtx {
  me: Member | null;
  members: Member[];
  settings: Settings;
  locked: boolean;
  login: (id: MemberId, pin?: string) => Promise<boolean>;
  logout: () => void;
  updateSettings: (s: Partial<Settings>) => Promise<void>;
  memberName: (id?: string) => string;
}

const Ctx = createContext<SessionCtx | null>(null);

function readStored(): MemberId | null {
  try { const v = localStorage.getItem(KEY); return v === 'gijs' || v === 'coen' ? v : null; } catch { return null; }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [meId, setMeId] = useState<MemberId | null>(readStored);
  const [unlocked, setUnlocked] = useState(false);
  const members = useLiveQuery(() => db.members.toArray(), []) ?? [];
  const settings = useLiveQuery(() => db.settings.get('settings'), []) ?? DEFAULT_SETTINGS;

  useEffect(() => {
    ensureSeed().then(() => setReady(true));
    navigator.storage?.persist?.().catch(() => undefined);
  }, []);

  const me = members.find((m) => m.id === meId) ?? null;
  const locked = !me || (!!me.pinHash && !unlocked);

  useEffect(() => { setActor(me && !locked ? me.id : 'system'); }, [me, locked]);

  // Reminder engine: on start, then every 5 minutes.
  useEffect(() => {
    if (!ready || locked) return;
    runTaskSync();
    const iv = setInterval(() => runTaskSync(), 5 * 60_000);
    return () => clearInterval(iv);
  }, [ready, locked]);

  // Theme
  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', settings.theme);
    root.lang = settings.language;
  }, [settings.theme, settings.language]);

  const value = useMemo<SessionCtx>(() => ({
    me, members, settings, locked,
    async login(id, pin) {
      const m = await db.members.get(id);
      if (!m) return false;
      if (m.pinHash) {
        if (!pin || (await hashPin(pin, m.pinSalt ?? '')) !== m.pinHash) return false;
      }
      try { localStorage.setItem(KEY, id); } catch { /* private mode */ }
      setMeId(id);
      setUnlocked(true);
      return true;
    },
    logout() {
      try { localStorage.removeItem(KEY); } catch { /* ignore */ }
      setUnlocked(false);
      setMeId(null);
    },
    async updateSettings(s) {
      const cur = (await db.settings.get('settings')) ?? DEFAULT_SETTINGS;
      await db.settings.put({ ...cur, ...s, key: 'settings' });
    },
    memberName(id) {
      if (id === 'both') return members.map((m) => m.name).join(' + ');
      if (id === 'system') return 'Funqtion';
      return members.find((m) => m.id === id)?.name ?? id ?? '';
    },
  }), [me, members, settings, locked]);

  if (!ready) return null;
  return (
    <Ctx.Provider value={value}>
      <I18nProvider lang={settings.language}>{children}</I18nProvider>
    </Ctx.Provider>
  );
}

export function useSession() {
  const c = useContext(Ctx);
  if (!c) throw new Error('SessionProvider missing');
  return c;
}
