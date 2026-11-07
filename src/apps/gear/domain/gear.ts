import type {
  GearCategory, GearItem, GearKind, GearKit, GearOwner, GearTransport, Gig, KitRole, LabelType, MaintenanceLog, MaintenancePlan, PackLine, PackList, Product, Quote,
  SafetyTest, Settings, Venue,
} from '../../../core/types';
import { GEAR_CATEGORIES, KIT_ROLES } from '../../../core/types';
import { addDays, addMinutes, addMonths, gigWindow, parseDate, rangesOverlap, toDateStr } from '../../../core/dates';

// Pure gear logic (no database): packing lists, reservations and conflicts,
// due dates, insurance totals, trailer load, codes and the CSV format of
// docs/gear-inventory/gear-list.csv. Unit-tested in gear.test.ts.

// ---------------------------------------------------------------------------
// Codes

// Codes follow the case tree: a top-level item or case gets a number, and
// whatever lives in a case gets the case's number + "." + its own number:
//   FQ-01-7        flight case (top level)
//   FQ-01.1-3      XDJ-AZ in that case
//   FQ-01.2-8      its power cable
// The last character is a check character (weighted mod 11, "X" = 10): it
// catches every single mistyped character and every swap of two neighbours,
// so a typo is rejected instead of opening the wrong item.
// A code never changes by itself. When an item moves to another case for good,
// the app offers a new label; the old code stays valid as an alias.
// Old codes ("FQ-0042", no check character) keep working; their number counts
// as their tree number, so a child of FQ-0009 becomes FQ-9.1-x.

const CODE_ALPHABET = '0123456789.';

export function checkChar(base: string): string {
  let sum = 0;
  for (let i = 0; i < base.length; i++) {
    const v = CODE_ALPHABET.indexOf(base[i]);
    if (v < 0) throw new Error(`bad code base: ${base}`);
    sum += (v + 1) * ((i % 10) + 1);
  }
  const c = sum % 11;
  return c === 10 ? 'X' : String(c);
}

export const makeCode = (base: string) => `FQ-${base}-${checkChar(base)}`;

/** Tree number of a code: "01.2" for FQ-01.2-8, "9" for the old FQ-0009, null otherwise. */
export function codeBase(code: string): string | null {
  const m = code.match(/^FQ-(\d+(?:\.\d+)*)-[0-9X]$/);
  if (m) return m[1];
  const old = code.match(/^FQ-(\d{1,5})$/);
  return old ? String(Number(old[1])) : null;
}

const sameNumber = (a: string, b: string) => Number(a) === Number(b);

/** True if code `base` is a direct child of `parentBase` (FQ-01.3 is a child of FQ-01 and of the old FQ-0001). */
function childNumber(base: string, parentBase: string): number | null {
  const segs = base.split('.');
  const p = parentBase.split('.');
  if (segs.length !== p.length + 1) return null;
  for (let i = 0; i < p.length; i++) if (!sameNumber(segs[i], p[i])) return null;
  return Number(segs[segs.length - 1]);
}

type CodeItem = Pick<GearItem, 'code'> & { id?: string; aliases?: string[] };

/** Next free code: under `parent` when the item lives in a case, otherwise a new top-level number. */
export function nextCode(items: CodeItem[], parent?: CodeItem | null): string {
  const bases = items.flatMap((i) => [i.code, ...(i.aliases ?? [])]).map(codeBase).filter((x): x is string => !!x);
  const parentBase = parent ? codeBase(parent.code) : null;
  if (parent && parentBase) {
    const max = bases.reduce((m, b) => Math.max(m, childNumber(b, parentBase) ?? 0), 0);
    return makeCode(`${parentBase}.${max + 1}`);
  }
  const max = bases.filter((b) => !b.includes('.')).reduce((m, b) => Math.max(m, Number(b)), 0);
  return makeCode(String(max + 1).padStart(2, '0'));
}

/** The case a code says the item belongs in (its parent's tree number), or null for top level / old codes. */
export function parentBaseOf(code: string): string | null {
  const base = codeBase(code);
  if (!base || !base.includes('.')) return null;
  return base.slice(0, base.lastIndexOf('.'));
}

