import { save } from './repo';
import { addDays, toDateStr } from './dates';
import type { AvailabilityBlock, Enquiry, Organisation, Person, Venue } from './types';
import { createGig, blankGig, changeStage } from '../apps/bookings/data';

// Demo data so the app can be explored before real data is entered.
export async function loadDemo() {
  const d = (n: number) => toDateStr(addDays(new Date(), n));
  const comite = await save<Organisation>('organisations', { name: 'Kermiscomité Aarle-Rixtel', type: 'association' });
  const lisa = await save<Person>('persons', { firstName: 'Lisa', lastName: 'van den Heuvel', phone: '0612345678', email: 'lisa@example.nl', language: 'nl', tags: [], source: 'instagram' });
  const jan = await save<Person>('persons', { firstName: 'Jan', lastName: 'de Vries', phone: '0687654321', language: 'nl', tags: ['vaste klant'], organisationId: comite.id, orgRole: 'voorzitter', source: 'repeat' });
  const mark = await save<Person>('persons', { firstName: 'Mark', lastName: 'Jansen', email: 'mark@bedrijf.example', language: 'en', tags: [], source: 'referral', sourceDetail: 'Jan de Vries' });
  const hoeve = await save<Venue>('venues', { name: 'De Hoeve', street: 'Dorpsstraat 1', postcode: '5735 AA', city: 'Aarle-Rixtel', loadInNotes: 'Achterom via de parkeerplaats', powerNotes: '2× 230V links van het podium', houseSound: false });
  const tent = await save<Venue>('venues', { name: 'Feesttent Kerkplein', city: 'Aarle-Rixtel', powerNotes: 'Krachtstroom via aggregaat', houseSound: true });

  const g1 = await createGig(blankGig('gijs', { title: 'Bruiloft Lisa & Tom', eventType: 'wedding', date: d(9), startTime: '21:00', endTime: '01:00', setupTime: '19:00',
    venueId: hoeve.id, clientPersonId: lisa.id, performers: ['gijs', 'coen'], agreedFee: 95000, expectedCrowd: 120,
    musicWishes: [{ id: 'w1', kind: 'must_play', text: 'Mr. Brightside' }, { id: 'w2', kind: 'special_moment', text: 'Openingsdans: Perfect – Ed Sheeran' }] }));
  await changeStage(g1, { to: 'confirmed' });
  const g2 = await createGig(blankGig('coen', { title: 'Kermis Aarle-Rixtel – vrijdag', eventType: 'village_festival', date: d(30), startTime: '20:00', endTime: '00:30',
    venueId: tent.id, clientPersonId: jan.id, clientOrganisationId: comite.id, performers: ['coen'], setupRequired: false, seriesName: 'Kermis Aarle-Rixtel', agreedFee: 60000 }));
  await changeStage(g2, { to: 'quote_sent' });
  const g3 = await createGig(blankGig('gijs', { title: 'Bedrijfsfeest Jansen BV', eventType: 'company', date: d(30), startTime: '19:00', endTime: '23:00',
    clientPersonId: mark.id, performers: ['coen'], setupRequired: true }));
  await changeStage(g3, { to: 'option' });
  const g4 = await createGig(blankGig('gijs', { title: 'Kermis Aarle-Rixtel – vorig jaar', eventType: 'village_festival', date: d(-20), startTime: '20:00', endTime: '00:30',
    venueId: tent.id, clientPersonId: jan.id, clientOrganisationId: comite.id, performers: ['gijs', 'coen'], agreedFee: 110000 }));
  await changeStage(g4, { to: 'confirmed' });
  await changeStage({ ...g4, stage: 'confirmed' }, { to: 'played' });

  await save<Enquiry>('enquiries', { receivedAt: new Date(Date.now() - 20 * 3600_000).toISOString(), channel: 'instagram', status: 'new', ownerId: 'gijs',
    contactName: 'Sanne Peters', contactInstagram: '@sannep', requestedDate: d(60), eventType: 'private_party', locationText: 'Helmond',
    rawMessage: 'Hoi! Wij geven een 30e verjaardagsfeest en zoeken een DJ, zijn jullie vrij? Ongeveer 80 man.' });
  await save<AvailabilityBlock>('availability', { memberId: 'coen', from: d(14), to: d(21), kind: 'holiday', note: 'Spanje' });
}
