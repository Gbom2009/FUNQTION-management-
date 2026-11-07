import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../core/db';
import { alive, nowIso, save, uid } from '../../core/repo';
import { gigWindow, todayStr } from '../../core/dates';
import {
  DEFAULT_SETTINGS, type Category, type Expense, type GearIssue, type GearItem, type GearKit, type GearLocation, type GearMovement, type GearPhoto, type GearRental,
  type KitRole, type MaintenanceLog, type MaintenancePlan, type MemberId, type PackLine, type PackList, type SafetyTest, type Settings, type WishItem,
} from '../../core/types';
import { runTaskSync } from '../bookings/domain/taskSync';
import { applyScan, defaultSetup, gearConflicts, generateLines, itemsFromCsv, itemsToCsv, mergeLines, nextCode, nextSafetyDate, normaliseCode, parseCsv, type ScanOutcome } from './domain/gear';

const EMPTY: never[] = [];
export const useGearItems = () => alive(useLiveQuery(() => db.gearItems.toArray(), []) ?? EMPTY) as GearItem[];
export const useGearKits = () => alive(useLiveQuery(() => db.gearKits.toArray(), []) ?? EMPTY) as GearKit[];
export const useGearLocations = () => alive(useLiveQuery(() => db.gearLocations.toArray(), []) ?? EMPTY) as GearLocation[];
export const usePackLists = () => alive(useLiveQuery(() => db.packLists.toArray(), []) ?? EMPTY) as PackList[];
export const useIssues = () => alive(useLiveQuery(() => db.gearIssues.toArray(), []) ?? EMPTY) as GearIssue[];
export const usePlans = () => alive(useLiveQuery(() => db.maintenancePlans.toArray(), []) ?? EMPTY) as MaintenancePlan[];
export const useLogs = () => alive(useLiveQuery(() => db.maintenanceLogs.toArray(), []) ?? EMPTY) as MaintenanceLog[];
export const useSafetyTests = () => alive(useLiveQuery(() => db.safetyTests.toArray(), []) ?? EMPTY) as SafetyTest[];
export const useRentals = () => alive(useLiveQuery(() => db.gearRentals.toArray(), []) ?? EMPTY) as GearRental[];
export const useWishlist = () => alive(useLiveQuery(() => db.wishlist.toArray(), []) ?? EMPTY) as WishItem[];
export const usePhotoMeta = () => alive(useLiveQuery(() => db.gearPhotos.toArray(), []) ?? EMPTY) as GearPhoto[];
export const useMovements = (itemId?: string) =>
  alive(useLiveQuery(() => (itemId ? db.gearMovements.where('itemId').equals(itemId).toArray() : []), [itemId]) ?? EMPTY).sort((a, b) => b.at.localeCompare(a.at)) as GearMovement[];

async function settings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...((await db.settings.get('settings')) ?? {}) };
}

// ---------------------------------------------------------------------------
// Seed

const LOCATIONS: { key: string; name: string; type: GearLocation['type'] }[] = [
  { key: 'home_gijs', name: 'Thuis Gijs', type: 'home' },
  { key: 'home_coen', name: 'Thuis Coen', type: 'home' },
  { key: 'trailer', name: 'Aanhanger', type: 'vehicle' },
  { key: 'car', name: 'Auto', type: 'vehicle' },
  { key: 'on_the_road', name: 'Onderweg (gig)', type: 'on_the_road' },
];

export const KIT_NAMES: Record<KitRole, string> = {
  standard: 'Standaard set', dj_controller: 'DJ only – controller', dj_usb: 'DJ only – USB', dj_light: 'DJ only – controller + licht',
  always: 'Altijd mee', outdoor: 'Buiten extra', custom: 'Eigen kit',
};

