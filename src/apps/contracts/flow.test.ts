import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useTestDatabase } from '../../core/db';
import { save, setActor } from '../../core/repo';
import { ensureSeed } from '../../core/seed';
import { addDays, toDateStr } from '../../core/dates';
import type { ContractVersion, Organisation, Person, Venue } from '../../core/types';
import { blankGig, createGig } from '../bookings/data';
import { acceptQuote, createQuoteForGig } from '../invoicing/data';
import { desiredTasks } from '../bookings/domain/reminders';
import { runTaskSync } from '../bookings/domain/taskSync';
import {
  activeContractForGig, cancelContract, cancellationQuote, createContract, freezeVersion, liveSnapshot, signClient, startAddendum,
} from './data';
import { hashSnapshot } from './domain/render';

// End-to-end through the database: quote → contract → signature → gig confirmed + deposit invoice.

let n = 0;
beforeEach(async () => { useTestDatabase('contracts-' + n++); setActor('gijs'); await ensureSeed(); });
// Task sync runs in the background; let it finish before the next test swaps the database.
afterEach(async () => { await runTaskSync(); });

const inDays = (d: number) => toDateStr(addDays(new Date(), d));

async function wedding() {
  const { db } = await import('../../core/db');
  await db.settings.update('settings', { legalNames: 'G. Gijsen en C. Coenen' });
  const p = await save<Person>('persons', { firstName: 'Lisa', lastName: 'de Vries', language: 'nl', tags: [], email: 'lisa@example.nl' });
  const v = await save<Venue>('venues', { name: 'Kasteel Croy', city: 'Aarle-Rixtel' });
  const gig = await createGig(blankGig('gijs', { title: 'Bruiloft Lisa', eventType: 'wedding', date: inDays(200), startTime: '21:00', endTime: '01:00', clientPersonId: p.id, venueId: v.id, setting: 'outdoor', stage: 'option' }));
  return { db, gig, quote: await createQuoteForGig(gig.id) };
}

describe('together flow (wedding): one akkoord covers quote and contract', () => {
  it('sends the contract with the quote and confirms the gig on acceptance', async () => {
    const { db, gig, quote } = await wedding();
    const c = await createContract(gig.id);
    expect(c).toMatchObject({ flow: 'together', clientKind: 'consumer', quoteId: quote.id, status: 'draft' });
    const live = await liveSnapshot(c);
    expect(live.snapshot.clauses.map((x) => x.key)).toEqual(expect.arrayContaining(['K1', 'K3', 'A1', 'G4', 'A4', 'R1']));
    expect(live.warnings.some((w) => w.blocking)).toBe(false);

    const v = await freezeVersion(c, 'gijs');
    expect(v).toMatchObject({ kind: 'contract', label: 'v1', status: 'sent' });
    expect(v.contentHash).toBe(await hashSnapshot(v.snapshot));
    expect((await db.quotes.get(quote.id))!.status).toBe('sent');
    expect((await db.gigs.get(gig.id))!.stage).toBe('quote_sent');
    expect((await db.contracts.get(c.id))!.signBy).toBe(inDays(7));

    const laser = quote.lines.find((l) => l.optional)!;
    const sentQuote = (await db.quotes.get(quote.id))!;
    expect(await acceptQuote(sentQuote, 'gijs', { name: 'Lisa de Vries', via: 'whatsapp', selected: [laser.id] })).toBe('ok');

    const done = (await db.contracts.get(c.id))!;
    expect(done.status).toBe('signed');
    expect((await db.gigs.get(gig.id))!.stage).toBe('confirmed');
    const sigs = await db.contractSignatures.where('versionId').equals(v.id).toArray();
    expect(sigs.map((s) => s.party).sort()).toEqual(['client', 'funqtion']);
    expect(sigs.find((s) => s.party === 'client')).toMatchObject({ method: 'reply_akkoord', channel: 'whatsapp', selectedExtras: [laser.id], contentHash: v.contentHash });
    const dep = (await db.invoices.get(done.depositInvoiceId!))!;
    expect(dep).toMatchObject({ kind: 'deposit', status: 'draft' });
    const accepted = (await db.quotes.get(quote.id))!;
    expect(accepted.status).toBe('accepted');

    // Frozen evidence cannot be changed.
    const frozen = (await db.contractVersions.get(v.id))!;
    await expect(save<ContractVersion>('contractVersions', { ...frozen, snapshot: { ...frozen.snapshot, specialTerms: 'gewijzigd' } })).rejects.toThrow('frozen_record');

    // The deposit task appears.
    const tasks = desiredTasks({ gigs: await db.gigs.toArray(), enquiries: [], quotes: await db.quotes.toArray(), reviews: [], invoices: await db.invoices.toArray(), payments: [], contracts: await db.contracts.toArray() }, (await db.settings.get('settings'))!);
    expect(tasks.some((x) => x.kind === 'contract_deposit')).toBe(true);
  });

  it('makes an addendum that references the signed version, then cancels with the frozen scale', async () => {
    const { db, gig } = await wedding();
    let c = await createContract(gig.id);
    const v1 = await freezeVersion(c, 'gijs');
    c = (await db.contracts.get(c.id))!;
    const r = await signClient(c, v1, { name: 'Lisa', method: 'drawn_on_device', channel: 'in_person', photoOptOut: true, imageDataUrl: 'data:image/png;base64,AA==' }, 'gijs');
    expect(r.complete).toBe(true);
    expect((await db.gigs.get(gig.id))!.stage).toBe('confirmed');

    await save('gigs', { ...(await db.gigs.get(gig.id))!, endTime: '02:00' });
    c = (await db.contracts.get(c.id))!;
    await startAddendum(c, 'Een uur langer');
    c = (await db.contracts.get(c.id))!;
    const live = await liveSnapshot(c);
    expect(live.snapshot.addendum?.changes.map((x) => x.field)).toEqual(['sets']);
    const a1 = await freezeVersion(c, 'gijs');
    expect(a1).toMatchObject({ kind: 'addendum', label: 'Addendum 1', prevHash: v1.contentHash });
    c = (await db.contracts.get(c.id))!;
    expect(c.status).toBe('signed');
    await signClient(c, a1, { name: 'Lisa', method: 'reply_akkoord', channel: 'email', photoOptOut: true }, 'gijs');
    c = (await db.contracts.get(c.id))!;
    expect(c.signedVersionId).toBe(a1.id);
    expect(c.pendingAddendum).toBeUndefined();

    const pre = await cancellationQuote(c, inDays(1));
    expect(pre.pct).toBe(10); // consumer: more than 6 months before
    await cancelContract(c, { by: 'client', date: inDays(1), reason: 'Bruiloft gaat niet door', pct: pre.pct, createInvoice: true });
    expect((await db.contracts.get(c.id))!.status).toBe('cancelled');
    const g = (await db.gigs.get(gig.id))!;
    expect(g).toMatchObject({ stage: 'cancelled', cancelledBy: 'client' });
    expect((await db.invoices.where('gigId').equals(gig.id).toArray()).some((i) => i.kind === 'cancellation')).toBe(true);
  });
});

