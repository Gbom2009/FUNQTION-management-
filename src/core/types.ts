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
}

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
};
