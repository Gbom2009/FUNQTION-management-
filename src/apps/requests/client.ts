import PocketBase from 'pocketbase';
import type { QueueItem } from './domain';

// Connection to your Requests server (PocketBase on your home server, reached
// via Cloudflare Tunnel or Tailscale Funnel). Settings are per device.

const KEY = 'fq-requests-server';
let pb: PocketBase | null = null;

export function serverUrl(): string {
  try { return localStorage.getItem(KEY) ?? ''; } catch { return ''; }
}
export function setServerUrl(url: string) {
  try { localStorage.setItem(KEY, url.replace(/\/+$/, '')); } catch { /* private mode */ }
  pb = null;
}
export function client(): PocketBase | null {
  const url = serverUrl();
  if (!url) return null;
  if (!pb) pb = new PocketBase(url);
  return pb;
}
export const loggedIn = () => !!client()?.authStore.isValid;

export async function login(email: string, password: string) {
  const c = client();
  if (!c) throw new Error('no_server');
  await c.collection('users').authWithPassword(email, password);
}
export function logout() { client()?.authStore.clear(); }

export interface SessionRec {
  id: string; code: string; gigId: string; title: string; status: 'open' | 'paused' | 'closed';
  rules: Record<string, unknown>; wedding: { names?: string; wishes?: string[]; priorityCode?: string } | null; nowPlaying: { artist: string; title: string } | null;
}

export async function sessionsForGig(gigId: string): Promise<SessionRec[]> {
  const c = client()!;
  return c.collection('sessions').getFullList<SessionRec>({ filter: c.filter('gigId = {:g}', { g: gigId }), sort: '-created', fields: 'id,code,gigId,title,status,rules,wedding,nowPlaying' });
}

export async function createSession(p: Omit<SessionRec, 'id'> & { libraryIndex: unknown }): Promise<SessionRec> {
  return client()!.collection('sessions').create<SessionRec>(p);
}
export async function updateSession(id: string, p: Partial<SessionRec> & { libraryIndex?: unknown; closedAt?: string }) {
  return client()!.collection('sessions').update<SessionRec>(id, p);
}

export async function queue(sessionId: string): Promise<QueueItem[]> {
  const r = await client()!.send<{ items: QueueItem[] }>(`/api/fq/dj/requests/${sessionId}`, { method: 'GET' });
  return r.items;
}
export async function act(id: string, action: 'accept' | 'later' | 'decline' | 'played' | 'reopen' | 'block' | 'block_artist' | 'approve_shout' | 'reject_shout') {
  return client()!.send('/api/fq/dj/act', { method: 'POST', body: { id, action } });
}

/** Live: call `onChange` when anything in this session's requests changes. */
export async function watch(sessionId: string, onChange: () => void): Promise<() => void> {
  const c = client()!;
  return c.collection('requests').subscribe('*', onChange, { filter: c.filter('session = {:s}', { s: sessionId }) });
}

export const guestUrl = (code: string) => `${serverUrl()}/?c=${code}`;