describe('after-quote flow (company): quote acceptance holds the date, signature confirms', () => {
  it('creates the contract on acceptance and confirms only after signing', async () => {
    const { db } = await import('../../core/db');
    await db.settings.update('settings', { legalNames: 'G. Gijsen en C. Coenen' });
    const org = await save<Organisation>('organisations', { name: 'Bakkerij Jansen BV', type: 'company' });
    const p = await save<Person>('persons', { firstName: 'Piet', lastName: 'Jansen', language: 'nl', tags: [], email: 'piet@example.nl', organisationId: org.id });
    const gig = await createGig(blankGig('gijs', { title: 'Personeelsfeest', eventType: 'company', date: inDays(200), clientPersonId: p.id, clientOrganisationId: org.id, stage: 'quote_sent' }));
    const q = await createQuoteForGig(gig.id);
    expect(await acceptQuote(q, 'gijs', { name: 'Piet Jansen', via: 'email', selected: [] })).toBe('contract');
    expect((await db.gigs.get(gig.id))!.stage).toBe('quote_sent');
    const c = (await activeContractForGig(gig.id))!;
    expect(c).toMatchObject({ status: 'draft', clientKind: 'business', flow: 'after_quote', quoteId: q.id });
    const tasks = desiredTasks({ gigs: await db.gigs.toArray(), enquiries: [], quotes: await db.quotes.toArray(), reviews: [], contracts: await db.contracts.toArray() }, (await db.settings.get('settings'))!);
    expect(tasks.map((x) => x.kind)).toContain('contract_review');
    expect(tasks.map((x) => x.kind)).not.toContain('follow_up_quote');

    const v = await freezeVersion(c, 'gijs');
    expect(v.snapshot.cancellation[0].pct).toBe(25); // business scale (consumer would be 10%)
    expect(v.snapshot.clauses.some((x) => x.key === 'K3')).toBe(false);
    const res = await signClient((await db.contracts.get(c.id))!, v, { name: 'Piet Jansen', role: 'Directeur', method: 'signed_pdf', photoOptOut: false }, 'gijs');
    expect(res.complete).toBe(true);
    expect(res.depositInvoiceId).toBeTruthy();
    expect((await db.gigs.get(gig.id))!.stage).toBe('confirmed');
  });

  it('club nights need no contract: acceptance confirms directly', async () => {
    const { db } = await import('../../core/db');
    const gig = await createGig(blankGig('gijs', { title: 'Club X', eventType: 'club', date: inDays(30), stage: 'quote_sent' }));
    const q = await createQuoteForGig(gig.id);
    expect(await acceptQuote(q, 'gijs', { name: 'Club X', via: 'email', selected: [] })).toBe('ok');
    expect((await db.gigs.get(gig.id))!.stage).toBe('confirmed');
    expect(await activeContractForGig(gig.id)).toBeUndefined();
  });
});
