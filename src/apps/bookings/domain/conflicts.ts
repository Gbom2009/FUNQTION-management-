import type { AvailabilityBlock, Gig, MemberId, Settings } from '../../../core/types';
import { addMinutes, gigWindow, rangesOverlap } from '../../../core/dates';

// Double-booking rules (agreed with Gijs & Coen):
//  - The same person can play two gigs on one day ONLY if neither gig needs
//    our own build-up (setupRequired) AND there are at least `minGapMinutes`
//    (default 2 hours) between the end of one and the start of the other.
//  - Overlapping times for the same person are always a hard conflict.
//  - A gig on a day someone has blocked (holiday etc.) is a hard conflict.
//  - Enquiries / options / sent quotes on the same slot are soft warnings.
//  - Two different people each needing our gear on the same day: soft warning.

export type ConflictKind = 'overlap' | 'setup_same_day' | 'gap_too_short' | 'blocked' | 'tentative' | 'gear_same_day';

export interface Conflict {
  level: 'hard' | 'soft';
  kind: ConflictKind;
  member?: MemberId;
  otherGigId?: string;
  blockId?: string;
  gapMinutes?: number;
}

const COUNTS_AS_BOOKED = new Set(['confirmed', 'played', 'invoiced', 'paid']);
const TENTATIVE = new Set(['enquiry', 'option', 'quote_sent']);

type GigLike = Pick<Gig, 'id' | 'date' | 'startTime' | 'endTime' | 'setupTime' | 'setupRequired' | 'performers' | 'stage'> &
  Partial<Pick<Gig, 'deletedAt'>>;

export function findConflicts(
  gig: GigLike,
  others: GigLike[],
  blocks: AvailabilityBlock[],
  settings: Pick<Settings, 'minGapMinutes'>,
): Conflict[] {
  const out: Conflict[] = [];
  if (!gig.date) return out;
  const w = gigWindow(gig);
  const performers = gig.performers.length ? gig.performers : [];

  for (const o of others) {
    if (o.id === gig.id || o.deletedAt || !o.date) continue;
    if (o.stage === 'lost' || o.stage === 'cancelled') continue;
    const ow = gigWindow(o);
    const shared = performers.filter((p) => o.performers.includes(p));
    // Look at gigs within ~36h either side only.
    if (Math.abs(ow.start.getTime() - w.start.getTime()) > 36 * 3600_000) continue;
    const sameDay = o.date === gig.date;
    const tentative = TENTATIVE.has(o.stage) || !COUNTS_AS_BOOKED.has(o.stage);

    if (shared.length === 0) {
      // Different people. Unknown lineup on either side -> treat as tentative overlap.
      if ((!performers.length || !o.performers.length) && rangesOverlap(w.busyFrom, w.end, ow.busyFrom, ow.end)) {
        out.push({ level: 'soft', kind: 'tentative', otherGigId: o.id });
      } else if (sameDay && gig.setupRequired && o.setupRequired) {
        out.push({ level: 'soft', kind: 'gear_same_day', otherGigId: o.id });
      }
      continue;
    }

    for (const m of shared) {
      let kind: ConflictKind | null = null;
      let gapMinutes: number | undefined;
      if (rangesOverlap(w.busyFrom, w.end, ow.busyFrom, ow.end)) {
        kind = 'overlap';
      } else if (sameDay && (gig.setupRequired || o.setupRequired)) {
        kind = 'setup_same_day';
      } else {
        const gap = w.busyFrom >= ow.end
          ? (w.busyFrom.getTime() - ow.end.getTime()) / 60_000
          : (ow.busyFrom.getTime() - w.end.getTime()) / 60_000;
        if (gap < settings.minGapMinutes) {
          kind = 'gap_too_short';
          gapMinutes = Math.round(gap);
        }
      }
      if (kind) {
        out.push({ level: tentative ? 'soft' : 'hard', kind: tentative ? 'tentative' : kind, member: m, otherGigId: o.id, gapMinutes });
      }
    }
  }

  for (const b of blocks) {
    if (b.deletedAt || !performers.includes(b.memberId)) continue;
    if (gig.date >= b.from && gig.date <= b.to) {
      out.push({ level: 'hard', kind: 'blocked', member: b.memberId, blockId: b.id });
    }
  }
  return out;
}

export type DateStatus = 'free' | 'tentative' | 'booked' | 'blocked';

export interface DateCheck {
  status: DateStatus;
  gigs: GigLike[];
  blocks: AvailabilityBlock[];
  bookedMembers: MemberId[];
}

/** Quick availability check for a date (used while capturing an enquiry). */
export function checkDate(date: string, gigs: GigLike[], blocks: AvailabilityBlock[]): DateCheck {
  const onDay = gigs.filter((g) => !g.deletedAt && g.date === date && g.stage !== 'lost' && g.stage !== 'cancelled');
  const dayBlocks = blocks.filter((b) => !b.deletedAt && date >= b.from && date <= b.to);
  const booked = onDay.filter((g) => COUNTS_AS_BOOKED.has(g.stage));
  const bookedMembers = Array.from(new Set(booked.flatMap((g) => g.performers)));
  let status: DateStatus = 'free';
  if (onDay.length) status = 'tentative';
  if (dayBlocks.length) status = 'blocked';
  if (booked.length) status = 'booked';
  return { status, gigs: onDay, blocks: dayBlocks, bookedMembers };
}

/** End of a gig plus the minimum gap: earliest moment the same person can start again. */
export function earliestNextStart(g: GigLike, minGapMinutes: number) {
  return addMinutes(gigWindow(g).end, minGapMinutes);
}
