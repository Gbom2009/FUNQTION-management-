import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../core/db';
import { alive, nowIso, save, uid } from '../../core/repo';
import { todayStr } from '../../core/dates';
import { translate } from '../../core/i18n';
import {
  DEFAULT_SETTINGS, type Clause, type ClientKind, type Contract, type ContractEvent, type ContractFlow, type ContractSignature,
  type ContractSnapshot, type ContractTemplate, type ContractVersion, type Gig, type Invoice, type MemberId, type Quote, type Rider, type Settings,
} from '../../core/types';
import { runTaskSync } from '../bookings/domain/taskSync';
import {
  buildSnapshot, cancellationFeePct, clauseStates, currentClauses, hashSnapshot, isOutdoor, sha256Hex, signByDate, snapshotDiff, termsTextFor, warningsFor,
} from './domain/render';
import { DEFAULT_CLAUSES, DEFAULT_RIDERS, DEFAULT_TEMPLATES } from './domain/library';

const EMPTY: never[] = [];
export const useContracts = () => alive(useLiveQuery(() => db.contracts.toArray(), []) ?? EMPTY) as Contract[];
export const useAllClauses = () => alive(useLiveQuery(() => db.clauses.toArray(), []) ?? EMPTY) as Clause[];
export const useContractTemplates = () => alive(useLiveQuery(() => db.contractTemplates.toArray(), []) ?? EMPTY) as ContractTemplate[];
export const useRiders = () => alive(useLiveQuery(() => db.riders.toArray(), []) ?? EMPTY) as Rider[];
export const useVersions = (contractId?: string) =>
  alive(useLiveQuery(() => (contractId ? db.contractVersions.where('contractId').equals(contractId).toArray() : []), [contractId]) ?? EMPTY).sort((a, b) => a.seq - b.seq) as ContractVersion[];
export const useSignatures = (contractId?: string) =>
  alive(useLiveQuery(() => (contractId ? db.contractSignatures.where('contractId').equals(contractId).toArray() : []), [contractId]) ?? EMPTY) as ContractSignature[];
export const useEvents = (contractId?: string) =>
  alive(useLiveQuery(() => (contractId ? db.contractEvents.where('contractId').equals(contractId).toArray() : []), [contractId]) ?? EMPTY).sort((a, b) => a.at.localeCompare(b.at)) as ContractEvent[];

async function settings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...((await db.settings.get('settings')) ?? {}) };
}

async function memberNames(): Promise<Record<string, string>> {
  const ms = await db.members.toArray();
  return Object.fromEntries(ms.map((m) => [m.id, m.name]));
}

// ---------------------------------------------------------------------------
// Library seed (runs on start-up; adds anything missing after updates)

export async function ensureContractLibrary() {
  const clauses = await db.clauses.toArray();
  let sort = 0;
  for (const c of DEFAULT_CLAUSES) {
    sort += 10;
    if (!clauses.some((x) => x.key === c.key)) await save<Clause>('clauses', { ...c, version: 1, sort, active: true }, { actor: 'system' });
  }
  const riderIds: Record<string, string> = {};
  if ((await db.riders.count()) === 0) {
    for (const { key, ...r } of DEFAULT_RIDERS) riderIds[key] = (await save<Rider>('riders', r, { actor: 'system' })).id;
  }
  if ((await db.contractTemplates.count()) === 0) {
    for (const { rider, ...t } of DEFAULT_TEMPLATES) await save<ContractTemplate>('contractTemplates', { ...t, riderId: riderIds[rider] }, { actor: 'system' });
  }
}

// ---------------------------------------------------------------------------
// Lookups

export async function templateForGig(gig: Pick<Gig, 'eventType'>): Promise<ContractTemplate | undefined> {
  const all = alive(await db.contractTemplates.toArray()).filter((t) => t.active);
  return all.find((t) => t.eventTypes.includes(gig.eventType)) ?? all.find((t) => t.eventTypes.includes('other'));
}

