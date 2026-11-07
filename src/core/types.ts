// Shared data model for the Funqtion suite.
// Mirrors docs/bookings-crm/PLAN.md section 2. Every record carries the same
// bookkeeping fields so a self-hosted sync server can be added later without
// reshaping data: UUID ids, timestamps, who-changed-it, soft delete.

export type ID = string;
export type MemberId = 'gijs' | 'coen';
export type Assignee = MemberId | 'both';
export type Lang = 'nl' | 'en';

export interface Base {
  id: ID;
  createdAt: string; // ISO
  createdBy: MemberId | 'system';
  updatedAt: string;
  updatedBy: MemberId | 'system';
  deletedAt?: string | null;
}

// ---- core -----------------------------------------------------------------

export interface Member {
  id: MemberId;
  name: string;
  color: string;
  phone?: string;
  email?: string;
  pinHash?: string;
  pinSalt?: string;
}

export const LEAD_SOURCES = [
  'instagram', 'website', 'referral', 'repeat', 'facebook', 'google', 'event', 'other',
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export interface Person extends Base {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  whatsapp?: string;
  instagram?: string;
  language: Lang;
  organisationId?: ID;
  orgRole?: string;
  source?: LeadSource | '';
  sourceDetail?: string;
  notes?: string;
  tags: string[];
  marketingOptIn?: boolean;
  marketingOptInAt?: string;
  anonymisedAt?: string;
}

export const ORG_TYPES = [
  'company', 'venue', 'foundation', 'association', 'municipality', 'agency', 'other',
] as const;
export type OrgType = (typeof ORG_TYPES)[number];

export interface Organisation extends Base {
  name: string;
  type: OrgType;
  kvk?: string;
  vatNumber?: string;
  billingAddress?: string;
  invoiceEmail?: string;
  website?: string;
  instagram?: string;
  notes?: string;
}

export interface Venue extends Base {
  name: string;
  street?: string;
  postcode?: string;
  city?: string;
  country?: string;
  lat?: number;
  lng?: number;
  loadInNotes?: string;
  parkingNotes?: string;
  powerNotes?: string;
  houseSound?: boolean;
  curfew?: string;
  soundLimitDb?: number;
  notes?: string;
  distanceKm?: Partial<Record<MemberId, number>>; // one way, from each member's home
  // Navigation (Maps, Gig Day): the route goes to the loading entrance when it is set.
  loadingEntrance?: GeoPin;
  trailerParking?: GeoPin;
  contactName?: string;   // venue contact for load-in (the gig's day contact lives on the gig)
  contactPhone?: string;
  // Gig Day venue knowledge
  stageSize?: string;     // "6 × 4 m"
  powerPoints?: string;
  wifiName?: string;
  wifiPassword?: string;  // in encrypted backups only if you choose a passphrase
  accessCode?: string;
  houseRules?: string;
  defaultDoors?: string;  // HH:mm
}

/** A point picked on the map. */
export interface GeoPin { lat: number; lng: number; note?: string }

export interface AuditEntry {
  id: ID;
  table: string;
  rowId: ID;
  action: 'insert' | 'update' | 'delete';
  changes: Record<string, [unknown, unknown]>;
  actor: MemberId | 'system';
  at: string;
}

// ---- bookings ---------------------------------------------------------------

export const STAGES = [
  'enquiry', 'option', 'quote_sent', 'confirmed', 'played', 'invoiced', 'paid', 'lost', 'cancelled',
] as const;
export type Stage = (typeof STAGES)[number];
export const ACTIVE_STAGES: Stage[] = ['enquiry', 'option', 'quote_sent', 'confirmed', 'played', 'invoiced', 'paid'];

export const EVENT_TYPES = [
  'wedding', 'village_festival', 'carnival', 'club', 'private_party', 'company', 'festival', 'other',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const CHANNELS = [
  'phone', 'whatsapp', 'email', 'instagram', 'website', 'in_person', 'referral', 'other',
] as const;
export type Channel = (typeof CHANNELS)[number];

export const LOST_REASONS = [
  'too_expensive', 'other_dj', 'date_unavailable', 'no_response', 'event_cancelled', 'not_a_fit', 'other',
] as const;
export type LostReason = (typeof LOST_REASONS)[number];

export interface Enquiry extends Base {
  receivedAt: string;
  channel: Channel;
  rawMessage?: string;
  personId?: ID;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  contactInstagram?: string;
  requestedDate?: string; // yyyy-mm-dd
  requestedDateText?: string;
  eventType?: EventType | '';
  locationText?: string;
  guestCount?: number;
  status: 'new' | 'replied' | 'converted' | 'declined' | 'spam';
  ownerId: MemberId;
  firstResponseAt?: string;
  notes?: string;
}

export interface SetSlot {
  id: ID;
  start: string; // HH:mm
  end: string;   // HH:mm (may be past midnight -> next day)
  label?: string;
  performers: MemberId[];
}

export interface GigContact {
  personId: ID;
  role: 'booker' | 'day_contact' | 'venue_manager' | 'technician' | 'planner' | 'other';
}

export const WISH_KINDS = ['genre', 'must_play', 'do_not_play', 'special_moment'] as const;
export type WishKind = (typeof WISH_KINDS)[number];
export interface MusicWish {
  id: ID;
  kind: WishKind;
  text: string;
  url?: string;
  // Gig Day: special moments become timeline steps; must-plays get ticked.
  at?: string;        // HH:mm, or empty = after the first set
  track?: string;     // artist – title
  cue?: string;       // "na de speech van de vader"
  mc?: MemberId | 'none';
  done?: boolean;
  doneAt?: string;    // ISO
}

export interface Gig extends Base {
  reference: string; // FQ-2027-014
  title: string;
  enquiryId?: ID;
  clientPersonId?: ID;
  clientOrganisationId?: ID;
  venueId?: ID;
  eventType: EventType;
  setting?: 'indoor' | 'outdoor' | 'both' | '';
  date: string;      // yyyy-mm-dd (day the gig starts)
  startTime: string; // HH:mm
  endTime: string;   // HH:mm; earlier than start => ends next day
  setupTime?: string; // HH:mm load-in / build-up start
  setupRequired: boolean; // we bring and build our own gear
  expectedCrowd?: number;
  ageProfile?: string;
  stage: Stage;
  stageChangedAt: string;
  lostReason?: LostReason;
  lostNote?: string;
  cancelledBy?: 'client' | 'us';
  cancellationFee?: number; // cents
  optionExpiresAt?: string; // yyyy-mm-dd
  conflictOverride?: string; // note when confirmed despite a hard conflict
  ownerId: MemberId;
  performers: MemberId[];
  setSlots: SetSlot[];
  contacts: GigContact[];
  musicWishes: MusicWish[];
  agreedFee?: number; // cents
  travelFee?: number;
  deposit?: number;
  depositPaidAt?: string;
  seriesName?: string; // recurring yearly event, e.g. "Kermis Aarle-Rixtel"
  source?: LeadSource | '';
  notesInternal?: string;
  notesClient?: string;
  quoteSentAt?: string;
  playedAt?: string;
  invoicedAt?: string;
  paidAt?: string;
}

export interface QuoteLine {
  id: ID;
  description: string;
  quantity: number;
  unit: 'hour' | 'piece' | 'km' | 'flat';
  unitPrice: number; // cents
  vatRate: number;   // percent, 0 / 9 / 21
  discountPct?: number; // line discount
  optional?: boolean;   // extra the client may choose
  selected?: boolean;   // for optional lines: included in the agreed total
  productId?: ID;
  packageId?: ID;
  /** Invoice only: deduction of an earlier (deposit) invoice */
  refInvoiceId?: ID;
}

/** Frozen copy of the parties at the moment a document is sent/finalised. */
export interface PartySnapshot {
  name: string;
  attention?: string;
  address?: string; // multi-line
  email?: string;
  phone?: string;
  kvk?: string;
  vatId?: string;
  iban?: string;
  accountHolder?: string;
  website?: string;
}

export type VatMode = 'private' | 'kor' | 'vat';

export interface Quote extends Base {
  gigId: ID;
  version: number;
  number?: string; // O2026-G-0001, assigned when sent
  status: 'draft' | 'sent' | 'accepted' | 'declined' | 'expired' | 'superseded';
  language?: Lang;
  issueDate?: string;
  sentAt?: string;
  validUntil?: string; // yyyy-mm-dd
  acceptedAt?: string;
  acceptedBy?: string;
  acceptedVia?: 'whatsapp' | 'email' | 'phone' | 'in_person' | 'signed_pdf' | 'other';
  acceptedNote?: string;
  declinedReason?: string;
  lines: QuoteLine[];
  discountPct?: number; // on the total
  depositPct?: number;
  intro?: string;
  notes?: string;
  client?: PartySnapshot;
  seller?: PartySnapshot;
  vatMode?: VatMode;
}

export interface Product extends Base {
  name: string;
  nameEn?: string;
  description?: string;
  category?: 'performance' | 'sound' | 'light' | 'effects' | 'travel' | 'extra' | 'fee' | 'other';
  unit: QuoteLine['unit'];
  price: number; // cents
  vatRate: number;
  optionalByDefault?: boolean;
  active: boolean;
  /** App 5: gear kits this product needs on the packing list. */
  kitIds?: ID[];
}

export interface Package extends Base {
  name: string;
  description?: string;
  eventTypes: EventType[];
  items: { productId: ID; quantity: number; optional?: boolean }[];
  active: boolean;
}

export const INVOICE_KINDS = ['standard', 'deposit', 'final', 'credit_note', 'cancellation'] as const;
export type InvoiceKind = (typeof INVOICE_KINDS)[number];

export interface Invoice extends Base {
  number?: string; // assigned at finalisation, gapless per series
  series?: string; // e.g. F2026-G
  kind: InvoiceKind;
  gigId?: ID;
  quoteId?: ID;
  creditsInvoiceId?: ID; // credit notes: the invoice being credited
  personId?: ID;
  organisationId?: ID;
  status: 'draft' | 'sent' | 'paid' | 'credited';
  language: Lang;
  issueDate?: string;  // yyyy-mm-dd
  supplyDate?: string; // gig date
  dueDate?: string;
  lines: QuoteLine[];
  reference?: string;  // client PO / reference
  notes?: string;
  reason?: string;     // credit note / cancellation reason
  client: PartySnapshot;
  seller?: PartySnapshot;
  vatMode: VatMode;
  finalisedAt?: string;
  sentAt?: string;
  paidAt?: string;
  dunningPaused?: boolean;
}

export interface Payment extends Base {
  invoiceId: ID;
  date: string; // yyyy-mm-dd
  amount: number; // cents (negative = refund)
  method: 'bank' | 'cash' | 'tikkie' | 'ideal' | 'other';
  receivedBy?: Payer; // whose account the money landed on (default business)
  bankLineId?: ID;
  note?: string;
}

export interface StatusChange extends Base {
  gigId: ID;
  from: Stage | null;
  to: Stage;
  reason?: string;
  note?: string;
}

export interface AvailabilityBlock extends Base {
  memberId: MemberId;
  from: string; // yyyy-mm-dd
  to: string;   // yyyy-mm-dd inclusive
  kind: 'holiday' | 'personal' | 'other_job' | 'other';
  note?: string;
}

export const TASK_KINDS = [
  'reply_enquiry', 'follow_up_quote', 'quote_expiry', 'option_expiry', 'music_wishes', 'final_check',
  'gear_check', 'mark_played', 'invoice', 'payment', 'review_request', 'rebook', 'dunning', 'custom',
  'contract_review', 'contract_reminder', 'contract_expired', 'contract_deposit',
  'gear_missing', 'gear_return',
] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export interface Task extends Base {
  title: string;
  kind: TaskKind;
  dueAt: string; // ISO
  assignedTo: Assignee;
  gigId?: ID;
  personId?: ID;
  enquiryId?: ID;
  invoiceId?: ID;
  status: 'open' | 'done' | 'cancelled';
  snoozedUntil?: string;
  completedAt?: string;
  completedBy?: MemberId;
  ruleKey?: string; // set when created by the reminder engine
  templateKind?: TemplateKind;
}

export const INTERACTION_CHANNELS = ['call', 'whatsapp', 'email', 'instagram', 'meeting', 'note'] as const;
export type InteractionChannel = (typeof INTERACTION_CHANNELS)[number];

export interface Interaction extends Base {
  at: string;
  channel: InteractionChannel;
  direction: 'in' | 'out' | 'none';
  summary: string;
  personId?: ID;
  gigId?: ID;
  enquiryId?: ID;
}

export const TEMPLATE_KINDS = [
  'enquiry_available', 'enquiry_unavailable', 'quote_follow_up', 'music_wishes', 'final_check',
  'thank_you_review', 'rebook', 'quote_send', 'invoice_send', 'reminder_1', 'reminder_2', 'reminder_3', 'custom',
  'contract_send', 'contract_reminder', 'contract_signed',
] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

export interface Template extends Base {
  name: string;
  kind: TemplateKind;
  language: Lang;
  subject?: string;
  body: string;
}

export interface Review extends Base {
  gigId: ID;
  requestedAt?: string;
  platform?: 'google' | 'instagram' | 'facebook' | 'website' | 'other';
  receivedAt?: string;
  rating?: number;
  text?: string;
  mayPublish?: boolean;
}

export interface Settings {
  key: 'settings';
  language: Lang;
  theme: 'dark' | 'light' | 'auto';
  minGapMinutes: number;       // gap needed between two same-day gigs without build-up
  optionDays: number;          // default option expiry
  replyHours: number;          // reply to enquiry within
  quoteFollowUp1Days: number;
  quoteFollowUp2Days: number;
  quoteValidDays: number;
  musicWishesDays: number;
  finalCheckDays: number;
  gearCheckDays: number;
  reviewDays: number;
  paymentCheckDays: number;
  rebookMonthsBefore: number;
  defaultVatRate: number;
  reviewLink?: string;
  businessName: string;
  // ---- Quotes & Invoices (app 2) ----
  vatMode: VatMode;
  legalNames?: string;    // e.g. "G. van Doren & C. …"
  address?: string;       // street + number
  postcode?: string;
  city?: string;
  kvk?: string;
  vatId?: string;
  iban?: string;          // entered by the user on the device, never in code
  accountHolder?: string;
  bizEmail?: string;
  bizPhone?: string;
  website?: string;
  paymentTermDays: number;
  depositPct: number;
  cancellationScale: { daysBefore: number; pct: number }[]; // sorted desc by daysBefore
  dunning1Days: number;
  dunning2Days: number;
  dunning3Days: number;
  notePrivate: string;
  noteKor: string;
  termsNl: string;
  termsEn: string;
  // ---- Money & Accounting (app 3) ----
  splitRules: SplitRule[];
  mileageRate: number;      // cents per km
  homeGijs?: string;
  homeCoen?: string;
  taxSetAsidePct: number;   // indication for income tax + Zvw
  assetMinCents: number;    // capitalise from (excl. VAT)
  lastBackupAt?: string;
  // ---- Contracts (app 4) ----
  /** Cancellation scale for consumers (softer far ahead). `cancellationScale` applies to business clients. */
  cancellationScaleConsumer: { daysBefore: number; pct: number }[];
  contractSignByDays: number;      // date hold while the contract is unsigned
  contractReminderDays: number;    // first reminder after sending
  contractAutoCountersign: boolean;
  overtimeRateHalfHour: number;    // cents per started half hour
  memberSignatures?: Partial<Record<MemberId, string>>; // PNG data URL, drawn once per member, device only
  // ---- Gear & Inventory (app 5) ----
  gearTrailerMaxKg: number;        // maximum mass of the trailer (incl. its own weight)
  gearTrailerEmptyKg?: number;     // empty weight → payload = max - empty
  gearBufferMinutes: number;       // reservation buffer before/after a gig (load, travel)
  gearSafetyTests: boolean;        // NEN 3140 tests on/off
  gearSafetyMonths: number;
  gearSafetyMonthsPower: number;   // extension cables, power strips, distribution
  gearInsurer?: string;            // empty = not insured
  gearInsuredSum?: number;         // cents
  /** group = scanning a case ticks off everything in it; each = every item must be scanned itself. */
  gearLoadScan: 'group' | 'each';
  gearUnloadScan: 'group' | 'each';
  gearLabelPresets?: LabelPreset[];
  gigDay?: Partial<GigDayDefaults>; // App 6 timeline defaults (missing keys → DEFAULT_GIGDAY)
}

export const DEFAULT_SETTINGS: Settings = {
  key: 'settings',
  language: 'nl',
  theme: 'dark',
  minGapMinutes: 120,
  optionDays: 14,
  replyHours: 24,
  quoteFollowUp1Days: 5,
  quoteFollowUp2Days: 12,
  quoteValidDays: 14,
  musicWishesDays: 42,
  finalCheckDays: 14,
  gearCheckDays: 7,
  reviewDays: 2,
  paymentCheckDays: 14,
  rebookMonthsBefore: 9,
  defaultVatRate: 0,
  reviewLink: '',
  businessName: 'Team Funqtion',
  vatMode: 'private',
  paymentTermDays: 14,
  depositPct: 50,
  cancellationScale: [
    { daysBefore: 90, pct: 25 },
    { daysBefore: 30, pct: 50 },
    { daysBefore: 7, pct: 75 },
    { daysBefore: 0, pct: 100 },
  ],
  dunning1Days: 3,
  dunning2Days: 14,
  dunning3Days: 28,
  notePrivate: 'Er wordt geen btw in rekening gebracht.',
  noteKor: 'Btw vrijgesteld – kleineondernemersregeling (KOR).',
  termsNl: '',
  termsEn: '',
  splitRules: [{ validFrom: '2000-01-01', method: 'fixed', gijsPct: 50, soloPct: 80 }],
  mileageRate: 23,
  taxSetAsidePct: 30,
  assetMinCents: 45000,
  cancellationScaleConsumer: [
    { daysBefore: 183, pct: 10 },
    { daysBefore: 91, pct: 25 },
    { daysBefore: 30, pct: 50 },
    { daysBefore: 14, pct: 75 },
    { daysBefore: 0, pct: 100 },
  ],
  contractSignByDays: 7,
  contractReminderDays: 3,
  contractAutoCountersign: true,
  overtimeRateHalfHour: 7500,
  gearTrailerMaxKg: 750,
  gearBufferMinutes: 120,
  gearSafetyTests: false,
  gearSafetyMonths: 12,
  gearSafetyMonthsPower: 6,
  gearLoadScan: 'group',
  gearUnloadScan: 'each',
};

// ---- App 3: Money & Accounting ------------------------------------------------

export type Payer = 'business' | MemberId;

export interface Category extends Base {
  key: string;
  name: string;
  nameEn: string;
  kind: 'expense' | 'income';
  deductiblePct: number;   // e.g. 80 for food & drinks (representation)
  defaultVatRate: number;  // 21 / 9 / 0
  defaultBusinessPct: number;
  accountCode?: string;    // grootboek code for the accountant
  asset?: boolean;         // purchases in this category become assets
  icon?: string;
  active: boolean;
}

export interface Expense extends Base {
  date: string;           // yyyy-mm-dd
  supplier: string;
  description?: string;
  categoryId: ID;
  amount: number;         // incl. VAT, cents
  vatAmount: number;      // cents
  vatRate: number;        // %
  businessPct: number;    // 0..100 business share
  paidBy: Payer;
  gigId?: ID;
  assetId?: ID;
  receiptIds: ID[];
  bankLineId?: ID;
  reverseCharge?: boolean; // foreign service, VAT reverse-charged
  status: 'ok' | 'missing_receipt';
  note?: string;
}

export interface Receipt extends Base {
  blob: Blob;
  mime: string;
  size: number;
  sha256: string;
  name?: string;
  ocrText?: string;
  expenseId?: ID;
}

export interface BankAccount extends Base {
  name: string;
  bank?: string;
  ibanMasked?: string;
  owner: Payer;
  active: boolean;
}

export interface BankMatch { type: 'payment' | 'expense' | 'partner'; id: ID; amount: number }

export interface BankLine extends Base {
  accountId: ID;
  date: string;
  amount: number;         // signed cents (+ in, − out)
  counterparty: string;
  counterIban?: string;
  description: string;
  hash: string;
  batchId: string;
  status: 'unmatched' | 'matched' | 'private' | 'transfer' | 'ignored';
  matches: BankMatch[];
}

export interface BankRule extends Base {
  match: string;          // lower-case text found in counterparty/description
  action: 'expense' | 'private' | 'transfer' | 'ignore';
  categoryId?: ID;
  businessPct?: number;
}

export interface Trip extends Base {
  date: string;
  gigId?: ID;
  driver: MemberId;
  from: string;
  to: string;
  purpose: string;
  km: number;             // one way
  roundTrip: boolean;
  source: 'venue' | 'manual' | 'estimate' | 'nav';
  parking?: number;       // cents
  // Driven with Maps (source 'nav'). Simulated drives are never stored here.
  startedAt?: string;     // ISO
  endedAt?: string;
  vehicleId?: ID;
  trailerId?: ID;
  vehicleName?: string;
  trailerName?: string;
  arrived?: boolean;
}

export interface HourEntry extends Base {
  memberId: MemberId;
  date: string;
  hours: number;
  kind: 'gig' | 'travel' | 'prep' | 'promo' | 'admin' | 'training' | 'other';
  gigId?: ID;
  note?: string;
}

export interface Asset extends Base {
  name: string;
  purchaseDate: string;
  cost: number;           // excl. VAT, cents
  residual: number;       // cents
  lifeYears: number;
  businessPct: number;
  paidBy: Payer;
  expenseId?: ID;
  serial?: string;
  disposedAt?: string;
  disposalAmount?: number;
  note?: string;
}

export interface PartnerEntry extends Base {
  memberId: MemberId;     // who paid / received
  date: string;
  kind: 'contribution' | 'withdrawal' | 'settlement';
  toMemberId?: MemberId;  // settlement: paid to the other partner
  amount: number;         // cents, positive
  note?: string;
}

export interface VatPeriod extends Base {
  key: string;            // 2027-Q1
  boxes: Record<string, number>;
  filedAt?: string;
  paidAt?: string;
  note?: string;
}

export interface SplitRule {
  validFrom: string;      // yyyy-mm-dd
  method: 'fixed' | 'by_lineup';
  gijsPct: number;        // fixed / shared items
  soloPct: number;        // by_lineup: share for the solo performer
}

// ---- App 4: Contracts ----------------------------------------------------------

export type ClientKind = 'consumer' | 'business';
/** together = quote and contract go out at once, one "akkoord" covers both;
 *  after_quote = contract follows the accepted quote; none = quote acceptance is enough. */
export type ContractFlow = 'together' | 'after_quote' | 'none';
export type ClauseMode = 'required' | 'on' | 'off' | 'auto';
export type ClauseWhen = 'outdoor' | 'setup' | 'consumer' | 'business';
export const CLAUSE_CATEGORIES = ['core', 'money', 'cancellation', 'liability', 'venue', 'rights', 'other'] as const;
export type ClauseCategory = (typeof CLAUSE_CATEGORIES)[number];

export interface Clause extends Base {
  key: string;              // stable id, e.g. "A1"
  category: ClauseCategory;
  version: number;          // bumped on every edit; contracts keep the version they were sent with
  titleNl: string;
  titleEn: string;
  bodyNl: string;           // plain text with {{placeholders}}; lines starting with "- " are bullets
  bodyEn: string;
  bodyBizNl?: string;       // business-client variant (optional)
  bodyBizEn?: string;
  only?: ClientKind;        // e.g. "no cooling-off period" is consumer-only
  locked?: boolean;         // cannot be switched off
  note?: string;            // internal legal note
  sort: number;
  active: boolean;
}

export interface TemplateClause { key: string; mode: ClauseMode; when?: ClauseWhen }

export interface ContractTemplate extends Base {
  name: string;
  nameEn?: string;
  eventTypes: EventType[];
  clientKind: ClientKind;
  flow: ContractFlow;
  signByDays?: number;
  introNl?: string;
  introEn?: string;
  clauses: TemplateClause[];
  riderId?: ID;
  active: boolean;
}

export interface RiderItem { id: ID; nl: string; en: string }

export interface Rider extends Base {
  name: string;
  version: number;
  technical: RiderItem[];
  hospitality: RiderItem[];
  active: boolean;
}

export interface CancellationRow { pct: number; daysBefore: number; from?: string; until?: string }

export interface ContractSnapshot {
  language: Lang;
  clientKind: ClientKind;
  number: string;
  issuedOn: string;               // yyyy-mm-dd
  client: PartySnapshot;
  funqtion: PartySnapshot & { legalNames?: string };
  event: {
    title: string; reference: string; date: string; startTime: string; endTime: string; setupTime?: string;
    venueName: string; venueAddress: string; outdoor: boolean;
    sets: { start: string; end: string; label?: string; performers: string }[];
  };
  services: { description: string; qty: string; amount: number }[];
  extras: { id: ID; description: string; amount: number }[];
  price: {
    total: number; totalWithAllExtras: number; vatNote: string; depositPct: number; depositAmount: number;
    balance: number; paymentTermDays: number; overtimeRate: number;
  };
  cancellation: CancellationRow[];
  intro: string;
  specialTerms: string;
  clauses: { key: string; version: number; nr: number; title: string; body: string }[];
  rider: { name: string; version: number; technical: string[]; hospitality: string[]; venueNotes: string[] } | null;
  terms: { version: string; sha256: string; text: string };
  quote?: { id: ID; number?: string; version: number; accepted: boolean };
  addendum?: { label: string; parentLabel: string; parentHash: string; reason: string; changes: { field: string; old: string; new: string }[] };
}

export type ContractStatus = 'draft' | 'sent' | 'viewed' | 'signed' | 'cancelled';

export interface Contract extends Base {
  number: string;
  gigId: ID;
  quoteId?: ID;
  templateId?: ID;
  kind: 'ours' | 'theirs';        // theirs = the client's own paper, only tracked
  clientKind: ClientKind;
  language: Lang;
  flow: ContractFlow;
  status: ContractStatus;
  clauseOverrides: Record<string, boolean>;
  specialTerms?: string;
  overtimeRate?: number;
  riderId?: ID;
  title?: string;                  // theirs: description of their document
  signBy?: string;                 // yyyy-mm-dd
  sentAt?: string;
  signedAt?: string;
  currentVersionId?: ID;           // latest frozen version (sent)
  signedVersionId?: ID;            // latest fully signed version (contract or addendum)
  pendingAddendum?: { reason: string };
  depositInvoiceId?: ID;
  cancelledAt?: string;
  cancelledBy?: 'client' | 'us' | 'force_majeure';
  cancellationReason?: string;
  cancellationFee?: number;
  remindersPaused?: boolean;
}

export interface ContractVersion extends Base {
  contractId: ID;
  seq: number;
  kind: 'contract' | 'addendum';
  label: string;                   // "v1", "Addendum 1"
  snapshot: ContractSnapshot;
  contentHash: string;             // sha256 of the canonical JSON of the snapshot
  prevHash?: string;               // addendum: hash of the signed version it amends
  frozenAt: string;
  status: 'sent' | 'superseded' | 'signed' | 'void';
  signedAt?: string;
}

export type SignatureMethod = 'drawn_on_device' | 'reply_akkoord' | 'signed_pdf' | 'countersign';

export interface ContractSignature extends Base {
  contractId: ID;
  versionId: ID;
  party: 'client' | 'funqtion';
  name: string;
  role?: string;
  email?: string;
  memberId?: MemberId;
  method: SignatureMethod;
  channel?: 'whatsapp' | 'email' | 'phone' | 'in_person' | 'other';
  level: 'SES';
  signedAt: string;               // ISO
  contentHash: string;            // hash of the version that was signed
  consents: { contract: boolean; terms: string; termsSha256: string; photoOptOut: boolean };
  selectedExtras?: ID[];
  imageDataUrl?: string;
  evidenceDataUrl?: string;
  device?: string;
  place?: string;
  note?: string;
}

export interface ContractEvent extends Base {
  contractId: ID;
  versionId?: ID;
  type: 'generated' | 'sent' | 'signed_client' | 'signed_funqtion' | 'fully_signed' | 'reminder' | 'note' | 'addendum_started'
    | 'withdrawn' | 'cancelled' | 'copy_sent' | 'deposit_invoice' | 'conflict';
  at: string;
  note?: string;
}

// ---- App 5: Gear & Inventory ------------------------------------------------

export const GEAR_CATEGORIES = [
  'decks', 'mixers', 'laptops', 'headphones', 'speakers', 'subs', 'monitors', 'lighting', 'lasers', 'effects', 'dmx',
  'power', 'audio_cables', 'stands', 'cases', 'furniture', 'tools', 'small',
] as const;
export type GearCategory = (typeof GEAR_CATEGORIES)[number];
/** unique = own tag; counted = quantity without a tag per piece; container = case/bag/rack, scanning it ticks off its contents. */
export type GearKind = 'unique' | 'counted' | 'container';
export type GearOwner = MemberId | 'shared' | 'unknown';
export type GearStatus = 'available' | 'out' | 'out_of_service' | 'in_repair' | 'lent' | 'missing' | 'disposed';
export type GearTransport = 'trailer' | 'car';

export interface GearLocation extends Base {
  key?: string;              // seeded: home_gijs, home_coen, trailer, car
  name: string;
  type: 'home' | 'storage' | 'vehicle' | 'venue' | 'repair' | 'third_party' | 'on_the_road';
  venueId?: ID;
  note?: string;
}

export interface GearItem extends Base {
  code: string;              // FQ-01.2-8 (tree code + check character) or an old FQ-0042; printed under the QR code
  aliases?: string[];        // earlier codes after a relabel: old labels keep scanning
  kind: GearKind;
  name: string;
  category: GearCategory;
  brand?: string;
  model?: string;
  serial?: string;
  quantity: number;          // counted items; 1 otherwise
  owner: GearOwner;
  homeLocationId?: ID;
  locationId?: ID;           // where it is now
  parentId?: ID;             // container it normally lives in (containers can sit in containers: a tree)
  status: GearStatus;
  transport: GearTransport;
  weightKg?: number;
  purchaseDate?: string;
  purchasePrice?: number;    // cents, as paid
  replacementValue?: number; // cents, new price today
  supplier?: string;
  expenseId?: ID;            // App 3 purchase
  assetId?: ID;              // App 3 depreciation
  warrantyUntil?: string;
  electrical: 'class1' | 'class2' | 'none';
  powerW?: number;
  usageHours: number;
  usageGigs: number;
  firmware?: string;
  laserClass?: string;
  labelType?: LabelType;     // preferred label size (older field; the preset decides)
  labelPreset?: string;      // LabelPreset id
  notes?: string;
}

/** QR large for cases and big gear, QR small, or a Code 128 barcode strip (wraps around cables). */
export type LabelType = 'qr_large' | 'qr_small' | 'barcode';
export type Paint = 'black' | 'white' | 'orange';

/** A label design (Gear → Labels → Ontwerpen). Built-ins: plain and Funqtion style per size. */
export interface LabelPreset {
  id: string;
  name: string;
  size: LabelType;                 // qr_large / qr_small / barcode
  background: Paint;               // the whole label
  symbol: Paint;                   // QR modules / barcode bars
  patch: boolean;                  // white box behind the code (scans everywhere, also on black labels)
  modules: 'square' | 'rounded' | 'dots'; // QR only
  logo: boolean;                   // QR: Funqtion logo in the middle; barcode: logo at the start
  frame: 'none' | 'brackets' | 'line';
  showCode: boolean;
  showName: boolean;
  showOwner: boolean;              // "Eigendom van Team Funqtion · 06-…"
  showTagline: boolean;            // FEEL THE MUSIQ
  customText?: string;             // e.g. @funqtionofficial
  repeat: 1 | 2 | 3;               // barcode: copies per strip
  barHeight: 'low' | 'mid' | 'high';
}


export interface GearPhoto extends Base {
  itemId: ID;
  kind: 'main' | 'serial' | 'receipt' | 'damage';
  mime: string;
  blob: Blob;
}

export const KIT_ROLES = ['standard', 'dj_controller', 'dj_usb', 'dj_light', 'always', 'outdoor', 'custom'] as const;
export type KitRole = (typeof KIT_ROLES)[number];

export interface GearKit extends Base {
  name: string;
  role: KitRole;
  lines: { itemId: ID; qty: number }[];
  note?: string;
}

export interface PackLine {
  id: ID;
  itemId: ID;
  qty: number;
  source: 'kit' | 'quote' | 'always' | 'outdoor' | 'manual';
  reason: string;
  out: number;               // checked out
  back: number;              // checked back in
  missing?: 'later' | 'venue' | 'lost' | 'broken';
  skip?: boolean;            // on the list, but not taken this time
}

export interface PackList extends Base {
  gigId: ID;
  status: 'draft' | 'confirmed' | 'loading' | 'out' | 'done';
  setup: KitRole;            // base kit for this gig (standard or a DJ-only variant)
  phone?: MemberId;          // the gig phone: who loads/unloads
  lines: PackLine[];
  loadedAt?: string;
  returnedAt?: string;
  laser?: { checks: Record<string, boolean>; crowdScan: boolean; permissionBy?: string; at?: string };
  trailer?: { empty: boolean; hitchLock: boolean };
  note?: string;
}

export interface GearMovement extends Base {
  itemId: ID;
  qty: number;
  type: 'check_out' | 'check_in' | 'move' | 'lend_out' | 'return' | 'to_repair' | 'from_repair' | 'missing' | 'found' | 'dispose';
  gigId?: ID;
  rentalId?: ID;
  toLocationId?: ID;
  at: string;
  method: 'scan' | 'manual';
  note?: string;
}

export interface GearIssue extends Base {
  itemId: ID;
  gigId?: ID;
  title: string;
  description?: string;
  severity: 'minor' | 'out_of_service';
  causedByGuests?: boolean;
  status: 'open' | 'in_repair' | 'resolved' | 'written_off';
  repairBy?: string;
  sentAt?: string;
  expectedBack?: string;
  resolvedAt?: string;
  work?: string;
  cost?: number;             // cents
  expenseId?: ID;
}

export interface MaintenancePlan extends Base {
  itemId?: ID;               // one item…
  category?: GearCategory;   // …or every item in a category
  title: string;
  trigger: 'days' | 'hours' | 'gigs';
  interval: number;
  instructions?: string;
  active: boolean;
}

export interface MaintenanceLog extends Base {
  planId?: ID;
  itemId: ID;
  doneAt: string;            // yyyy-mm-dd
  result: 'ok' | 'issue';
  usageHours: number;
  usageGigs: number;
  note?: string;
}

export interface SafetyTest extends Base {
  itemId: ID;
  date: string;
  inspector: string;
  passed: boolean;
  labelNo?: string;
  nextDue: string;
  note?: string;
}

export interface GearRental extends Base {
  direction: 'in' | 'out';
  party: string;
  personId?: ID;
  gigId?: ID;
  lines: { itemId?: ID; description: string; qty: number }[];
  from: string;
  until: string;
  returnedAt?: string;
  price?: number;            // cents
  deposit?: number;
  expenseId?: ID;
  note?: string;
}

export interface WishItem extends Base {
  name: string;
  category?: GearCategory;
  link?: string;
  price?: number;            // cents
  priority: 'must' | 'nice' | 'dream';
  for: GearOwner;
  reason?: string;
  status: 'idea' | 'saving' | 'ordered' | 'bought' | 'dropped';
  boughtItemId?: ID;
}

// ---- navigation (Maps) ------------------------------------------------------

/** A car or trailer, shared by Maps (routing) and Gear (trailer payload). */
export interface VehicleRecord extends Base {
  kind: 'car' | 'trailer';
  name: string;
  /** Maps' full profile (dimensions, weights, fuel, towing…); see src/apps/maps/features/vehicles/profiles.ts. */
  spec: Record<string, unknown>;
}
/** The DJ gear trailer: Gear takes its maximum mass and empty weight from this record. */
export const GEAR_TRAILER_ID = 'dj-gear';

export interface VenuePhoto extends Base {
  venueId: ID;
  blob: Blob;
  mime: string;
  gigId?: ID;
  kind?: 'entrance' | 'parking' | 'power' | 'stage' | 'booth' | 'other';
  caption?: string;
}

export type GigDayStatus = 'draft' | 'planned' | 'live' | 'wrapping_up' | 'closed';
export type GigDaySetup = 'standard' | 'dj_only';

/** Per-gig day plan. Maps fills the drive part; Gig Day (app 6) the rest. */
export interface GigDay extends Base {
  gigId: ID;
  status?: GigDayStatus;
  setup?: GigDaySetup;
  doorsAt?: string;         // HH:mm
  curfew?: string;          // HH:mm
  noiseLimitDb?: number;
  drivers?: MemberId[];     // who drives (each gets a leave time)
  pickup?: { by: MemberId; minutes: number; note?: string }; // detour to collect gear at the other's home
  travelByMember?: Partial<Record<MemberId, number>>;       // minutes, estimate or manual
  plannedAt?: string;
  liveAt?: string;
  closedAt?: string;
  wrapUp?: Record<string, string>;  // action → ISO when done
  setupBufferMin?: number;
  trafficMarginPct?: number;
  travelMinutes?: number;   // drive time without margin
  arrivedAt?: string;       // ISO, set by Maps when a real (not simulated) drive to this gig arrives
  route?: { seconds: number; meters: number; fromName: string; towing: boolean; computedAt: number };
}

/** GPS track of a driven trip (id = trip id). Large: not in backups. */
export interface TrackRecord { id: ID; points: [number, number][] }

// ---- app 6: Gig Day ---------------------------------------------------------

export const STEP_KINDS = [
  'leave_home', 'pickup', 'arrive', 'setup', 'soundcheck', 'doors', 'set_start', 'set_end', 'moment',
  'curfew', 'breakdown', 'leave_venue', 'home', 'custom',
] as const;
export type StepKind = (typeof STEP_KINDS)[number];

export interface TimelineStep extends Base {
  gigId: ID;
  kind: StepKind;
  label: string;
  plannedAt: string;        // ISO
  actualAt?: string;        // ISO, set when done
  memberId?: MemberId;      // per-person steps (leave home, pickup)
  locked?: boolean;         // set by hand: regeneration keeps it
  sourceRef?: string;       // setSlot id / music wish id
}

export const DAY_PHASES = ['prep', 'departure', 'setup', 'playing', 'breakdown', 'wrapup'] as const;
export type DayPhase = (typeof DAY_PHASES)[number];

export interface DayTask extends Base {
  gigId: ID;
  phase: DayPhase;
  title: string;
  owner: MemberId | 'both';
  done?: boolean;
  doneAt?: string;
  doneBy?: MemberId;
  templateKey?: string;
  sort: number;
}

export interface TaskTemplateItem { phase: DayPhase; title: string; owner: MemberId | 'both'; laserOnly?: boolean; outdoorOnly?: boolean }
export interface TaskTemplate extends Base {
  key: string;
  name: string;
  setup: GigDaySetup | 'any';
  eventTypes: EventType[];  // empty = all
  items: TaskTemplateItem[];
  active: boolean;
}

export const LOG_TYPES = [
  'leave', 'arrive', 'setup_start', 'soundcheck_done', 'doors', 'set_start', 'set_end', 'overtime_request',
  'moment_done', 'issue', 'damage', 'complaint', 'compliment', 'vibe', 'note', 'late', 'left_venue', 'home',
] as const;
export type LogType = (typeof LOG_TYPES)[number];

/** Append-only: two phones logging at once never conflict. */
export interface GigLog extends Base {
  gigId: ID;
  at: string;               // ISO
  by: MemberId;
  type: LogType;
  text?: string;
  minutes?: number;         // late / overtime
  requestedBy?: string;     // overtime: who asked
  vibe?: number;            // 1–5
  issueId?: ID;             // damage → App 5 issue
  stepId?: ID;
}

export const VENUE_NOTE_KINDS = ['load_in', 'parking', 'power', 'stage', 'wifi', 'access', 'noise', 'contact', 'general'] as const;
export type VenueNoteKind = (typeof VENUE_NOTE_KINDS)[number];
export interface VenueNote extends Base {
  venueId: ID;
  gigId?: ID;
  kind: VenueNoteKind;
  text: string;
  stale?: boolean;          // "klopt niet meer"
}

/** Defaults for the generated timeline (Gig Day → Instellingen). */
export interface GigDayDefaults {
  doorsBeforeFirstSet: number;
  soundcheckBeforeDoors: Record<GigDaySetup, number>;
  setupMinutes: Record<GigDaySetup, number>;
  breakdownMinutes: Record<GigDaySetup, number>;
  arriveBeforeSetup: number;
  leaveBuffer: number;
  avgSpeedKmh: number;
  avgSpeedTrailerKmh: number;
  wrapUpAt: string;         // HH:mm next morning
  dayBeforeAt: string;      // HH:mm
}
export const DEFAULT_GIGDAY: GigDayDefaults = {
  doorsBeforeFirstSet: 30,
  soundcheckBeforeDoors: { standard: 30, dj_only: 15 },
  setupMinutes: { standard: 90, dj_only: 30 },
  breakdownMinutes: { standard: 60, dj_only: 20 },
  arriveBeforeSetup: 15,
  leaveBuffer: 15,
  avgSpeedKmh: 60,
  avgSpeedTrailerKmh: 55,
  wrapUpAt: '10:00',
  dayBeforeAt: '18:00',
};

// ---- apps 7–9: Library, Sets, Requests ----------------------------------------

export const CROWD_TYPES = ['wedding', 'village_festival', 'club', 'after_party', 'private', 'company', 'kids'] as const;
export type CrowdType = (typeof CROWD_TYPES)[number];
export const MOODS = ['feelgood', 'euphoric', 'dark', 'emotional', 'party', 'chill'] as const;
export type Mood = (typeof MOODS)[number];
export const TRACK_FLAGS = ['classic', 'banger', 'singalong', 'clean', 'explicit', 'dutch'] as const;
export type TrackFlag = (typeof TRACK_FLAGS)[number];
export const TRACK_SOURCES = ['stream', 'download', 'converted', 'cd_rip', 'promo', 'own_production', 'unknown'] as const;
export type TrackSource = (typeof TRACK_SOURCES)[number];

export interface CueNote { id: ID; kind: 'drop' | 'mix_in' | 'mix_out' | 'break' | 'vocal_in' | 'warning' | 'tip'; atS?: number; text: string }
/** Hot cue read from the DJ software (read-only copy). */
export interface HotCue { index: number; atMs: number; name?: string; color?: string }

/** One song version (artist + title + mix). Files are copies of it; stream-only tracks have none. */
export interface Track extends Base {
  artist: string;
  title: string;
  mix?: string;
  album?: string;
  label?: string;
  year?: number;
  genre?: string;
  isrc?: string;
  bpm?: number;
  key?: string;              // Camelot, e.g. "8A"
  keyConfidence?: number;    // 0–1, from our analysis
  durationS?: number;
  energy?: number;           // 1–10
  moods: Mood[];
  crowd: CrowdType[];
  vocal?: 'vocal' | 'instrumental' | 'acapella';
  flags: TrackFlag[];
  rating?: number;           // 1–5
  comment?: string;          // the file's own comment (without our prefix)
  owner: MemberId | 'shared';
  status: 'inbox' | 'ok' | 'needs_fix' | 'retired';
  source: TrackSource;
  sourceNote?: string;
  sourceUrl?: string;
  stream?: { service: string; ref?: string };  // stream-only tracks (Serato/djay streaming)
  cueNotes: CueNote[];
  hotCues?: HotCue[];        // read from Serato
  artworkId?: ID;
  analysedAt?: string;
}

export interface MusicLocation extends Base {
  name: string;              // "MacBook Gijs – Music", "USB Zwart"
  kind: 'laptop' | 'external' | 'usb' | 'nas';
  owner: MemberId | 'shared';
  rootPath?: string;         // absolute path in the desktop app; empty in the browser
  lastScanAt?: string;
  scanSummary?: { files: number; added: number; missing: number; errors: number };
}

export interface TrackFile extends Base {
  trackId: ID;
  locationId: ID;
  path: string;              // relative to the location root
  format: string;            // mp3, m4a, flac, wav, aiff…
  sizeBytes: number;
  mtime?: number;
  bitrate?: number;          // kbps
  sampleRate?: number;
  audioHash: string;         // sha-256 of the audio part (tags excluded where we can)
  quality: 'ok' | 'low' | 'transcode_suspect' | 'broken' | 'unknown';
  cutoffHz?: number;
  lastSeenAt: string;
  missing?: boolean;
}

export interface Artwork extends Base { hash: string; blob: Blob; mime: string }

export interface TrackLink extends Base {
  fromTrackId: ID;
  toTrackId: ID;
  kind: 'good_after' | 'avoid_after' | 'mashup';
  note?: string;
  learned?: boolean;
}

// Sets (app 8)
export const SECTION_KINDS = ['dinner', 'warmup', 'build', 'peak', 'classics', 'cooldown', 'afterparty', 'moment'] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];
export interface SetSection {
  id: ID;
  kind: SectionKind;
  label: string;
  minutes: number;
  energyFrom: number;
  energyTo: number;
  bpmMin?: number;
  bpmMax?: number;
  performer?: MemberId | 'b2b';
  setSlotId?: ID;            // App 1 set slot
  startAt?: string;          // ISO, when linked to a gig
}
export interface SetItem {
  id: ID;
  sectionId: ID;
  trackId: ID;
  performer?: MemberId;
  role: 'planned' | 'backup' | 'must_play' | 'moment';
  momentWishId?: ID;
  note?: string;
  locked?: boolean;
}
export interface SetTemplate extends Base {
  key: string;
  name: string;
  eventTypes: EventType[];
  sections: Omit<SetSection, 'id' | 'setSlotId' | 'startAt'>[];
  rules: { maxSameArtistPerHour: number; explicitAllowed: boolean };
  active: boolean;
}
export interface SetPlan extends Base {
  name: string;
  gigId?: ID;
  templateKey?: string;
  status: 'draft' | 'ready' | 'played';
  sections: SetSection[];
  items: SetItem[];
  blocked: string[];         // normalised "artist - title" or "artist:<name>" from do-not-play wishes
}

/** What was really played (append-only). */
export interface Play extends Base {
  gigId?: ID;
  setPlanId?: ID;
  trackId?: ID;
  rawArtist?: string;
  rawTitle?: string;
  at: string;                // ISO
  performer?: MemberId;
  source: 'tap' | 'plan' | 'serato_history' | 'request';
  reaction?: 'fire' | 'good' | 'meh' | 'empty';
  requestId?: string;
}

/** Requests (app 9): what a session left behind, without personal data. */
export interface RequestStat extends Base {
  gigId?: ID;
  sessionCode: string;
  artist: string;
  title: string;
  normKey: string;
  votes: number;
  status: string;
  trackId?: ID;
}