/** Does the item's code still match the case it is in now? (false = offer a new label) */
export function codeMatchesParent(item: CodeItem, parent?: CodeItem | null): boolean {
  if (/^FQ-\d{1,5}$/.test(item.code)) return true; // old flat codes make no tree claim
  const claimed = parentBaseOf(item.code);
  if (!parent) return claimed == null;
  const pb = codeBase(parent.code);
  return claimed != null && pb != null && claimed.split('.').length === pb.split('.').length && claimed.split('.').every((s, i) => sameNumber(s, pb.split('.')[i]));
}

export type CodeProblem = 'check' | null;

/**
 * Accepts a tree code ("FQ-01.2-8", "fq 01.2-8"), an old code ("FQ-0042", "fq0042", "42")
 * or a QR payload that contains one. Returns null when it is not a code or the check
 * character is wrong (see codeProblem for the reason).
 */
export function normaliseCode(raw: string): string | null {
  const up = raw.trim().toUpperCase().replace(/\s+/g, '');
  const tree = up.match(/(?:FQ-?)?(\d+(?:\.\d+)*)-([0-9X])$/) ?? up.match(/FQ-?(\d+(?:\.\d+)*)-([0-9X])/);
  if (tree) return checkChar(tree[1]) === tree[2] ? `FQ-${tree[1]}-${tree[2]}` : null;
  if (/-DUP-/.test(up)) return up.match(/FQ-[\w.-]+/)?.[0] ?? null; // temporary code after a merge clash
  const m = up.match(/(?:FQ-?)?(\d{1,5})$/) ?? up.match(/FQ-?(\d{1,5})(?![\d.])/);
  return m ? `FQ-${m[1].padStart(4, '0')}` : null;
}

/** Why a typed/scanned value was rejected: a tree code whose check character doesn't fit. */
export function codeProblem(raw: string): CodeProblem {
  const up = raw.trim().toUpperCase().replace(/\s+/g, '');
  const tree = up.match(/(\d+(?:\.\d+)*)-([0-9X])$/);
  return tree && checkChar(tree[1]) !== tree[2] ? 'check' : null;
}

// ---------------------------------------------------------------------------
// Tree: cases hold items, and cases can sit in other cases (a rack in a trailer box)

type TreeItem = Pick<GearItem, 'id' | 'parentId'>;

/** Everything inside an item, at any depth (cycle-safe). */
export function descendants(id: string, items: TreeItem[]): string[] {
  const kids = new Map<string, string[]>();
  for (const i of items) if (i.parentId) kids.set(i.parentId, [...(kids.get(i.parentId) ?? []), i.id]);
  const out: string[] = []; const seen = new Set([id]); const stack = [...(kids.get(id) ?? [])];
  while (stack.length) {
    const c = stack.pop()!;
    if (seen.has(c)) continue;
    seen.add(c); out.push(c);
    stack.push(...(kids.get(c) ?? []));
  }
  return out;
}

/** True when putting `itemId` inside `parentId` would make a loop (a case inside itself). */
export function wouldCycle(itemId: string, parentId: string | undefined, items: TreeItem[]) {
  return !!parentId && (parentId === itemId || descendants(itemId, items).includes(parentId));
}

/** Path from the top: [outermost case, …, item]. */
export function ancestry(id: string, items: TreeItem[]): string[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const path = [id]; const seen = new Set([id]);
  let cur = byId.get(id)?.parentId;
  while (cur && !seen.has(cur)) { path.unshift(cur); seen.add(cur); cur = byId.get(cur)?.parentId; }
  return path;
}

