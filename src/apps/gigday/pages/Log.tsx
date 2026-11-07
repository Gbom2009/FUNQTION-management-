import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../../core/db';
import { useI18n } from '../../../core/i18n';
import { Check, Modal, useToast } from '../../../core/ui';
import type { GearItem, GigLog, LogType } from '../../../core/types';
import { reportIssue } from '../../gear/data';
import { addLog } from '../data';
import { hhmm, useGigCtx } from '../components';

export type QuickKind = 'issue' | 'damage' | 'complaint' | 'compliment' | 'note' | 'vibe' | 'overtime_request';
export const QUICK: QuickKind[] = ['issue', 'damage', 'complaint', 'compliment', 'note', 'vibe', 'overtime_request'];

/** Quick log entry (also used by Booth mode). Damage becomes an App 5 issue. */
export function LogModal({ kind, onClose }: { kind: QuickKind; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const { gig, me } = useGigCtx();
  const [text, setText] = useState('');
  const [vibe, setVibe] = useState(4);
  const [minutes, setMinutes] = useState(30);
  const [by, setBy] = useState('');
  const [itemId, setItemId] = useState('');
  const [guests, setGuests] = useState(false);
  const items = useLiveQuery(async () => {
    const list = await db.packLists.where('gigId').equals(gig.id).first();
    const ids = new Set(list?.lines.map((l) => l.itemId) ?? []);
    return (await db.gearItems.toArray()).filter((i) => !i.deletedAt && (!ids.size || ids.has(i.id))).sort((a, b) => a.name.localeCompare(b.name));
  }, [gig.id]) ?? [];

  const save = async () => {
    if (kind === 'damage') {
      const item = items.find((i) => i.id === itemId) as GearItem | undefined;
      const issue = item ? await reportIssue(item, { title: text || t('gd.log.damage'), severity: 'minor', gigId: gig.id, causedByGuests: guests }) : undefined;
      await addLog(gig.id, 'damage', { text, issueId: issue?.id }, me);
    } else if (kind === 'vibe') await addLog(gig.id, 'vibe', { vibe, text }, me);
    else if (kind === 'overtime_request') await addLog(gig.id, 'overtime_request', { minutes, requestedBy: by || undefined, text }, me);
    else await addLog(gig.id, kind as LogType, { text }, me);
    toast(t('gd.logged'));
    onClose();
  };

  return (
    <Modal title={t(`gd.log.${kind}` as never)} onClose={onClose} footer={<button className="btn primary" onClick={() => void save()}>{t('common.save')}</button>}>
      {kind === 'vibe' && (
        <div className="row gd-vibe">{[1, 2, 3, 4, 5].map((v) => <button key={v} className={`chip ${vibe === v ? 'on' : ''}`} aria-pressed={vibe === v} onClick={() => setVibe(v)}>{v}</button>)}</div>
      )}
      {kind === 'overtime_request' && (
        <>
          <div className="row">{[30, 60, 90].map((m) => <button key={m} className="chip" aria-pressed={minutes === m} onClick={() => setMinutes(m)}>+{m} min</button>)}</div>
          <label className="field"><span>{t('gd.requestedBy')}</span><input value={by} onChange={(e) => setBy(e.target.value)} placeholder={t('gd.requestedByHint')} /></label>
          <p className="tiny muted">{t('gd.overtimeHint')}</p>
        </>
      )}
      {kind === 'damage' && (
        <>
          <label className="field"><span>{t('gd.item')}</span>
            <select value={itemId} onChange={(e) => setItemId(e.target.value)}>
              <option value="">–</option>
              {items.map((i) => <option key={i.id} value={i.id}>{i.code} · {i.name}</option>)}
            </select>
          </label>
          <Check label={t('gd.byGuests')} checked={guests} onChange={setGuests} />
        </>
      )}
      <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('gd.logText')} autoFocus={kind !== 'vibe'} />
    </Modal>
  );
}

export function logLine(l: GigLog, t: (k: never, p?: Record<string, string | number>) => string) {
  const parts = [t(`gd.log.${l.type}` as never)];
  if (l.vibe) parts.push(`${l.vibe}/5`);
  if (l.minutes) parts.push(`+${l.minutes} min`);
  if (l.requestedBy) parts.push(l.requestedBy);
  if (l.text) parts.push(l.text);
  return parts.join(' · ');
}

export default function Log() {
  const { t } = useI18n();
  const { logs } = useGigCtx();
  const [kind, setKind] = useState<QuickKind | null>(null);
  return (
    <div className="stack">
      <div className="chips">{QUICK.map((k) => <button key={k} className="chip" onClick={() => setKind(k)}>+ {t(`gd.log.${k}` as never)}</button>)}</div>
      <div className="list">
        {logs.map((l) => (
          <div key={l.id} className="list-item">
            <span className="mono-num">{hhmm(l.at)}</span>
            <span className="grow">{logLine(l, t as never)}</span>
            <span className={`member ${l.by}`}>{l.by[0].toUpperCase()}</span>
          </div>
        ))}
        {!logs.length && <p className="muted">{t('gd.noLog')}</p>}
      </div>
      {kind && <LogModal kind={kind} onClose={() => setKind(null)} />}
    </div>
  );
}