export async function ensureGearSeed() {
  const locs = await db.gearLocations.toArray();
  for (const l of LOCATIONS) if (!locs.some((x) => x.key === l.key)) await save<GearLocation>('gearLocations', l, { actor: 'system' });
  const kits = await db.gearKits.toArray();
  for (const role of ['standard', 'dj_controller', 'dj_usb', 'dj_light', 'always'] as KitRole[]) {
    if (!kits.some((k) => k.role === role)) await save<GearKit>('gearKits', { role, name: KIT_NAMES[role], lines: [] }, { actor: 'system' });
  }
  if ((await db.maintenancePlans.count()) === 0) {
    const plans: Omit<MaintenancePlan, 'id' | 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>[] = [
      { category: 'lasers', title: 'Laser: uittreevenster/optiek reinigen', trigger: 'hours', interval: 50, active: true, instructions: 'Laser uit en afgekoeld; venster met lensdoekje en lensvloeistof.' },
      { category: 'audio_cables', title: 'Kabeltest audio', trigger: 'days', interval: 180, active: true, instructions: 'Kabeltester; let op stekkers en trekontlasting.' },
      { category: 'power', title: 'Stroomkabels: visuele controle', trigger: 'days', interval: 90, active: true, instructions: 'Kabel, stekker en trekontlasting heel? Geen tape-reparaties.' },
      { category: 'decks', title: 'Firmware controleren', trigger: 'days', interval: 90, active: true, instructions: 'Check de website van de fabrikant; noteer de nieuwe versie.' },
    ];
    for (const p of plans) await save<MaintenancePlan>('maintenancePlans', p, { actor: 'system' });
  }
}

export async function locationByKey(key: string) {
  return (await db.gearLocations.toArray()).find((l) => l.key === key && !l.deletedAt);
}

// ---------------------------------------------------------------------------
// Import / export (docs/gear-inventory/gear-list.csv format)

export async function importGearCsv(text: string): Promise<{ added: number; skipped: number }> {
  await ensureGearSeed();
  const parsed = itemsFromCsv(parseCsv(text));
  const existing = new Map((await db.gearItems.toArray()).map((i) => [i.code, i]));
  const locs = await db.gearLocations.toArray();
  const loc = (k?: string) => locs.find((l) => l.key === k)?.id;
  const ids = new Map<string, string>();
  let added = 0; let skipped = 0;
  for (const p of parsed) {
    const cur = existing.get(p.item.code);
    if (cur) { ids.set(p.item.code, cur.id); skipped++; continue; }
    const home = loc(p.homeKey);
    const it = await save<GearItem>('gearItems', { ...p.item, homeLocationId: home, locationId: home });
    ids.set(it.code, it.id);
    added++;
  }
  for (const p of parsed) {
    if (!p.containerCode || existing.has(p.item.code)) continue;
    const it = await db.gearItems.get(ids.get(p.item.code)!);
    const parent = ids.get(p.containerCode) ?? existing.get(p.containerCode)?.id;
    if (it && parent) await save<GearItem>('gearItems', { ...it, parentId: parent });
  }
  const kits = alive(await db.gearKits.toArray());
  for (const role of new Set(parsed.flatMap((p) => p.kits))) {
    let kit = kits.find((k) => k.role === role);
    if (!kit) kit = await save<GearKit>('gearKits', { role, name: KIT_NAMES[role], lines: [] });
    const lines = [...kit.lines];
    for (const p of parsed.filter((x) => x.kits.includes(role))) {
      const id = ids.get(p.item.code)!;
      if (!lines.some((l) => l.itemId === id)) lines.push({ itemId: id, qty: p.item.kind === 'counted' ? p.item.quantity : 1 });
    }
    await save<GearKit>('gearKits', { ...kit, lines });
  }
  return { added, skipped };
}

export async function exportGearCsv(): Promise<string> {
  const [items, kits, locs] = await Promise.all([db.gearItems.toArray(), db.gearKits.toArray(), db.gearLocations.toArray()]);
  const byId = new Map(items.map((i) => [i.id, i]));
  return itemsToCsv(alive(items), alive(kits), {
    locationKey: (id) => locs.find((l) => l.id === id)?.key ?? '', codeOf: (id) => (id ? byId.get(id)?.code ?? '' : ''),
  });
}

// ---------------------------------------------------------------------------
// Items, photos, movements

export type ItemDraft = Omit<GearItem, 'id' | 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy' | 'code'> & { id?: string; code?: string };

export function blankItem(): ItemDraft {
  return { kind: 'unique', name: '', category: 'small', quantity: 1, owner: 'shared', status: 'available', transport: 'trailer', electrical: 'none', usageHours: 0, usageGigs: 0 };
}

export async function saveItem(d: ItemDraft): Promise<GearItem> {
  const code = d.code || nextCode(await db.gearItems.toArray());
  return save<GearItem>('gearItems', { ...d, code, locationId: d.locationId ?? d.homeLocationId });
}

export async function addPhoto(itemId: string, file: File, kind: GearPhoto['kind'] = 'main') {
  const { compressImage } = await import('../money/ocr');
  const blob = await compressImage(file);
  return save<GearPhoto>('gearPhotos', { itemId, kind, mime: blob.type || 'image/jpeg', blob });
}