/** Lines in tree order with their depth: a case, then what's in it (indented). */
export function treeLines(lines: PackLine[], items: Pick<GearItem, 'id' | 'parentId' | 'name'>[]): { line: PackLine; depth: number }[] {
  const byItem = new Map(lines.map((l) => [l.itemId, l]));
  const meta = new Map(items.map((i) => [i.id, i]));
  const onListParent = (l: PackLine) => { const p = meta.get(l.itemId)?.parentId; return p && byItem.has(p) ? p : undefined; };
  const kids = new Map<string, PackLine[]>();
  const roots: PackLine[] = [];
  for (const l of lines) { const p = onListParent(l); if (p) kids.set(p, [...(kids.get(p) ?? []), l]); else roots.push(l); }
  const name = (l: PackLine) => meta.get(l.itemId)?.name ?? '';
  const out: { line: PackLine; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (l: PackLine, depth: number) => {
    if (seen.has(l.id)) return;
    seen.add(l.id); out.push({ line: l, depth });
    for (const k of (kids.get(l.itemId) ?? []).sort((a, b) => name(a).localeCompare(name(b)))) walk(k, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  for (const l of lines) if (!seen.has(l.id)) out.push({ line: l, depth: 0 }); // cycles: show flat
  return out;
}

/** Sensible default label: barcodes for cables (they wrap around), big QR for cases and big gear. */
export function defaultLabelType(it: Pick<GearItem, 'category' | 'kind'>): LabelType {
  if (['audio_cables', 'power', 'dmx'].includes(it.category)) return 'barcode';
  if (it.kind === 'container' || ['cases', 'speakers', 'subs', 'lighting', 'furniture', 'stands'].includes(it.category)) return 'qr_large';
  return 'qr_small';
}

// ---------------------------------------------------------------------------
// Packing list

export interface PackInput {
  gig: Pick<Gig, 'setupRequired' | 'setting'>;
  venue?: Pick<Venue, 'houseSound'>;
  quote?: Pick<Quote, 'lines'>;
  products: Pick<Product, 'id' | 'kitIds'>[];
  kits: GearKit[];
  items: Pick<GearItem, 'id' | 'status' | 'kind' | 'quantity' | 'parentId' | 'name'>[];
}

/** Venue with its own sound, or no build-up → a DJ-only variant; otherwise the full standard set. */
export function defaultSetup(gig: PackInput['gig'], venue?: PackInput['venue']): KitRole {
  return venue?.houseSound || !gig.setupRequired ? 'dj_controller' : 'standard';
}

export const isOutdoorGig = (g: Pick<Gig, 'setting'>) => g.setting === 'outdoor' || g.setting === 'both';

/** Build the draft lines: base kit + what the quote sold + outdoor kit + "always bring". */
export function generateLines(inp: PackInput, setup: KitRole, uid: () => string): PackLine[] {
  const usable = new Map(inp.items.filter((i) => i.status !== 'disposed').map((i) => [i.id, i]));
  const byItem = new Map<string, PackLine>();
  const add = (kit: GearKit | undefined, source: PackLine['source'], reason: string) => {
    if (!kit) return;
    for (const l of kit.lines) {
      if (!usable.has(l.itemId)) continue;
      const cur = byItem.get(l.itemId);
      // The same item from two kits is packed once, with the largest quantity.
      if (cur) cur.qty = Math.max(cur.qty, l.qty);
      else byItem.set(l.itemId, { id: uid(), itemId: l.itemId, qty: l.qty, source, reason, out: 0, back: 0 });
    }
  };
  const kitOf = (role: KitRole) => inp.kits.find((k) => k.role === role && !k.deletedAt);
  add(kitOf(setup), 'kit', kitOf(setup)?.name ?? setup);
  for (const line of inp.quote?.lines ?? []) {
    if (line.optional && !line.selected) continue;
    const p = inp.products.find((x) => x.id === line.productId);
    for (const kitId of p?.kitIds ?? []) add(inp.kits.find((k) => k.id === kitId && !k.deletedAt), 'quote', line.description);
  }
  if (isOutdoorGig(inp.gig)) add(kitOf('outdoor'), 'outdoor', kitOf('outdoor')?.name ?? 'outdoor');
  add(kitOf('always'), 'always', kitOf('always')?.name ?? 'always');
  // A case on the list brings what's in it (at any depth).
  for (const l of [...byItem.values()]) {
    for (const d of descendants(l.itemId, inp.items)) {
      const it = usable.get(d);
      if (!it || byItem.has(d)) continue;
      const parent = inp.items.find((x) => x.id === it.parentId);
      byItem.set(d, { id: uid(), itemId: d, qty: it.kind === 'counted' ? it.quantity : 1, source: l.source, reason: `in ${parent?.name ?? ''}`.trim(), out: 0, back: 0 });
    }
  }
  return [...byItem.values()];
}

/** Re-generate but keep manual lines and scan progress of lines that stay. */
export function mergeLines(old: PackLine[], fresh: PackLine[]): PackLine[] {
  const byItem = new Map(old.map((l) => [l.itemId, l]));
  const out = fresh.map((l) => { const o = byItem.get(l.itemId); return o ? { ...l, id: o.id, out: o.out, back: o.back, missing: o.missing, skip: o.skip } : l; });
  for (const o of old) if (o.source === 'manual' && !out.some((l) => l.itemId === o.itemId)) out.push(o);
  return out;
}

export interface PackProgress { lines: number; done: number; pieces: number; piecesDone: number }

export function progress(lines: PackLine[], phase: 'out' | 'back'): PackProgress {
  const relevant = phase === 'out' ? lines.filter((l) => !l.skip) : lines.filter((l) => l.out > 0);
  const target = (l: PackLine) => (phase === 'out' ? l.qty : l.out);
  return {
    lines: relevant.length,
    done: relevant.filter((l) => l[phase] >= target(l)).length,
    pieces: relevant.reduce((s, l) => s + target(l), 0),
    piecesDone: relevant.reduce((s, l) => s + Math.min(l[phase], target(l)), 0),
  };
}

export type ScanOutcome =
  | { kind: 'ticked'; lineIds: string[] }
  | { kind: 'already'; lineId: string }
  | { kind: 'not_on_list' }
  | { kind: 'blocked'; reason: 'out_of_service' | 'in_repair' | 'lent' | 'missing' | 'disposed' };

/**
 * Apply a scan to a packing list.
 * - group mode: scanning a case also ticks off everything in it (`contents`) that is on the list and taken;
 * - each mode: only the scanned item itself (unload: every piece is checked).
 * Scanning an item marked "not taken" means you take it after all. Counted items are ticked fully (adjust by hand).
 */
export function applyScan(list: PackLine[], item: Pick<GearItem, 'id' | 'status'>, contents: string[], phase: 'out' | 'back', group = true): { lines: PackLine[]; outcome: ScanOutcome } {
  if (phase === 'out' && ['out_of_service', 'in_repair', 'lent', 'missing', 'disposed'].includes(item.status)) {
    return { lines: list, outcome: { kind: 'blocked', reason: item.status as Extract<ScanOutcome, { kind: 'blocked' }>['reason'] } };
  }
  const inside = new Set(group ? contents : []);
  const target = (l: PackLine) => (phase === 'out' ? l.qty : l.out);
  const hit = list.filter((l) => (l.itemId === item.id || (inside.has(l.itemId) && !l.skip)) && (phase === 'out' || l.out > 0));
  if (!hit.length) return { lines: list, outcome: { kind: 'not_on_list' } };
  const open = hit.filter((l) => l[phase] < target(l));
  if (!open.length) return { lines: list, outcome: { kind: 'already', lineId: hit[0].id } };
  const openIds = new Set(open.map((l) => l.id));
  return {
    lines: list.map((l) => (openIds.has(l.id) ? { ...l, [phase]: target(l), skip: false, missing: phase === 'back' ? undefined : l.missing } : l)),
    outcome: { kind: 'ticked', lineIds: [...openIds] },
  };
}

// ---------------------------------------------------------------------------
// Reservations and conflicts

export function reservationWindow(gig: Pick<Gig, 'date' | 'startTime' | 'endTime' | 'setupTime'>, bufferMinutes: number) {
  const w = gigWindow(gig);
  return { from: addMinutes(w.busyFrom, -bufferMinutes), to: addMinutes(w.end, bufferMinutes) };
}

export interface GearConflict { itemId: string; gigIds: string[]; need: number; have: number }

/** Items needed by overlapping gigs at the same time: unique items twice, or more of a counted item than we own. */
export function gearConflicts(
  lists: { list: Pick<PackList, 'gigId' | 'lines' | 'status'>; gig: Pick<Gig, 'id' | 'date' | 'startTime' | 'endTime' | 'setupTime' | 'stage'> }[],
  items: Pick<GearItem, 'id' | 'kind' | 'quantity'>[],
  bufferMinutes: number,
): GearConflict[] {
  const live = lists.filter((x) => x.list.status !== 'done' && x.gig.date && !['lost', 'cancelled'].includes(x.gig.stage))
    .map((x) => ({ ...x, w: reservationWindow(x.gig, bufferMinutes) }));
  const qty = new Map(items.map((i) => [i.id, i.kind === 'counted' ? i.quantity : 1]));
  const found = new Map<string, GearConflict>();
  for (let a = 0; a < live.length; a++) {
    for (let b = a + 1; b < live.length; b++) {
      const A = live[a]; const B = live[b];
      if (!rangesOverlap(A.w.from, A.w.to, B.w.from, B.w.to)) continue;
      for (const la of A.list.lines) {
        if (la.skip) continue;
        const lb = B.list.lines.find((x) => x.itemId === la.itemId && !x.skip);
        if (!lb) continue;
        const have = qty.get(la.itemId) ?? 1;
        const need = la.qty + lb.qty;
        if (need <= have) continue;
        const key = `${la.itemId}`;
        const cur = found.get(key);
        const gigIds = [...new Set([...(cur?.gigIds ?? []), A.gig.id, B.gig.id])];
        found.set(key, { itemId: la.itemId, gigIds, need: Math.max(need, cur?.need ?? 0), have });
      }
    }
  }
  return [...found.values()];
}

// ---------------------------------------------------------------------------
// Trailer load

export function loadByTransport(lines: PackLine[], items: Pick<GearItem, 'id' | 'transport' | 'weightKg' | 'kind'>[]) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const out = { trailerKg: 0, carKg: 0, unknownWeight: 0 };
  for (const l of lines) {
    const it = byId.get(l.itemId);
    if (!it || l.skip) continue;
    if (it.weightKg == null) { out.unknownWeight++; continue; }
    const kg = it.weightKg * (it.kind === 'counted' ? l.qty : 1);
    if (it.transport === 'car') out.carKg += kg; else out.trailerKg += kg;
  }
  return out;
}

/** Payload of the trailer: maximum mass minus its own weight (when known). */
export const trailerPayload = (s: Pick<Settings, 'gearTrailerMaxKg' | 'gearTrailerEmptyKg'>) => s.gearTrailerMaxKg - (s.gearTrailerEmptyKg ?? 0);

/**
 * Trailer weights: from the DJ gear trailer in Navigatie (shared vehicles) when
 * it has them, else from Gear's own settings.
 */
export function trailerWeights(
  s: Pick<Settings, 'gearTrailerMaxKg' | 'gearTrailerEmptyKg'>,
  trailer?: { deletedAt?: string | null; spec: Record<string, unknown> },
): Pick<Settings, 'gearTrailerMaxKg' | 'gearTrailerEmptyKg'> & { fromMaps: boolean } {
  const num = (v: unknown) => (typeof v === 'number' && v > 0 ? v : undefined);
  const max = trailer && !trailer.deletedAt ? num(trailer.spec.maxMassKg) : undefined;
  const empty = trailer && !trailer.deletedAt ? num(trailer.spec.emptyKg) : undefined;
  return {
    gearTrailerMaxKg: max ?? s.gearTrailerMaxKg,
    gearTrailerEmptyKg: max ? empty : s.gearTrailerEmptyKg,
    fromMaps: !!max,
  };
}

// ---------------------------------------------------------------------------
// Maintenance and safety tests

export interface Due { planId?: string; itemId: string; title: string; kind: 'maintenance' | 'safety'; dueDate?: string; dueAt?: number; unit?: 'hours' | 'gigs'; overdue: boolean; soon: boolean }

export function maintenanceDue(plans: MaintenancePlan[], items: GearItem[], logs: MaintenanceLog[], today: string, soonDays = 30): Due[] {
  const out: Due[] = [];
  for (const p of plans) {
    if (!p.active || p.deletedAt) continue;
    const targets = items.filter((i) => i.status !== 'disposed' && !i.deletedAt && (p.itemId ? i.id === p.itemId : i.category === p.category));
    for (const it of targets) {
      const last = logs.filter((l) => !l.deletedAt && l.itemId === it.id && l.planId === p.id).sort((a, b) => b.doneAt.localeCompare(a.doneAt))[0];
      if (p.trigger === 'days') {
        const base = last?.doneAt ?? it.purchaseDate ?? it.createdAt.slice(0, 10);
        const dueDate = toDateStr(addDays(parseDate(base), p.interval));
        out.push({ planId: p.id, itemId: it.id, title: p.title, kind: 'maintenance', dueDate, overdue: dueDate < today, soon: dueDate < toDateStr(addDays(parseDate(today), soonDays)) });
      } else {
        const used = p.trigger === 'hours' ? it.usageHours : it.usageGigs;
        const at = (p.trigger === 'hours' ? last?.usageHours : last?.usageGigs) ?? 0;
        const dueAt = at + p.interval;
        out.push({ planId: p.id, itemId: it.id, title: p.title, kind: 'maintenance', dueAt, unit: p.trigger, overdue: used >= dueAt, soon: used >= dueAt - Math.max(1, p.interval * 0.1) });
      }
    }
  }
  return out;
}

export const POWER_CATEGORIES: GearCategory[] = ['power'];

export function safetyDue(items: GearItem[], tests: SafetyTest[], s: Pick<Settings, 'gearSafetyMonths' | 'gearSafetyMonthsPower'>, today: string): Due[] {
  return items.filter((i) => !i.deletedAt && i.status !== 'disposed' && i.electrical !== 'none').map((it) => {
    const last = tests.filter((x) => !x.deletedAt && x.itemId === it.id).sort((a, b) => b.date.localeCompare(a.date))[0];
    const months = POWER_CATEGORIES.includes(it.category) ? s.gearSafetyMonthsPower : s.gearSafetyMonths;
    const dueDate = last ? last.nextDue : today;
    return { itemId: it.id, title: last ? 'safety' : 'safety_never', kind: 'safety' as const, dueDate, overdue: !last || dueDate < today, soon: dueDate < toDateStr(addMonths(parseDate(today), 1)), unit: undefined, dueAt: months };
  });
}

export const nextSafetyDate = (date: string, it: Pick<GearItem, 'category'>, s: Pick<Settings, 'gearSafetyMonths' | 'gearSafetyMonthsPower'>) =>
  toDateStr(addMonths(parseDate(date), POWER_CATEGORIES.includes(it.category) ? s.gearSafetyMonthsPower : s.gearSafetyMonths));

// ---------------------------------------------------------------------------
// Insurance

export interface Completeness { photo: boolean; serial: boolean; value: boolean; receipt: boolean }

export function completeness(it: GearItem, photoItemIds: Set<string>): Completeness {
  return {
    photo: photoItemIds.has(it.id),
    serial: it.kind === 'counted' || !!it.serial,
    value: !!(it.replacementValue || it.purchasePrice),
    receipt: it.kind === 'counted' || !!it.expenseId,
  };
}

export function insuranceTotals(items: GearItem[]) {
  const live = items.filter((i) => !i.deletedAt && i.status !== 'disposed');
  // Prices of counted items are for the whole lot (e.g. all 4 XLR cables together).
  const value = (i: GearItem) => i.replacementValue ?? i.purchasePrice ?? 0;
  const sum = (f: (i: GearItem) => boolean) => live.filter(f).reduce((s, i) => s + value(i), 0);
  const owners: GearOwner[] = ['gijs', 'coen', 'shared', 'unknown'];
  return {
    count: live.length,
    purchase: live.reduce((s, i) => s + (i.purchasePrice ?? 0), 0),
    replacement: live.reduce((s, i) => s + value(i), 0),
    byOwner: Object.fromEntries(owners.map((o) => [o, sum((i) => i.owner === o)])) as Record<GearOwner, number>,
    byCategory: Object.fromEntries(GEAR_CATEGORIES.map((c) => [c, sum((i) => i.category === c)]).filter(([, v]) => (v as number) > 0)) as Partial<Record<GearCategory, number>>,
    withoutValue: live.filter((i) => !i.replacementValue && !i.purchasePrice).length,
  };
}

// ---------------------------------------------------------------------------
// CSV (docs/gear-inventory/gear-list.csv)

export const CSV_COLUMNS = ['code', 'kind', 'name', 'category', 'brand', 'model', 'serial', 'quantity', 'owner', 'home_location', 'container', 'transport', 'weight_kg',
  'purchase_date', 'purchase_price_eur', 'replacement_value_eur', 'electrical', 'power_w', 'kits', 'notes', 'label'] as const;

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some((c) => c.trim())) rows.push(row); row = []; }
    else cell += ch;
  }
  row.push(cell); if (row.some((c) => c.trim())) rows.push(row);
  const [head, ...body] = rows;
  if (!head) return [];
  const keys = head.map((h) => h.trim().toLowerCase());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

