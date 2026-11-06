import { db } from '../../../core/db';
import { alive, save } from '../../../core/repo';
import { translate } from '../../../core/i18n';
import { DEFAULT_SETTINGS, type Task } from '../../../core/types';
import { desiredTasks, planTaskSync } from './reminders';

let running = false;

/** Apply the reminder engine to the database. Safe to call often. */
export async function runTaskSync(now = new Date()) {
  if (running) return;
  running = true;
  try {
    const settings = (await db.settings.get('settings')) ?? DEFAULT_SETTINGS;
    const [gigs, enquiries, quotes, reviews, tasks, invoices, payments] = await Promise.all([
      db.gigs.toArray(), db.enquiries.toArray(), db.quotes.toArray(), db.reviews.toArray(), db.tasks.toArray(),
      db.invoices.toArray(), db.payments.toArray(),
    ]);
    const desired = desiredTasks({ gigs: alive(gigs), enquiries: alive(enquiries), quotes, reviews, invoices: alive(invoices), payments: alive(payments) },
      { ...DEFAULT_SETTINGS, ...settings }, now);
    const plan = planTaskSync(desired, tasks);
    for (const d of plan.create) {
      await save<Task>('tasks', {
        title: translate(settings.language, `task.${d.kind}`, d.params),
        kind: d.kind, dueAt: d.dueAt, assignedTo: d.assignedTo, gigId: d.gigId, enquiryId: d.enquiryId,
        personId: d.personId, invoiceId: d.invoiceId, status: 'open', ruleKey: d.ruleKey, templateKind: d.templateKind,
      }, { actor: 'system' });
    }
    for (const t of plan.cancel) await save<Task>('tasks', { ...t, status: 'cancelled' }, { actor: 'system' });
  } finally {
    running = false;
  }
}