export async function photoUrl(photoId: string): Promise<string | undefined> {
  const p = await db.gearPhotos.get(photoId);
  return p?.blob ? URL.createObjectURL(p.blob) : undefined;
}

export async function findByCode(raw: string): Promise<GearItem | undefined> {
  const code = normaliseCode(raw);
  if (!code) return undefined;
  const it = await db.gearItems.where('code').equals(code).first();
  return it && !it.deletedAt ? it : undefined;
}

async function move(item: GearItem, type: GearMovement['type'], p: { qty?: number; gigId?: string; rentalId?: string; to?: string; status?: GearItem['status']; method?: GearMovement['method']; note?: string; extra?: Partial<GearItem> }) {
  await save<GearMovement>('gearMovements', { itemId: item.id, qty: p.qty ?? 1, type, gigId: p.gigId, rentalId: p.rentalId, toLocationId: p.to, at: nowIso(), method: p.method ?? 'manual', note: p.note });
  const fresh = (await db.gearItems.get(item.id))!;
  return save<GearItem>('gearItems', { ...fresh, ...p.extra, locationId: p.to ?? fresh.locationId, status: p.status ?? fresh.status });
}

export async function moveItem(item: GearItem, toLocationId: string, note?: string) {
  return move(item, 'move', { to: toLocationId, note });
}

export async function disposeItem(item: GearItem, note?: string) {
  return move(item, 'dispose', { status: 'disposed', note });
}

export async function markFound(item: GearItem) {
  return move(item, 'found', { status: 'available', to: item.homeLocationId });
}

// ---------------------------------------------------------------------------
// Packing lists

export async function packInputFor(gigId: string) {
  const gig = (await db.gigs.get(gigId))!;
  const venue = gig.venueId ? await db.venues.get(gig.venueId) : undefined;
  const quotes = alive(await db.quotes.where('gigId').equals(gigId).toArray());
  const quote = quotes.find((q) => q.status === 'accepted') ?? quotes.filter((q) => q.status !== 'superseded' && q.status !== 'declined').sort((a, b) => b.version - a.version)[0];
  return { gig, venue, quote, products: alive(await db.products.toArray()), kits: alive(await db.gearKits.toArray()), items: alive(await db.gearItems.toArray()) };
}

export async function getOrCreatePackList(gigId: string): Promise<PackList> {
  const existing = await db.packLists.where('gigId').equals(gigId).first();
  if (existing && !existing.deletedAt) return existing;
  await ensureGearSeed();
  const inp = await packInputFor(gigId);
  const setup = defaultSetup(inp.gig, inp.venue);
  return save<PackList>('packLists', { ...(existing ?? {}), deletedAt: null, gigId, status: 'draft', setup, lines: generateLines(inp, setup, uid) });
}

/** Rebuild from kits/quote (e.g. after switching the set-up); manual lines and scan progress stay. */
export async function regenerate(list: PackList, setup: KitRole = list.setup): Promise<PackList> {
  const inp = await packInputFor(list.gigId);
  return save<PackList>('packLists', { ...list, setup, lines: mergeLines(list.lines, generateLines(inp, setup, uid)) });
}

export async function savePackList(list: PackList) {
  return save<PackList>('packLists', list);
}

export async function addLine(list: PackList, itemId: string, qty = 1, reason = ''): Promise<PackList> {
  if (list.lines.some((l) => l.itemId === itemId)) return list;
  return save<PackList>('packLists', { ...list, lines: [...list.lines, { id: uid(), itemId, qty, source: 'manual', reason, out: 0, back: 0 }] });
}

export async function scanInto(list: PackList, raw: string, phase: 'out' | 'back'): Promise<{ list: PackList; item?: GearItem; outcome: ScanOutcome | { kind: 'unknown' } }> {
  const item = await findByCode(raw);
  if (!item) return { list, outcome: { kind: 'unknown' } };
  const contents = alive(await db.gearItems.where('parentId').equals(item.id).toArray()).map((i) => i.id);
  const r = applyScan(list.lines, item, contents, phase);
  if (r.outcome.kind === 'ticked') {
    const status = phase === 'out' && list.status !== 'out' ? 'loading' : list.status;
    list = await save<PackList>('packLists', { ...list, lines: r.lines, status });
  }
  return { list, item, outcome: r.outcome };
}

