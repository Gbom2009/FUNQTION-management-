import type { Assignee, Enquiry, Gig, Quote, Review, Settings, Task, TaskKind, TemplateKind } from '../../../core/types';
import { addDays, addMonths, at, parseDate } from '../../../core/dates';

// The reminder engine is a pure function: given the current data it returns
// the automatic tasks that *should* exist. syncTasks() then creates missing
// ones and cancels open ones that are no longer relevant (e.g. the quote was
// accepted, so the follow-up disappears). Each task has a stable ruleKey so it
// is created at most once, even after it was completed.

export interface DesiredTask {
  ruleKey: string;
  kind: TaskKind;
  dueAt: string;
  assignedTo: Assignee;
  gigId?: string;
  enquiryId?: string;
  personId?: string;
  templateKind?: TemplateKind;
  /** i18n params for the title */
  params: Record<string, string>;
}

const STALE_DAYS = 60; // never generate tasks that were due more than this long ago

export function desiredTasks(
  data: { gigs: Gig[]; enquiries: Enquiry[]; quotes: Quote[]; reviews: Review[] },
  s: Settings,
  now = new Date(),
): DesiredTask[] {
  const out: DesiredTask[] = [];
  const staleLimit = addDays(now, -STALE_DAYS);
  const push = (t: DesiredTask) => { if (new Date(t.dueAt) >= staleLimit) out.push(t); };

  for (const e of data.enquiries) {
    if (e.deletedAt) continue;
    if (e.status === 'new' && !e.firstResponseAt) {
      push({
        ruleKey: `reply:${e.id}`, kind: 'reply_enquiry', assignedTo: e.ownerId, enquiryId: e.id, personId: e.personId,
        dueAt: new Date(new Date(e.receivedAt).getTime() + s.replyHours * 3600_000).toISOString(),
        templateKind: 'enquiry_available', params: { name: e.contactName ?? '' },
      });
    }
  }

  const quotesByGig = new Map<string, Quote[]>();
  for (const q of data.quotes) {
    if (q.deletedAt) continue;
    quotesByGig.set(q.gigId, [...(quotesByGig.get(q.gigId) ?? []), q]);
  }
  const reviewed = new Set(data.reviews.filter((r) => !r.deletedAt && (r.requestedAt || r.receivedAt)).map((r) => r.gigId));

  for (const g of data.gigs) {
    if (g.deletedAt || !g.date) continue;
    const owner = g.ownerId;
    const players: Assignee = g.performers.length === 2 ? 'both' : (g.performers[0] ?? owner);
    const p = { title: g.title, date: g.date };
    const gigStart = at(g.date, g.startTime || '20:00');
    const dayAfter = addDays(parseDate(g.date), 1);
    dayAfter.setHours(10, 0, 0, 0);

    if (g.stage === 'quote_sent') {
      const latest = (quotesByGig.get(g.id) ?? []).sort((a, b) => b.version - a.version)[0];
      const sentAt = latest?.sentAt ?? g.quoteSentAt ?? g.stageChangedAt;
      const v = latest?.version ?? 1;
      const sent = new Date(sentAt);
      push({ ruleKey: `quote-fu1:${g.id}:${v}`, kind: 'follow_up_quote', assignedTo: owner, gigId: g.id, personId: g.clientPersonId,
        dueAt: addDays(sent, s.quoteFollowUp1Days).toISOString(), templateKind: 'quote_follow_up', params: p });
      push({ ruleKey: `quote-fu2:${g.id}:${v}`, kind: 'follow_up_quote', assignedTo: owner, gigId: g.id, personId: g.clientPersonId,
        dueAt: addDays(sent, s.quoteFollowUp2Days).toISOString(), templateKind: 'quote_follow_up', params: p });
      const validUntil = latest?.validUntil;
      if (validUntil) {
        push({ ruleKey: `quote-exp:${g.id}:${v}`, kind: 'quote_expiry', assignedTo: owner, gigId: g.id,
          dueAt: at(validUntil, '09:00').toISOString(), params: p });
      }
    }

    if (g.stage === 'option' && g.optionExpiresAt) {
      push({ ruleKey: `option-exp:${g.id}:${g.optionExpiresAt}`, kind: 'option_expiry', assignedTo: owner, gigId: g.id,
        dueAt: addDays(at(g.optionExpiresAt, '09:00'), -2).toISOString(), params: p });
    }

    if (g.stage === 'confirmed') {
      if (gigStart > now) {
        if (!g.musicWishes.length) {
          push({ ruleKey: `music:${g.id}`, kind: 'music_wishes', assignedTo: owner, gigId: g.id, personId: g.clientPersonId,
            dueAt: addDays(at(g.date, '10:00'), -s.musicWishesDays).toISOString(), templateKind: 'music_wishes', params: p });
        }
        push({ ruleKey: `final:${g.id}`, kind: 'final_check', assignedTo: owner, gigId: g.id, personId: g.clientPersonId,
          dueAt: addDays(at(g.date, '10:00'), -s.finalCheckDays).toISOString(), templateKind: 'final_check', params: p });
        push({ ruleKey: `gear:${g.id}`, kind: 'gear_check', assignedTo: players, gigId: g.id,
          dueAt: addDays(at(g.date, '10:00'), -s.gearCheckDays).toISOString(), params: p });
      } else {
        push({ ruleKey: `played:${g.id}`, kind: 'mark_played', assignedTo: owner, gigId: g.id,
          dueAt: dayAfter.toISOString(), params: p });
      }
    }

    if (g.stage === 'played') {
      push({ ruleKey: `invoice:${g.id}`, kind: 'invoice', assignedTo: owner, gigId: g.id,
        dueAt: dayAfter.toISOString(), params: p });
    }

    if ((g.stage === 'played' || g.stage === 'invoiced' || g.stage === 'paid') && !reviewed.has(g.id)) {
      push({ ruleKey: `review:${g.id}`, kind: 'review_request', assignedTo: owner, gigId: g.id, personId: g.clientPersonId,
        dueAt: addDays(at(g.date, '12:00'), s.reviewDays).toISOString(), templateKind: 'thank_you_review', params: p });
    }

    if (g.stage === 'invoiced') {
      const from = g.invoicedAt ? new Date(g.invoicedAt) : dayAfter;
      push({ ruleKey: `payment:${g.id}`, kind: 'payment', assignedTo: owner, gigId: g.id,
        dueAt: addDays(from, s.paymentCheckDays).toISOString(), params: p });
    }

    if (g.seriesName && ['played', 'invoiced', 'paid'].includes(g.stage)) {
      const hasLater = data.gigs.some((o) => !o.deletedAt && o.id !== g.id && o.seriesName === g.seriesName && o.date > g.date
        && o.stage !== 'lost' && o.stage !== 'cancelled');
      if (!hasLater) {
        push({ ruleKey: `rebook:${g.id}`, kind: 'rebook', assignedTo: owner, gigId: g.id, personId: g.clientPersonId,
          dueAt: addMonths(at(g.date, '10:00'), 12 - s.rebookMonthsBefore).toISOString(), templateKind: 'rebook',
          params: { ...p, series: g.seriesName } });
      }
    }
  }
  return out;
}

export interface TaskSyncPlan {
  create: DesiredTask[];
  cancel: Task[];
}

/** Diff desired automatic tasks against the existing ones. */
export function planTaskSync(desired: DesiredTask[], existing: Task[]): TaskSyncPlan {
  const byKey = new Map(existing.filter((t) => t.ruleKey).map((t) => [t.ruleKey!, t]));
  const wanted = new Set(desired.map((d) => d.ruleKey));
  return {
    create: desired.filter((d) => !byKey.has(d.ruleKey)),
    cancel: existing.filter((t) => t.ruleKey && t.status === 'open' && !t.deletedAt && !wanted.has(t.ruleKey)),
  };
}

export function isDue(t: Task, now = new Date()) {
  const due = new Date(t.snoozedUntil ?? t.dueAt);
  return t.status === 'open' && due <= now;
}