/** How quote and contract work together for this gig (template setting, per event type). */
export async function flowForGig(gig: Gig): Promise<ContractFlow> {
  const active = await activeContractForGig(gig.id);
  if (active) return active.flow;
  return (await templateForGig(gig))?.flow ?? 'none';
}

export async function clientKindForGig(gig: Gig, template?: ContractTemplate): Promise<ClientKind> {
  if (gig.clientOrganisationId) {
    const org = await db.organisations.get(gig.clientOrganisationId);
    if (org) return 'business';
  }
  return gig.clientPersonId ? 'consumer' : (template?.clientKind ?? 'consumer');
}

export async function activeContractForGig(gigId: string): Promise<Contract | undefined> {
  const rows = alive(await db.contracts.where('gigId').equals(gigId).toArray()).filter((c) => c.status !== 'cancelled');
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

export async function latestQuoteForGig(gigId: string): Promise<Quote | undefined> {
  const qs = alive(await db.quotes.where('gigId').equals(gigId).toArray()).filter((q) => q.status !== 'superseded' && q.status !== 'declined');
  return qs.sort((a, b) => b.version - a.version)[0];
}

export async function logEvent(contractId: string, type: ContractEvent['type'], note?: string, versionId?: string) {
  return save<ContractEvent>('contractEvents', { contractId, type, note, versionId, at: nowIso() });
}

// ---------------------------------------------------------------------------
// Create + live snapshot

export async function createContract(gigId: string, opts: { quoteId?: string; kind?: Contract['kind']; title?: string } = {}): Promise<Contract> {
  const existing = await activeContractForGig(gigId);
  if (existing) {
    if (opts.quoteId && existing.status === 'draft' && existing.quoteId !== opts.quoteId) return save<Contract>('contracts', { ...existing, quoteId: opts.quoteId });
    return existing;
  }
  await ensureContractLibrary();
  const s = await settings();
  const gig = (await db.gigs.get(gigId))!;
  const template = await templateForGig(gig);
  const person = gig.clientPersonId ? await db.persons.get(gig.clientPersonId) : undefined;
  const quote = opts.quoteId ? await db.quotes.get(opts.quoteId) : await latestQuoteForGig(gigId);
  const previous = (await db.contracts.where('gigId').equals(gigId).count());
  const number = `C-${gig.reference || todayStr().slice(0, 4)}${previous ? `-${previous + 1}` : ''}`;
  const c = await save<Contract>('contracts', {
    number, gigId, quoteId: quote?.id, templateId: template?.id, kind: opts.kind ?? 'ours', title: opts.title,
    clientKind: await clientKindForGig(gig, template), language: quote?.language ?? person?.language ?? s.language,
    flow: template?.flow === 'none' ? 'after_quote' : (template?.flow ?? 'after_quote'),
    status: 'draft', clauseOverrides: {}, overtimeRate: s.overtimeRateHalfHour, riderId: template?.riderId,
  });
  await logEvent(c.id, 'generated', quote ? `${translate(s.language, 'pdf.quote')} ${quote.number ?? ''} v${quote.version}` : undefined);
  runTaskSync();
  return c;
}

export interface LiveContract {
  snapshot: ContractSnapshot;
  warnings: ReturnType<typeof warningsFor>;
  states: ReturnType<typeof clauseStates>;
  parent?: ContractVersion;
}

/** The contract as it would be frozen right now (drafts, previews, addenda). */
export async function liveSnapshot(c: Contract): Promise<LiveContract> {
  const s = await settings();
  const gig = (await db.gigs.get(c.gigId))!;
  const venue = gig.venueId ? await db.venues.get(gig.venueId) : undefined;
  const quote = (c.pendingAddendum ? await latestQuoteForGig(c.gigId) : undefined) ?? (c.quoteId ? await db.quotes.get(c.quoteId) : await latestQuoteForGig(c.gigId));
  const template = c.templateId ? await db.contractTemplates.get(c.templateId) : await templateForGig(gig);
  const clauses = currentClauses(alive(await db.clauses.toArray()));
  const rider = c.riderId ? await db.riders.get(c.riderId) : undefined;
  const { clientSnapshotForGig } = await import('../invoicing/data');
  const client = quote?.client ?? await clientSnapshotForGig(gig);
  const today = todayStr();
  const termsSha256 = await sha256Hex(termsTextFor(s, c.language));
  let snapshot = buildSnapshot({ contract: c, gig, venue, quote, template, clauses, rider, settings: s, client, today, termsSha256, memberNames: await memberNames() });
  let parent: ContractVersion | undefined;
  if (c.pendingAddendum && c.signedVersionId) {
    parent = await db.contractVersions.get(c.signedVersionId);
    if (parent) {
      const versions = alive(await db.contractVersions.where('contractId').equals(c.id).toArray());
      const n = versions.filter((v) => v.kind === 'addendum' && v.status !== 'void' && v.status !== 'superseded').length + 1;
      snapshot = { ...snapshot, addendum: {
        label: translate(c.language, 'ct.addendumN', { n }), parentLabel: parent.label, parentHash: parent.contentHash,
        reason: c.pendingAddendum.reason, changes: snapshotDiff(parent.snapshot, snapshot),
      } };
    }
  }
  const states = clauseStates(template, clauses, { clientKind: c.clientKind, outdoor: isOutdoor(gig), setup: gig.setupRequired }, c.clauseOverrides);
  return { snapshot, warnings: warningsFor(snapshot, { flow: c.flow, legalNames: s.legalNames, hasVenue: !!venue }), states, parent };
}

// ---------------------------------------------------------------------------
// Send (freeze a version)

export async function freezeVersion(c: Contract, me: MemberId): Promise<ContractVersion> {
  const s = await settings();
  const live = await liveSnapshot(c);
  if (c.kind === 'ours' && live.warnings.some((w) => w.blocking)) throw new Error('blocked');
  const isAdd = !!(c.pendingAddendum && live.parent);
  const versions = alive(await db.contractVersions.where('contractId').equals(c.id).toArray());
  for (const v of versions) if (v.status === 'sent') await save<ContractVersion>('contractVersions', { ...v, status: 'superseded' });
  const seq = versions.reduce((m, v) => Math.max(m, v.seq), 0) + 1;
  const contractVersions = versions.filter((v) => v.kind === 'contract').length;
  const snapshot = live.snapshot;
  const contentHash = await hashSnapshot(snapshot);
  const v = await save<ContractVersion>('contractVersions', {
    contractId: c.id, seq, kind: isAdd ? 'addendum' : 'contract', label: isAdd ? snapshot.addendum!.label : `v${contractVersions + 1}`,
    snapshot, contentHash, prevHash: isAdd ? live.parent!.contentHash : undefined, frozenAt: nowIso(), status: 'sent',
  });
  const gig = await db.gigs.get(c.gigId);
  await save<Contract>('contracts', {
    ...c, status: isAdd ? c.status : 'sent', currentVersionId: v.id, sentAt: nowIso(),
    signBy: isAdd ? c.signBy : signByDate(todayStr(), (c.templateId ? (await db.contractTemplates.get(c.templateId))?.signByDays : undefined) ?? s.contractSignByDays, gig?.date),
    quoteId: snapshot.quote?.id ?? c.quoteId,
  });
  await logEvent(c.id, 'sent', v.label, v.id);
  // "Together" flow: the quote goes out with the contract.
  if (!isAdd && snapshot.quote) {
    const q = await db.quotes.get(snapshot.quote.id);
    if (q && q.status === 'draft') {
      const { markQuoteSent } = await import('../invoicing/data');
      await markQuoteSent(q, me);
    }
  }
  runTaskSync();
  return v;
}

/** Back to draft to change something; the sent version is superseded on the next send. */
export async function reopenDraft(c: Contract) {
  await save<Contract>('contracts', { ...c, status: 'draft' });
}

// ---------------------------------------------------------------------------
// Signing

export interface ClientSignInput {
  name: string;
  role?: string;
  email?: string;
  method: Exclude<ContractSignature['method'], 'countersign'>;
  channel?: ContractSignature['channel'];
  imageDataUrl?: string;
  evidenceDataUrl?: string;
  note?: string;
  photoOptOut: boolean;
  selectedExtras?: string[];
  place?: string;
  signedAt?: string;
}

export interface SignResult { complete: boolean; conflict?: boolean; depositInvoiceId?: string }

export async function signClient(c: Contract, v: ContractVersion, input: ClientSignInput, me: MemberId): Promise<SignResult> {
  if (v.status !== 'sent') throw new Error('not_signable');
  const s = await settings();
  await save<ContractSignature>('contractSignatures', {
    contractId: c.id, versionId: v.id, party: 'client', name: input.name, role: input.role, email: input.email, method: input.method, channel: input.channel,
    level: 'SES', signedAt: input.signedAt ?? nowIso(), contentHash: v.contentHash,
    consents: { contract: true, terms: v.snapshot.terms.version, termsSha256: v.snapshot.terms.sha256, photoOptOut: input.photoOptOut },
    selectedExtras: input.selectedExtras, imageDataUrl: input.imageDataUrl, evidenceDataUrl: input.evidenceDataUrl, note: input.note, place: input.place,
    device: input.method === 'drawn_on_device' && typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 160) : undefined,
  });
  await logEvent(c.id, 'signed_client', `${input.name} · ${translate(s.language, `ct.method.${input.method}`)}`, v.id);
  if (s.contractAutoCountersign) await countersign(c, v, me);
  return finishIfComplete(c.id, v.id, me);
}