const euroToCents = (v: string) => (v ? Math.round(Number(v.replace(',', '.')) * 100) || undefined : undefined);
const num = (v: string) => (v ? Number(v.replace(',', '.')) || undefined : undefined);
const oneOf = <T extends string>(v: string, list: readonly T[], dflt: T): T => (list.includes(v as T) ? (v as T) : dflt);

export interface CsvItem {
  item: Omit<GearItem, 'id' | 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy' | 'homeLocationId' | 'locationId' | 'parentId'>;
  homeKey?: string;
  containerCode?: string;
  kits: KitRole[];
}

export function itemsFromCsv(rows: Record<string, string>[]): CsvItem[] {
  return rows.filter((r) => /^FQ-\d+$/i.test(r.code ?? '') && r.name).map((r) => ({
    item: {
      code: r.code.toUpperCase(), kind: oneOf<GearKind>(r.kind, ['unique', 'counted', 'container'], 'unique'), name: r.name,
      category: oneOf<GearCategory>(r.category, GEAR_CATEGORIES, 'small'), brand: r.brand || undefined, model: r.model || undefined, serial: r.serial || undefined,
      quantity: Math.max(1, Number(r.quantity) || 1), owner: oneOf<GearOwner>(r.owner, ['gijs', 'coen', 'shared', 'unknown'], 'unknown'),
      status: 'available', transport: oneOf<GearTransport>(r.transport, ['trailer', 'car'], 'trailer'), weightKg: num(r.weight_kg),
      purchaseDate: /^\d{4}-\d{2}-\d{2}$/.test(r.purchase_date ?? '') ? r.purchase_date : undefined,
      purchasePrice: euroToCents(r.purchase_price_eur), replacementValue: euroToCents(r.replacement_value_eur),
      electrical: oneOf(r.electrical, ['class1', 'class2', 'none'] as const, 'none'), powerW: num(r.power_w), usageHours: 0, usageGigs: 0,
      notes: r.notes || undefined,
      labelType: (['qr_large', 'qr_small', 'barcode'] as const).find((x) => x === r.label || r.label?.startsWith(`${x}_`)),
      labelPreset: r.label && !['qr_large', 'qr_small', 'barcode'].includes(r.label) ? r.label : undefined,
    },
    homeKey: ['home_gijs', 'home_coen', 'trailer', 'car'].includes(r.home_location) ? r.home_location : undefined,
    containerCode: /^FQ-\d+$/i.test(r.container ?? '') ? r.container.toUpperCase() : undefined,
    kits: (r.kits ?? '').split(/[;|]/).map((k) => k.trim()).filter((k): k is KitRole => (KIT_ROLES as readonly string[]).includes(k)),
  }));
}

const csvCell = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export function itemsToCsv(items: GearItem[], kits: GearKit[], ctx: { locationKey: (id?: string) => string; codeOf: (id?: string) => string }): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const i of [...items].filter((x) => !x.deletedAt).sort((a, b) => a.code.localeCompare(b.code))) {
    const roles = kits.filter((k) => !k.deletedAt && k.lines.some((l) => l.itemId === i.id)).map((k) => k.role).filter((r) => r !== 'custom');
    lines.push([i.code, i.kind, i.name, i.category, i.brand, i.model, i.serial, i.quantity, i.owner, ctx.locationKey(i.homeLocationId), ctx.codeOf(i.parentId), i.transport, i.weightKg,
      i.purchaseDate, i.purchasePrice != null ? (i.purchasePrice / 100).toFixed(2) : '', i.replacementValue != null ? (i.replacementValue / 100).toFixed(2) : '',
      i.electrical, i.powerW, [...new Set(roles)].join(';'), i.notes, i.labelPreset ?? i.labelType].map(csvCell).join(','));
  }
  return lines.join('\n') + '\n';
}
