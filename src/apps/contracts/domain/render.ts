import type {
  CancellationRow, Clause, ClientKind, Contract, ContractSnapshot, ContractTemplate, Gig, Lang, PartySnapshot, Quote, Rider, Settings, Venue,
} from '../../../core/types';
import { translate } from '../../../core/i18n';
import { euro, fmtDate } from '../../../core/format';
import { addDays, daysBetween, parseDate, toDateStr } from '../../../core/dates';
import { cancellationPct, lineNet, quoteTotals } from '../../invoicing/domain/money';
import { renderTerms, TERMS_VERSION } from '../../invoicing/terms';

// Pure contract logic: which clauses apply, filling in placeholders, the
// cancellation table with real dates, warnings, diffs for addenda and the
// content hash. No database access here, so it is fully unit-tested.

// ---------------------------------------------------------------------------
// Clause selection

export interface ClauseState { clause: Clause; on: boolean; locked: boolean; inTemplate: boolean }

export interface ClauseContext { clientKind: ClientKind; outdoor: boolean; setup: boolean }

/** Latest active version per clause key. */
export function currentClauses(all: Clause[]): Clause[] {
  const byKey = new Map<string, Clause>();
  for (const c of all) {
    if (c.deletedAt) continue;
    const cur = byKey.get(c.key);
    if (!cur || c.version > cur.version) byKey.set(c.key, c);
  }
  return [...byKey.values()].filter((c) => c.active).sort((a, b) => a.sort - b.sort);
}

