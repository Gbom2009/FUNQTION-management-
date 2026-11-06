import { useState } from 'react';
import { useI18n, type Key } from '../../../core/i18n';
import { useSession } from '../../../core/session';
import { Empty } from '../../../core/ui';
import { addDays, startOfDay } from '../../../core/dates';
import { useTasks } from '../data';
import { NewTaskButton, TaskRow } from '../components/parts';
import type { Task } from '../../../core/types';

export default function Tasks() {
  const { t } = useI18n();
  const { me } = useSession();
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [showDone, setShowDone] = useState(false);
  const all = useTasks().filter((x) => x.status !== 'cancelled');
  const tasks = all.filter((x) => scope === 'all' || x.assignedTo === me?.id || x.assignedTo === 'both');
  const open = tasks.filter((x) => x.status === 'open');
  const due = (x: Task) => new Date(x.snoozedUntil ?? x.dueAt);
  const now = new Date();
  const endToday = addDays(startOfDay(now), 1);
  const endWeek = addDays(startOfDay(now), 7);
  const groups: { key: Key; items: Task[] }[] = [
    { key: 'tasks.overdue', items: open.filter((x) => due(x) < startOfDay(now)) },
    { key: 'tasks.today', items: open.filter((x) => due(x) >= startOfDay(now) && due(x) < endToday) },
    { key: 'tasks.week', items: open.filter((x) => due(x) >= endToday && due(x) < endWeek) },
    { key: 'tasks.later', items: open.filter((x) => due(x) >= endWeek) },
  ];
  const done = tasks.filter((x) => x.status === 'done').sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '')).slice(0, 30);
  return (
    <div>
      <div className="page-head">
        <h1>{t('tasks.title')}</h1>
        <div className="row">
          <div className="chips">
            <button className="chip" aria-pressed={scope === 'mine'} onClick={() => setScope('mine')}>{t('tasks.mine')}</button>
            <button className="chip" aria-pressed={scope === 'all'} onClick={() => setScope('all')}>{t('tasks.all')}</button>
          </div>
          <NewTaskButton />
        </div>
      </div>
      {open.length === 0 && <Empty>{t('tasks.empty')}</Empty>}
      {groups.filter((g) => g.items.length).map((g) => (
        <div key={g.key} style={{ marginBottom: 'var(--s5)' }}>
          <div className="legend" style={{ marginBottom: 'var(--s2)', color: g.key === 'tasks.overdue' ? 'var(--danger)' : undefined }}>{t(g.key)} · {g.items.length}</div>
          <div className="list">{g.items.sort((a, b) => due(a).getTime() - due(b).getTime()).map((x) => <TaskRow key={x.id} task={x} />)}</div>
        </div>
      ))}
      <button className="btn small ghost" onClick={() => setShowDone(!showDone)}>{t('tasks.done')} ({done.length}) {showDone ? '▲' : '▼'}</button>
      {showDone && <div className="list" style={{ marginTop: 'var(--s2)' }}>{done.map((x) => <TaskRow key={x.id} task={x} />)}</div>}
    </div>
  );
}
