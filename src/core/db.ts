import Dexie, { type Table } from 'dexie';
import type {
  Asset, AuditEntry, AvailabilityBlock, BankAccount, BankLine, BankRule, Category, Enquiry, Expense, HourEntry, PartnerEntry, Receipt, Trip, VatPeriod, Gig, Interaction, Invoice, Member, Organisation, Package, Payment, Person,
  Product, Quote, Review, Settings, StatusChange, Task, Template, Venue,
  Clause, Contract, ContractEvent, ContractSignature, ContractTemplate, ContractVersion, Rider,
  GearIssue, GearItem, GearKit, GearLocation, GearMovement, GearPhoto, GearRental, MaintenanceLog, MaintenancePlan, PackList, SafetyTest, WishItem,
  GigDay, TrackRecord, VehicleRecord, VenuePhoto,
  DayTask, GigLog, TaskTemplate, TimelineStep, VenueNote,
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
  // app 2: Quotes & Invoices
  invoices!: Table<Invoice, string>;
  payments!: Table<Payment, string>;
  packages!: Table<Package, string>;
  // app 3: Money & Accounting
  categories!: Table<Category, string>;
  expenses!: Table<Expense, string>;
  receipts!: Table<Receipt, string>;
  bankAccounts!: Table<BankAccount, string>;
  bankLines!: Table<BankLine, string>;
  bankRules!: Table<BankRule, string>;
  trips!: Table<Trip, string>;
  hours!: Table<HourEntry, string>;
  assets!: Table<Asset, string>;
  partnerEntries!: Table<PartnerEntry, string>;
  vatPeriods!: Table<VatPeriod, string>;
  // app 4: Contracts
  clauses!: Table<Clause, string>;
  contractTemplates!: Table<ContractTemplate, string>;
  riders!: Table<Rider, string>;
  contracts!: Table<Contract, string>;
  contractVersions!: Table<ContractVersion, string>;
  contractSignatures!: Table<ContractSignature, string>;
  contractEvents!: Table<ContractEvent, string>;
  // app 5: Gear & Inventory
  gearItems!: Table<GearItem, string>;
  gearPhotos!: Table<GearPhoto, string>;
  gearLocations!: Table<GearLocation, string>;
  gearKits!: Table<GearKit, string>;
  packLists!: Table<PackList, string>;
  gearMovements!: Table<GearMovement, string>;
  gearIssues!: Table<GearIssue, string>;
  maintenancePlans!: Table<MaintenancePlan, string>;
  maintenanceLogs!: Table<MaintenanceLog, string>;
  safetyTests!: Table<SafetyTest, string>;
  gearRentals!: Table<GearRental, string>;
  wishlist!: Table<WishItem, string>;
  // Navigation (Maps) + Gig Day
  vehicles!: Table<VehicleRecord, string>;
  venuePhotos!: Table<VenuePhoto, string>;
  gigDays!: Table<GigDay, string>;
  tracks!: Table<TrackRecord, string>;
  // app 6: Gig Day
  timelineSteps!: Table<TimelineStep, string>;
  dayTasks!: Table<DayTask, string>;
  taskTemplates!: Table<TaskTemplate, string>;
  gigLogs!: Table<GigLog, string>;
  venueNotes!: Table<VenueNote, string>;

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
    // App 2 – Quotes & Invoices. Only new/changed tables are listed; the rest carry over.
    this.version(2).stores({
      quotes: 'id, gigId, number, status, updatedAt',
      invoices: 'id, number, series, gigId, quoteId, creditsInvoiceId, personId, status, kind, issueDate, updatedAt',
      payments: 'id, invoiceId, date, updatedAt',
      packages: 'id, updatedAt',
    });
    // App 3 – Money & Accounting.
    this.version(3).stores({
      categories: 'id, key, updatedAt',
      expenses: 'id, date, categoryId, gigId, paidBy, bankLineId, updatedAt',
      receipts: 'id, expenseId, sha256, updatedAt',
      bankAccounts: 'id, updatedAt',
      bankLines: 'id, accountId, date, &hash, status, updatedAt',
      bankRules: 'id, updatedAt',
      trips: 'id, date, gigId, driver, updatedAt',
      hours: 'id, date, memberId, gigId, updatedAt',
      assets: 'id, purchaseDate, updatedAt',
      partnerEntries: 'id, date, memberId, updatedAt',
      vatPeriods: 'id, &key, updatedAt',
    });
    // App 4 – Contracts.
    this.version(4).stores({
      clauses: 'id, key, updatedAt',
      contractTemplates: 'id, updatedAt',
      riders: 'id, updatedAt',
      contracts: 'id, gigId, quoteId, status, updatedAt',
      contractVersions: 'id, contractId, status, updatedAt',
      contractSignatures: 'id, contractId, versionId, updatedAt',
      contractEvents: 'id, contractId, at, updatedAt',
    });
    // App 5 – Gear & Inventory.
    this.version(5).stores({
      gearItems: 'id, &code, category, status, owner, parentId, updatedAt',
      gearPhotos: 'id, itemId, updatedAt',
      gearLocations: 'id, key, updatedAt',
      gearKits: 'id, role, updatedAt',
      packLists: 'id, &gigId, status, updatedAt',
      gearMovements: 'id, itemId, gigId, at, updatedAt',
      gearIssues: 'id, itemId, status, updatedAt',
      maintenancePlans: 'id, itemId, updatedAt',
      maintenanceLogs: 'id, itemId, planId, updatedAt',
      safetyTests: 'id, itemId, updatedAt',
      gearRentals: 'id, gigId, updatedAt',
      wishlist: 'id, updatedAt',
    });
    // Navigation (Maps, merged from FQ-maps) + Gig Day.
    this.version(6).stores({
      vehicles: 'id, kind, updatedAt',
      venuePhotos: 'id, venueId, updatedAt',
      gigDays: 'id, &gigId, updatedAt',
      tracks: 'id',
    });
    // App 6 – Gig Day.
    this.version(7).stores({
      timelineSteps: 'id, gigId, plannedAt, updatedAt',
      dayTasks: 'id, gigId, phase, updatedAt',
      taskTemplates: 'id, &key, updatedAt',
      gigLogs: 'id, gigId, at, type, updatedAt',
      venueNotes: 'id, venueId, gigId, updatedAt',
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
  'availability', 'tasks', 'interactions', 'templates', 'reviews', 'invoices', 'payments', 'packages',
  'categories', 'expenses', 'receipts', 'bankAccounts', 'bankLines', 'bankRules', 'trips', 'hours', 'assets', 'partnerEntries', 'vatPeriods',
  'clauses', 'contractTemplates', 'riders', 'contracts', 'contractVersions', 'contractSignatures', 'contractEvents',
  'gearItems', 'gearPhotos', 'gearLocations', 'gearKits', 'packLists', 'gearMovements', 'gearIssues', 'maintenancePlans', 'maintenanceLogs',
  'safetyTests', 'gearRentals', 'wishlist',
  'vehicles', 'venuePhotos', 'gigDays',
  'timelineSteps', 'dayTasks', 'taskTemplates', 'gigLogs', 'venueNotes',
] as const;
export type DataTable = (typeof DATA_TABLES)[number];