export async function countersign(c: Contract, v: ContractVersion, me: MemberId) {
  const existing = alive(await db.contractSignatures.where('versionId').equals(v.id).toArray()).find((x) => x.party === 'funqtion');
  if (existing) return existing;
  const s = await settings();
  const member = await db.members.get(me);
  const sig = await save<ContractSignature>('contractSignatures', {
    contractId: c.id, versionId: v.id, party: 'funqtion', name: s.legalNames ? `${member?.name ?? me} (${s.businessName})` : `${member?.name ?? me} – ${s.businessName}`,
    role: s.businessName, memberId: me, method: 'countersign', level: 'SES', signedAt: nowIso(), contentHash: v.contentHash,
    consents: { contract: true, terms: v.snapshot.terms.version, termsSha256: v.snapshot.terms.sha256, photoOptOut: false },
    imageDataUrl: s.memberSignatures?.[me],
  });
  await logEvent(c.id, 'signed_funqtion', member?.name ?? me, v.id);
  return sig;
}

const viaFor = (sig: ContractSignature): NonNullable<Quote['acceptedVia']> =>
  sig.method === 'drawn_on_device' ? 'in_person' : sig.method === 'signed_pdf' ? 'signed_pdf' : (sig.channel ?? 'other');

/** When both parties signed a version: mark it signed and run the triggers for apps 1 and 2. */
export async function finishIfComplete(contractId: string, versionId: string, me: MemberId): Promise<SignResult> {
  const sigs = alive(await db.contractSignatures.where('versionId').equals(versionId).toArray());
  const client = sigs.find((x) => x.party === 'client');
  if (!client || !sigs.some((x) => x.party === 'funqtion')) return { complete: false };
  const s = await settings();
  const v = (await db.contractVersions.get(versionId))!;
  let c = (await db.contracts.get(contractId))!;
  await save<ContractVersion>('contractVersions', { ...v, status: 'signed', signedAt: nowIso() });
  c = await save<Contract>('contracts', { ...c, status: 'signed', signedVersionId: v.id, signedAt: c.signedAt ?? nowIso(), pendingAddendum: undefined });
  await logEvent(c.id, 'fully_signed', v.label, v.id);
  const inv = await import('../invoicing/data');
  const result: SignResult = { complete: true };
  // Quote: accepted with the extras chosen at signing.
  let quote = v.snapshot.quote ? await db.quotes.get(v.snapshot.quote.id) : undefined;
  if (quote && quote.status !== 'accepted') {
    quote = await inv.recordQuoteAcceptance(quote, me, { name: client.name, via: viaFor(client), selected: client.selectedExtras ?? [], note: translate(s.language, 'ct.acceptedViaContract', { number: c.number }) });
    if (c.quoteId !== quote.id) c = await save<Contract>('contracts', { ...c, quoteId: quote.id });
  }
  if (v.kind === 'contract') {
    if (await inv.confirmGigIfFree(c.gigId, translate(s.language, 'ct.signedNote', { number: c.number })) === 'conflict') {
      result.conflict = true;
      await logEvent(c.id, 'conflict');
    }
    if (quote && (quote.depositPct ?? s.depositPct) > 0) {
      const deposits = alive(await db.invoices.where('quoteId').equals(quote.id).toArray()).filter((i) => i.kind === 'deposit' && i.status !== 'credited');
      if (!deposits.length) {
        const d = await inv.createInvoiceFromQuote(quote, 'deposit');
        c = await save<Contract>('contracts', { ...c, depositInvoiceId: d.id });
        await logEvent(c.id, 'deposit_invoice', d.id);
        result.depositInvoiceId = d.id;
      }
    }
  } else {
    // Addendum: the agreed fee follows the signed addendum.
    const gig = await db.gigs.get(c.gigId);
    if (gig && gig.agreedFee !== v.snapshot.price.total) await save<Gig>('gigs', { ...gig, agreedFee: v.snapshot.price.total });
  }
  runTaskSync();
  return result;
}