export async function finishLoading(list: PackList): Promise<PackList> {
  const road = await locationByKey('on_the_road');
  for (const l of list.lines.filter((x) => x.out > 0)) {
    const it = await db.gearItems.get(l.itemId);
    if (it) await move(it, 'check_out', { qty: l.out, gigId: list.gigId, to: road?.id, status: 'out', method: 'scan' });
  }
  const saved = await save<PackList>('packLists', { ...list, status: 'out', loadedAt: nowIso() });
  runTaskSync();
  return saved;
}

export type MissingAction = NonNullable<PackLine['missing']>;

/** Check-in done: items back home, usage counters up, missing items handled. */
export async function finishReturn(list: PackList, me: MemberId, trailer: PackList['trailer']): Promise<PackList> {
  const gig = await db.gigs.get(list.gigId);
  const hours = gig ? Math.round(((+gigWindow(gig).end - +gigWindow(gig).start) / 3_600_000) * 2) / 2 : 0;
  let venueLoc: GearLocation | undefined;
  for (const l of list.lines.filter((x) => x.out > 0)) {
    const it = await db.gearItems.get(l.itemId);
    if (!it) continue;
    const used = { usageHours: it.usageHours + hours, usageGigs: it.usageGigs + 1 };
    if (l.back >= l.out) { await move(it, 'check_in', { qty: l.back, gigId: list.gigId, to: it.homeLocationId, status: 'available', extra: used }); continue; }
    if (l.missing === 'venue') {
      if (!venueLoc && gig?.venueId) {
        const v = await db.venues.get(gig.venueId);
        venueLoc = (await db.gearLocations.toArray()).find((x) => x.venueId === gig.venueId) ?? await save<GearLocation>('gearLocations', { name: v?.name ?? 'Locatie', type: 'venue', venueId: gig.venueId });
      }
      await move(it, 'move', { gigId: list.gigId, to: venueLoc?.id, status: 'out', extra: used, note: 'achtergelaten' });
    } else if (l.missing === 'lost') {
      await move(it, 'missing', { gigId: list.gigId, status: 'missing', extra: used });
    } else if (l.missing === 'broken') {
      await move(it, 'check_in', { gigId: list.gigId, to: it.homeLocationId, status: 'out_of_service', extra: used });
      await save<GearIssue>('gearIssues', { itemId: it.id, gigId: list.gigId, title: 'Kapot na gig', severity: 'out_of_service', status: 'open' });
    } else {
      await save<GearItem>('gearItems', { ...it, ...used }); // 'later': still out, a task follows up
    }
  }
  const saved = await save<PackList>('packLists', { ...list, status: 'done', returnedAt: nowIso(), trailer, phone: list.phone ?? me });
  runTaskSync();
  return saved;
}

export async function allConflicts() {
  const s = await settings();
  const [lists, gigs, items] = await Promise.all([db.packLists.toArray(), db.gigs.toArray(), db.gearItems.toArray()]);
  const byId = new Map(gigs.map((g) => [g.id, g]));
  const pairs = alive(lists).flatMap((list) => { const gig = byId.get(list.gigId); return gig && !gig.deletedAt ? [{ list, gig }] : []; });
  return gearConflicts(pairs, alive(items), s.gearBufferMinutes);
}

// ---------------------------------------------------------------------------
// Issues, repairs, maintenance, safety tests

export async function reportIssue(item: GearItem, p: { title: string; description?: string; severity: GearIssue['severity']; gigId?: string; causedByGuests?: boolean }) {
  const issue = await save<GearIssue>('gearIssues', { itemId: item.id, ...p, status: 'open' });
  if (p.severity === 'out_of_service') await save<GearItem>('gearItems', { ...(await db.gearItems.get(item.id))!, status: 'out_of_service' });
  return issue;
}

async function categoryId(key: string) {
  return (await db.categories.toArray()).find((c: Category) => c.key === key && !c.deletedAt);
}

/** App 3: an expense for a repair or rented-in gear (no receipt yet). */
async function createExpense(p: { date: string; supplier: string; description: string; amount: number; categoryKey: string; gigId?: string }) {
  const cat = await categoryId(p.categoryKey);
  if (!cat) return undefined;
  const rate = cat.defaultVatRate ?? 21;
  return save<Expense>('expenses', {
    date: p.date, supplier: p.supplier, description: p.description, categoryId: cat.id, amount: p.amount, vatRate: rate,
    vatAmount: Math.round((p.amount * rate) / (100 + rate)), businessPct: 100, paidBy: 'business', gigId: p.gigId, receiptIds: [], status: 'missing_receipt',
  });
}

