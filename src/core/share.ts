import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';

// Local mode for client-facing pages (docs/stage-and-clients/PLAN.md §0.1):
// no server. The data a client needs travels *inside the link*, after the '#',
// which browsers never send to a web server. The client's answers come back
// as a WhatsApp/e-mail message with a code (FQ1:…) that the hub reads with
// "Plak antwoord".

export const DEFAULT_PUBLIC_URL = 'https://gbom2009.github.io/FUNQTION-management-/';

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

/** Compact, URL-safe encoding of any JSON value (deflate + base64url). */
export function encodePayload(v: unknown): string {
  return b64url(deflateSync(strToU8(JSON.stringify(v)), { level: 9 }));
}
export function decodePayload<T>(s: string): T | null {
  try { return JSON.parse(strFromU8(inflateSync(unb64url(s.trim())))) as T; } catch { return null; }
}

/** A page of the public part of the hub, e.g. #/f/<data> (feedback) or #/c/<data> (client portal). */
export function publicLink(base: string | undefined, kind: 'f' | 'c', data: unknown): string {
  const b = (base || DEFAULT_PUBLIC_URL).replace(/#.*$/, '').replace(/\/?$/, '/');
  return `${b}#/${kind}/${encodePayload(data)}`;
}

// ---- Answers back ----------------------------------------------------------

export const ANSWER_PREFIX = 'FQ1:';
export interface Answer { k: string; g: string; at: string; [key: string]: unknown }

/** The code line that goes at the end of the client's message. */
export function answerCode(a: Answer): string {
  return ANSWER_PREFIX + encodePayload(a);
}

/** Find every answer code in pasted text (a whole WhatsApp chat is fine). */
export function readAnswers(text: string): Answer[] {
  const out: Answer[] = [];
  // Messengers may wrap long codes over several lines: join lines that continue a code.
  const joined = text.replace(new RegExp(`(${ANSWER_PREFIX}[A-Za-z0-9_-]+)\\s*\\n\\s*(?=[A-Za-z0-9_-]{8,}\\s*(?:\\n|$))`, 'g'), '$1');
  for (const m of joined.matchAll(/FQ1:([A-Za-z0-9_-]+)/g)) {
    const a = decodePayload<Answer>(m[1]);
    if (a && typeof a.k === 'string' && typeof a.g === 'string') out.push(a);
  }
  return out;
}