/** App 2 hook: the client accepted the quote. */
export async function onQuoteAccepted(q: Quote, me: MemberId, a: { name: string; via: NonNullable<Quote['acceptedVia']>; note?: string; selected: string[] }): Promise<'ok' | 'conflict' | 'contract'> {
  const c = await activeContractForGig(q.gigId);
  if (c?.status === 'signed') {
    const { confirmGigIfFree } = await import('../invoicing/data');
    return confirmGigIfFree(q.gigId, `${a.name} (${a.via})`);
  }
  const v = c?.currentVersionId ? await db.contractVersions.get(c.currentVersionId) : undefined;
  // "Together": the client had quote + contract; one akkoord covers both.
  if (c && c.status === 'sent' && v?.status === 'sent' && v.kind === 'contract' && c.flow === 'together') {
    const r = await signClient(c, v, {
      name: a.name, method: a.via === 'signed_pdf' ? 'signed_pdf' : 'reply_akkoord', channel: a.via === 'signed_pdf' ? undefined : a.via,
      note: a.note, photoOptOut: false, selectedExtras: a.selected,
    }, me);
    if (r.complete) return r.conflict ? 'conflict' : 'ok';
    return 'contract';
  }
  await createContract(q.gigId, { quoteId: q.id });
  return 'contract';
}

