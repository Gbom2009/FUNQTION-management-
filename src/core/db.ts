import Dexie, { type Table } from 'dexie';
import type {
  AuditEntry, AvailabilityBlock, Enquiry, Gig, Interaction, Member, Organisation, Person,
  Product, Quote, Review, Settings, StatusChange, Task, Template, Venue,
} from './types';

// Local-first storage (IndexedDB). One database for the whole Funqtion suite:
// later apps add their own tables in a new version() block. A self-hosted sync
// server can replicate these tables later (every row has updatedAt/deletedAt).
export class FunqtionDB extends Dexie {
  members!: Table<Member, string>;
  persons!: Table<Person, string>;
  organisations!: Table<Organisation, string>;
  venues!: Table<Venue, string>;
  enquiries!: Table<Enquiry, string>;
  gigs!: Table<Gig, string>;
  quotes!: Table<Quote, string>;
  products!: Table<Product, string>;
  statusChanges!: Table<StatusChange, string>;
  availability!: Table<AvailabilityBlock, string>;
  tasks!: Table<Task, string>;
  interactions!: Table<Interaction, string>;
  templates!: Table<Template, string>;
  reviews!: Table<Review, string>;
  audit!: Table<AuditEntry, string>;
  settings!: Table<Settings, string>;

  constructor(name = 'funqtion') {
    super(name);
    this.version(1).stores({
      members: 'id',
      persons: 'id, lastName, organisationId, email, phone, instagram, updatedAt',
      organisations: 'id, name, updatedAt',
      venues: 'id, name, city, updatedAt',
      enquiries: 'id, status, receivedAt, personId, updatedAt',
      gigs: 'id, date, stage, clientPersonId, clientOrganisationId, venueId, enquiryId, updatedAt',
      quotes: 'id, gigId, updatedAt',
      products: 'id, updatedAt',
      statusChanges: 'id, gigId, createdAt',
      availability: 'id, memberId, from, updatedAt',
      tasks: 'id, status, dueAt, gigId, personId, enquiryId, ruleKey, updatedAt',
      interactions: 'id, at, gigId, personId, enquiryId, updatedAt',
      templates: 'id, kind, language, updatedAt',
      reviews: 'id, gigId, updatedAt',
      audit: 'id, rowId, table, at',
      settings: 'key',
    });
  }
}

export let db = new FunqtionDB();

/** Test helper: point the app at a fresh, isolated database. */
export function useTestDatabase(name: string) {
  db = new FunqtionDB(name);
  return db;
}

/** Tables that hold Base records and take part in audit, backup and merge. */
export const DATA_TABLES = [
  'persons', 'organisations', 'venues', 'enquiries', 'gigs', 'quotes', 'products', 'statusChanges',
  'availability', 'tasks', 'interactions', 'templates', 'reviews',
] as const;
export type DataTable = (typeof DATA_TABLES)[number];