/** Template order first, then every other clause (off). Clauses that don't fit the client kind are left out. */
export function clauseStates(template: ContractTemplate | undefined, clauses: Clause[], ctx: ClauseContext, overrides: Record<string, boolean> = {}): ClauseState[] {
  const byKey = new Map(clauses.map((c) => [c.key, c]));
  const out: ClauseState[] = [];
  const seen = new Set<string>();
  const cond = (w?: string) => (w === 'outdoor' ? ctx.outdoor : w === 'setup' ? ctx.setup : w === 'consumer' ? ctx.clientKind === 'consumer' : w === 'business' ? ctx.clientKind === 'business' : true);
  for (const tc of template?.clauses ?? []) {
    const c = byKey.get(tc.key);
    if (!c || seen.has(c.key)) continue;
    seen.add(c.key);
    if (c.only && c.only !== ctx.clientKind) continue;
    const locked = tc.mode === 'required' || !!c.locked;
    const dflt = tc.mode === 'required' || tc.mode === 'on' || (tc.mode === 'auto' && cond(tc.when));
    out.push({ clause: c, locked, inTemplate: true, on: locked ? true : (overrides[c.key] ?? dflt) });
  }
  for (const c of clauses) {
    if (seen.has(c.key) || (c.only && c.only !== ctx.clientKind)) continue;
    // Locked clauses are always part of an agreement, even if a template forgot them.
    out.push({ clause: c, locked: !!c.locked, inTemplate: false, on: c.locked ? true : (overrides[c.key] ?? false) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cancellation table with real dates

export function cancellationRows(scale: { daysBefore: number; pct: number }[], gigDate: string | undefined, issuedOn: string): CancellationRow[] {
  const sorted = [...scale].sort((a, b) => b.daysBefore - a.daysBefore);
  if (!gigDate) return sorted.map((r) => ({ pct: r.pct, daysBefore: r.daysBefore }));
  const g = parseDate(gigDate);
  const rows: CancellationRow[] = sorted.map((r, i) => ({
    pct: r.pct, daysBefore: r.daysBefore,
    until: toDateStr(addDays(g, -r.daysBefore)),
    from: i === 0 ? undefined : toDateStr(addDays(g, -sorted[i - 1].daysBefore + 1)),
  }));
  // Bands that already lie in the past cannot apply any more.
  const kept = rows.filter((r) => !r.until || r.until >= issuedOn);
  if (kept.length && kept[0].from && kept[0].from <= issuedOn) kept[0] = { ...kept[0], from: undefined };
  return kept.length ? kept : rows.slice(-1);
}

export function cancellationText(rows: CancellationRow[], lang: Lang): string {
  const d = (s?: string) => fmtDate(s, lang, { day: 'numeric', month: 'long', year: 'numeric' });
  return rows.map((r, i) => {
    const last = i === rows.length - 1 && r.daysBefore === 0;
    if (!r.until) {
      return lang === 'nl'
        ? `- ${r.daysBefore === 0 ? 'minder dan ' + (rows[i - 1]?.daysBefore ?? 0) + ' dagen voor het optreden' : r.daysBefore + ' dagen of meer voor het optreden'}: ${r.pct}%`
        : `- ${r.daysBefore === 0 ? 'less than ' + (rows[i - 1]?.daysBefore ?? 0) + ' days before the performance' : r.daysBefore + ' days or more before the performance'}: ${r.pct}%`;
    }
    if (!r.from) return lang === 'nl' ? `- ${last ? 'vanaf nu tot en met de dag zelf' : 'tot en met ' + d(r.until)}: ${r.pct}%` : `- ${last ? 'from now up to and including the day itself' : 'up to and including ' + d(r.until)}: ${r.pct}%`;
    if (last) return lang === 'nl' ? `- vanaf ${d(r.from)}, ook op de dag zelf: ${r.pct}%` : `- from ${d(r.from)}, including the day itself: ${r.pct}%`;
    return lang === 'nl' ? `- ${d(r.from)} tot en met ${d(r.until)}: ${r.pct}%` : `- ${d(r.from)} up to and including ${d(r.until)}: ${r.pct}%`;
  }).join('\n');
}

/** Fee percentage for a cancellation received on `cancelDate`, using the frozen rows of the signed version. */
export function cancellationFeePct(rows: CancellationRow[], gigDate: string, cancelDate: string) {
  return cancellationPct(rows.map((r) => ({ daysBefore: r.daysBefore, pct: r.pct })), gigDate, cancelDate);
}

export function scaleFor(kind: ClientKind, s: Settings) {
  return kind === 'consumer' && s.cancellationScaleConsumer?.length ? s.cancellationScaleConsumer : s.cancellationScale;
}

// ---------------------------------------------------------------------------
// Placeholders

export function fill(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, k: string) => (k in values ? values[k] : m));
}

export const unresolved = (text: string) => [...text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]);

// ---------------------------------------------------------------------------
// Snapshot

export interface SnapshotInput {
  contract: Pick<Contract, 'number' | 'clientKind' | 'language' | 'clauseOverrides' | 'specialTerms' | 'overtimeRate'>;
  gig: Gig;
  venue?: Venue;
  quote?: Quote;
  template?: ContractTemplate;
  clauses: Clause[];          // current versions
  rider?: Rider;
  settings: Settings;
  client: PartySnapshot;
  today: string;              // yyyy-mm-dd
  termsSha256: string;
  memberNames: Record<string, string>;
}

export function isOutdoor(g: Pick<Gig, 'setting'>) { return g.setting === 'outdoor' || g.setting === 'both'; }

function vatNote(s: Settings, lang: Lang) {
  if (s.vatMode === 'kor') return lang === 'en' ? translate('en', 'pdf.noteKor') : s.noteKor;
  if (s.vatMode === 'private') return lang === 'en' ? translate('en', 'pdf.notePrivate') : s.notePrivate;
  return translate(lang, 'ct.vatIncluded');
}

export function funqtionParty(s: Settings): ContractSnapshot['funqtion'] {
  return {
    name: s.businessName, legalNames: s.legalNames, address: [s.address, [s.postcode, s.city].filter(Boolean).join(' ')].filter(Boolean).join('\n'),
    email: s.bizEmail, phone: s.bizPhone, kvk: s.vatMode !== 'private' ? s.kvk : undefined, website: s.website,
  };
}

export function buildSnapshot(inp: SnapshotInput): ContractSnapshot {
  const { gig, venue, quote, settings: s, contract } = inp;
  const lang = contract.language;
  const t = (k: Parameters<typeof translate>[1], p?: Record<string, string | number>) => translate(lang, k, p);
  const accepted = quote?.status === 'accepted';
  const counted = quote ? quote.lines.filter((l) => !l.optional || l.selected) : [];
  const extras = quote && !accepted ? quote.lines.filter((l) => l.optional && !l.selected) : [];
  const total = quote ? quoteTotals(quote).total : (gig.agreedFee ?? 0) + (gig.travelFee ?? 0);
  const totalAll = quote ? quoteTotals(quote, true).total : total;
  const depositPct = quote?.depositPct ?? s.depositPct;
  const depositAmount = Math.round((total * depositPct) / 100);
  const overtimeRate = contract.overtimeRate ?? s.overtimeRateHalfHour;
  const performers = gig.performers.map((m) => inp.memberNames[m] ?? m).join(' & ');
  const sets = (gig.setSlots.length ? gig.setSlots : [{ id: 'x', start: gig.startTime, end: gig.endTime, performers: gig.performers }])
    .map((x) => ({ start: x.start, end: x.end, label: 'label' in x ? x.label : undefined, performers: x.performers.map((m) => inp.memberNames[m] ?? m).join(' & ') || performers }));
  const venueAddress = venue ? [venue.street, [venue.postcode, venue.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') : '';
  const services = counted.length
    ? counted.map((l) => ({ description: l.description, qty: l.unit === 'flat' && l.quantity === 1 ? '' : `${String(l.quantity).replace('.', lang === 'nl' ? ',' : '.')} ${t(`unit.${l.unit}`)}`, amount: lineNet(l) }))
    : [{ description: t('ct.defaultService'), qty: '', amount: total }];
  const rows = cancellationRows(scaleFor(contract.clientKind, s), gig.date || undefined, inp.today);
  const states = clauseStates(inp.template, inp.clauses, { clientKind: contract.clientKind, outdoor: isOutdoor(gig), setup: gig.setupRequired }, contract.clauseOverrides);
  const enabled = states.filter((x) => x.on);
  const nrs = new Map(enabled.map((x, i) => [x.clause.key, i + 1]));
  const values: Record<string, string> = {
    gigDate: fmtDate(gig.date, lang, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    venue: venue ? [venue.name, venueAddress].filter(Boolean).join(', ') : t('ct.venueTbd'),
    services: services.map((x) => `- ${x.description}${x.qty ? ` (${x.qty})` : ''}`).join('\n'),
    sets: sets.map((x) => `- ${x.start}–${x.end}${x.label ? ` ${x.label}` : ''}${x.performers ? ` · ${x.performers}` : ''}`).join('\n'),
    setupTime: gig.setupTime || t('ct.byArrangement'),
    total: euro(total, lang),
    vatNote: vatNote(s, lang),
    depositAmount: euro(depositAmount, lang),
    depositPct: String(depositPct),
    balance: euro(total - depositAmount, lang),
    paymentTermDays: String(s.paymentTermDays),
    overtimeRate: euro(overtimeRate, lang),
    cancellationTable: cancellationText(rows, lang),
    termsVersion: TERMS_VERSION,
    funqtionNames: s.legalNames || t('ct.defaultNames'),
    noiseLimit: venue?.soundLimitDb ? t('ct.noiseLimit', { db: venue.soundLimitDb }) : t('ct.noiseLimitUnknown'),
    curfew: venue?.curfew ? t('ct.curfew', { time: venue.curfew }) : t('ct.curfewUnknown'),
    performersCount: String(gig.performers.length || 2),
  };
  for (const [k, n] of nrs) values[`ref.${k}`] = String(n);
  const pickBody = (c: Clause) => (contract.clientKind === 'business' && (lang === 'en' ? c.bodyBizEn : c.bodyBizNl)) || (lang === 'en' ? c.bodyEn : c.bodyNl);
  const termsSource = lang === 'en' ? s.termsEn : s.termsNl;
  const riderFill = (x: string) => fill(x, values);
  return {
    language: lang,
    clientKind: contract.clientKind,
    number: contract.number,
    issuedOn: inp.today,
    client: inp.client,
    funqtion: funqtionParty(s),
    event: {
      title: gig.title, reference: gig.reference, date: gig.date, startTime: gig.startTime, endTime: gig.endTime, setupTime: gig.setupTime,
      venueName: venue?.name ?? '', venueAddress, outdoor: isOutdoor(gig), sets,
    },
    services,
    extras: extras.map((l) => ({ id: l.id, description: l.description, amount: lineNet(l) })),
    price: { total, totalWithAllExtras: totalAll, vatNote: values.vatNote, depositPct, depositAmount, balance: total - depositAmount, paymentTermDays: s.paymentTermDays, overtimeRate },
    cancellation: rows,
    intro: (lang === 'en' ? inp.template?.introEn : inp.template?.introNl) ?? '',
    specialTerms: contract.specialTerms?.trim() ?? '',
    clauses: enabled.map((x) => ({ key: x.clause.key, version: x.clause.version, nr: nrs.get(x.clause.key)!, title: lang === 'en' ? x.clause.titleEn : x.clause.titleNl, body: fill(pickBody(x.clause), values) })),
    rider: inp.rider ? {
      name: inp.rider.name, version: inp.rider.version,
      technical: inp.rider.technical.map((x) => riderFill(lang === 'en' ? x.en : x.nl)),
      hospitality: inp.rider.hospitality.map((x) => riderFill(lang === 'en' ? x.en : x.nl)),
      venueNotes: [venue?.loadInNotes, venue?.parkingNotes, venue?.powerNotes].filter((x): x is string => !!x),
    } : null,
    terms: { version: TERMS_VERSION, sha256: inp.termsSha256, text: termsSource ? renderTerms(termsSource, s, lang) : '' },
    quote: quote ? { id: quote.id, number: quote.number, version: quote.version, accepted } : undefined,
  };
}

export function termsTextFor(s: Settings, lang: Lang) {
  const src = lang === 'en' ? s.termsEn : s.termsNl;
  return src ? renderTerms(src, s, lang) : '';
}

// ---------------------------------------------------------------------------
// Warnings shown in the editor (they don't block sending, except placeholders)

export interface Warning { key: 'noClientAddress' | 'noClientEmail' | 'noVenue' | 'noDate' | 'noQuote' | 'outdoorNoCover' | 'zeroPrice' | 'noLegalNames' | 'placeholder' | 'quoteNotAccepted'; detail?: string; blocking?: boolean }

export function warningsFor(snap: ContractSnapshot, ctx: { flow: Contract['flow']; legalNames?: string; hasVenue: boolean }): Warning[] {
  const w: Warning[] = [];
  if (!snap.event.date) w.push({ key: 'noDate', blocking: true });
  if (snap.clientKind === 'consumer' && !snap.client.address) w.push({ key: 'noClientAddress' });
  if (!snap.client.email) w.push({ key: 'noClientEmail' });
  if (!ctx.hasVenue) w.push({ key: 'noVenue' });
  if (!snap.quote) w.push({ key: 'noQuote' });
  if (snap.quote && !snap.quote.accepted && ctx.flow === 'after_quote') w.push({ key: 'quoteNotAccepted' });
  if (snap.event.outdoor && !snap.clauses.some((c) => c.key === 'G4')) w.push({ key: 'outdoorNoCover' });
  if (!snap.price.total) w.push({ key: 'zeroPrice' });
  if (!ctx.legalNames) w.push({ key: 'noLegalNames' });
  const left = new Set(snap.clauses.flatMap((c) => unresolved(c.body)));
  for (const k of left) w.push({ key: 'placeholder', detail: k, blocking: true });
  return w;
}

// ---------------------------------------------------------------------------
// Addendum diff

export function snapshotDiff(a: ContractSnapshot, b: ContractSnapshot): { field: string; old: string; new: string }[] {
  const lang = b.language;
  const sets = (s: ContractSnapshot) => s.event.sets.map((x) => `${x.start}–${x.end}${x.performers ? ` (${x.performers})` : ''}`).join(', ');
  const fields: [string, (s: ContractSnapshot) => string][] = [
    ['date', (s) => fmtDate(s.event.date, lang, { day: 'numeric', month: 'long', year: 'numeric' })],
    ['venue', (s) => [s.event.venueName, s.event.venueAddress].filter(Boolean).join(', ')],
    ['sets', sets],
    ['setup', (s) => s.event.setupTime ?? ''],
    ['services', (s) => s.services.map((x) => x.description + (x.qty ? ` (${x.qty})` : '')).join('; ')],
    ['total', (s) => euro(s.price.total, lang)],
    ['deposit', (s) => euro(s.price.depositAmount, lang)],
    ['overtime', (s) => euro(s.price.overtimeRate, lang)],
    ['clauses', (s) => s.clauses.map((c) => c.title).join(', ')],
    ['special', (s) => s.specialTerms],
    ['rider', (s) => (s.rider ? `${s.rider.name} v${s.rider.version}` : '')],
    ['client', (s) => [s.client.name, s.client.address].filter(Boolean).join(', ')],
  ];
  return fields.map(([field, f]) => ({ field, old: f(a), new: f(b) })).filter((x) => x.old !== x.new);
}

// ---------------------------------------------------------------------------
// Content hash

/** JSON with sorted keys and no undefined values: the same content always gives the same string. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map((x) => canonical(x)).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

export async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const hashSnapshot = (s: ContractSnapshot) => sha256Hex(canonical(s));
export const shortHash = (h?: string) => (h ? `${h.slice(0, 8)}…${h.slice(-4)}` : '');

export function signByDate(today: string, days: number, gigDate?: string) {
  let d = toDateStr(addDays(parseDate(today), days));
  if (gigDate) {
    const latest = toDateStr(addDays(parseDate(gigDate), -2));
    if (latest < d) d = latest < today ? today : latest;
  }
  return d;
}

export const daysUntil = (date: string, today: string) => daysBetween(parseDate(today), parseDate(date));