// ---------------------------------------------------------------------------
// Changes, addenda, cancellation

export async function startAddendum(c: Contract, reason: string) {
  await save<Contract>('contracts', { ...c, pendingAddendum: { reason } });
  await logEvent(c.id, 'addendum_started', reason);
}

export async function dropAddendum(c: Contract) {
  const v = c.currentVersionId ? await db.contractVersions.get(c.currentVersionId) : undefined;
  if (v && v.kind === 'addendum' && v.status === 'sent') await save<ContractVersion>('contractVersions', { ...v, status: 'void' });
  await save<Contract>('contracts', { ...c, pendingAddendum: undefined, currentVersionId: c.signedVersionId });
}

export async function addNote(c: Contract, text: string) {
  await logEvent(c.id, 'note', text);
}

/** Withdraw an unsigned contract (e.g. the client went with someone else). */
export async function withdrawContract(c: Contract, reason: string) {
  for (const v of alive(await db.contractVersions.where('contractId').equals(c.id).toArray())) {
    if (v.status === 'sent') await save<ContractVersion>('contractVersions', { ...v, status: 'void' });
  }
  await save<Contract>('contracts', { ...c, status: 'cancelled', cancelledAt: nowIso(), cancellationReason: reason });
  await logEvent(c.id, 'withdrawn', reason);
  runTaskSync();
}