export async function resolveIssue(issue: GearIssue, p: { work: string; cost?: number; repairBy?: string; writeOff?: boolean }) {
  let expenseId = issue.expenseId;
  const item = (await db.gearItems.get(issue.itemId))!;
  if (p.cost && !expenseId) {
    expenseId = (await createExpense({ date: todayStr(), supplier: p.repairBy || 'Reparatie', description: `Reparatie ${item.code} ${item.name}: ${issue.title}`, amount: p.cost, categoryKey: 'gear', gigId: issue.causedByGuests ? issue.gigId : undefined }))?.id;
  }
  await save<GearIssue>('gearIssues', { ...issue, work: p.work, cost: p.cost, repairBy: p.repairBy, expenseId, status: p.writeOff ? 'written_off' : 'resolved', resolvedAt: nowIso() });
  if (p.writeOff) return disposeItem(item, p.work);
  const stillBroken = alive(await db.gearIssues.where('itemId').equals(item.id).toArray()).some((x) => x.id !== issue.id && x.severity === 'out_of_service' && (x.status === 'open' || x.status === 'in_repair'));
  if (!stillBroken && (item.status === 'out_of_service' || item.status === 'in_repair')) return move(item, 'from_repair', { status: 'available', to: item.homeLocationId });
  return item;
}

export async function sendToRepair(issue: GearIssue, p: { repairBy: string; expectedBack?: string }) {
  await save<GearIssue>('gearIssues', { ...issue, ...p, status: 'in_repair', sentAt: nowIso() });
  const item = (await db.gearItems.get(issue.itemId))!;
  await move(item, 'to_repair', { status: 'in_repair', note: p.repairBy });
}

export async function logMaintenance(item: GearItem, planId: string | undefined, result: MaintenanceLog['result'], note?: string) {
  await save<MaintenanceLog>('maintenanceLogs', { planId, itemId: item.id, doneAt: todayStr(), result, usageHours: item.usageHours, usageGigs: item.usageGigs, note });
  if (result === 'issue') await reportIssue(item, { title: note || 'Gevonden bij onderhoud', severity: 'minor' });
}

export async function addSafetyTest(item: GearItem, p: { date: string; inspector: string; passed: boolean; labelNo?: string; note?: string }) {
  const s = await settings();
  await save<SafetyTest>('safetyTests', { itemId: item.id, ...p, nextDue: nextSafetyDate(p.date, item, s) });
  if (!p.passed) await reportIssue(item, { title: 'Afgekeurd bij keuring', description: p.note, severity: 'out_of_service' });
}

// ---------------------------------------------------------------------------
// Rentals and wishlist

export async function saveRental(r: Omit<GearRental, 'id' | 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'> & { id?: string }) {
  let rental = await save<GearRental>('gearRentals', r);
  if (rental.direction === 'in' && rental.price && !rental.expenseId) {
    const e = await createExpense({ date: rental.from, supplier: rental.party, description: `Gear huren: ${rental.lines.map((l) => `${l.qty}× ${l.description}`).join(', ')}`, amount: rental.price, categoryKey: 'gear_hire', gigId: rental.gigId });
    if (e) rental = await save<GearRental>('gearRentals', { ...rental, expenseId: e.id });
  }
  if (rental.direction === 'out' && !r.id) {
    for (const l of rental.lines) {
      const it = l.itemId ? await db.gearItems.get(l.itemId) : undefined;
      if (it) await move(it, 'lend_out', { rentalId: rental.id, status: 'lent', note: rental.party });
    }
  }
  runTaskSync();
  return rental;
}

export async function returnRental(r: GearRental) {
  await save<GearRental>('gearRentals', { ...r, returnedAt: nowIso() });
  if (r.direction === 'out') {
    for (const l of r.lines) {
      const it = l.itemId ? await db.gearItems.get(l.itemId) : undefined;
      if (it && it.status === 'lent') await move(it, 'return', { rentalId: r.id, status: 'available', to: it.homeLocationId });
    }
  }
  runTaskSync();
}

export async function saveWish(w: Omit<WishItem, 'id' | 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'> & { id?: string }) {
  return save<WishItem>('wishlist', w);
}

/** Wishlist → bought: creates the gear item (fill in the rest on the item page). */
export async function buyWish(w: WishItem): Promise<GearItem> {
  const it = await saveItem({ ...blankItem(), name: w.name, category: w.category ?? 'small', owner: w.for, purchaseDate: todayStr(), purchasePrice: w.price, notes: w.reason });
  await save<WishItem>('wishlist', { ...w, status: 'bought', boughtItemId: it.id });
  return it;
}