export async function cancellationQuote(c: Contract, cancelDate: string) {
  const v = c.signedVersionId ? await db.contractVersions.get(c.signedVersionId) : undefined;
  const gig = await db.gigs.get(c.gigId);
  const rows = v?.snapshot.cancellation ?? [];
  const total = v?.snapshot.price.total ?? gig?.agreedFee ?? 0;
  const { pct, days } = gig?.date && rows.length ? cancellationFeePct(rows, gig.date, cancelDate) : { pct: 100, days: 0 };
  return { pct, days, total, fee: Math.round((total * pct) / 100) };
}

export async function cancelContract(c: Contract, input: { by: NonNullable<Contract['cancelledBy']>; date: string; reason: string; pct: number; createInvoice: boolean }): Promise<Invoice | undefined> {
  const gig = await db.gigs.get(c.gigId);
  const pre = await cancellationQuote(c, input.date);
  const fee = Math.round((pre.total * input.pct) / 100);
  const quote = c.quoteId ? await db.quotes.get(c.quoteId) : undefined;
  let invoice: Invoice | undefined;
  const inv = await import('../invoicing/data');
  if (input.createInvoice && quote && input.pct > 0) {
    invoice = await inv.createCancellationInvoice(quote, false, { pct: input.pct, days: pre.days });
  }
  if (gig && ['confirmed', 'option', 'quote_sent', 'enquiry'].includes(gig.stage)) {
    const { changeStage } = await import('../bookings/data');
    if (gig.stage === 'confirmed') await changeStage(gig, { to: 'cancelled', reason: 'event_cancelled', note: input.reason, extra: { cancelledBy: input.by === 'us' ? 'us' : 'client', cancellationFee: fee } });
    else await changeStage(gig, { to: 'lost', reason: 'event_cancelled', note: input.reason });
  }
  await save<Contract>('contracts', { ...c, status: 'cancelled', cancelledAt: nowIso(), cancelledBy: input.by, cancellationReason: input.reason, cancellationFee: fee });
  await logEvent(c.id, 'cancelled', `${input.pct}% · ${input.reason}`);
  runTaskSync();
  return invoice;
}

// ---------------------------------------------------------------------------
// PDF

export async function versionPdf(v: ContractVersion): Promise<Blob> {
  const [{ contractDefinition }, { pdfBlob, paperLogoSvg }] = await Promise.all([import('./domain/pdfDoc'), import('../invoicing/pdf')]);
  const s = await settings();
  const sigs = alive(await db.contractSignatures.where('versionId').equals(v.id).toArray()).sort((a, b) => (a.party === 'client' ? -1 : 1) - (b.party === 'client' ? -1 : 1));
  const events = alive(await db.contractEvents.where('contractId').equals(v.contractId).toArray()).filter((e) => !e.versionId || e.versionId === v.id).sort((a, b) => a.at.localeCompare(b.at));
  return pdfBlob(contractDefinition({ version: v, snapshot: v.snapshot, signatures: sigs, events: sigs.length ? events : undefined, logoSvg: paperLogoSvg, businessName: s.businessName }));
}

export async function draftPdf(c: Contract): Promise<Blob> {
  const [{ contractDefinition }, { pdfBlob, paperLogoSvg }] = await Promise.all([import('./domain/pdfDoc'), import('../invoicing/pdf')]);
  const s = await settings();
  const live = await liveSnapshot(c);
  return pdfBlob(contractDefinition({ version: { kind: live.snapshot.addendum ? 'addendum' : 'contract', label: live.snapshot.addendum?.label ?? 'concept', status: 'draft' },
    snapshot: live.snapshot, logoSvg: paperLogoSvg, businessName: s.businessName }));
}

export const contractPdfName = (c: Contract, v?: Pick<ContractVersion, 'label'>, signed = false) =>
  `${c.number}${v ? '-' + v.label.replace(/\s+/g, '') : '-concept'}${signed ? '-getekend' : ''}.pdf`;

export { uid };
