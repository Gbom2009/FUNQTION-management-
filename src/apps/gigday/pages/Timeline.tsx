import { useState } from 'react';
import { useI18n } from '../../../core/i18n';
import { Check, Modal } from '../../../core/ui';
import type { TimelineStep } from '../../../core/types';
import { addCustomStep, doneStep, setPlanned, undoStep } from '../data';
import { delay, stepState } from '../domain/timeline';
import { hhmm, isoAt, useGigCtx, useNow } from '../components';

/** Vertical timeline: planned, actual (with the difference), tap to tick/edit/move. */
export function TimelineList({ editable = true }: { editable?: boolean }) {
  const { t } = useI18n();
  const { steps, me, gig } = useGigCtx();
  const now = useNow();
  const [open, setOpen] = useState<TimelineStep | null>(null);
  const [adding, setAdding] = useState(false);
  return (
    <div className="gd-timeline">
      {steps.map((s) => {
        const st = stepState(s, now);
        const d = delay(s);
        return (
          <button key={s.id} className={`gd-step ${st} ${s.kind}`} onClick={() => editable && setOpen(s)}>
            <span className="gd-step-time mono-num">{hhmm(s.plannedAt)}</span>
            <span className="grow">
              <span className="gd-step-label">{s.label}</span>
              {s.actualAt && <span className={`tiny ${d > 10 ? 'danger-text' : 'muted'}`}> ✓ {hhmm(s.actualAt)}{d ? ` (${d > 0 ? '+' : ''}${d})` : ''}</span>}
            </span>
            {s.memberId && <span className={`member ${s.memberId}`}>{s.memberId[0].toUpperCase()}</span>}
            {s.locked && <span className="tiny muted" title={t('gd.locked')}>✎</span>}
          </button>
        );
      })}
      {editable && <button className="btn small ghost" onClick={() => setAdding(true)}>+ {t('gd.addStep')}</button>}
      {open && <StepEditor step={open} me={me} onClose={() => setOpen(null)} />}
      {adding && <AddStep gigStart={steps[0]?.plannedAt ?? new Date(`${gig.date}T20:00`).toISOString()} onAdd={async (label, iso) => { await addCustomStep(gig.id, label, iso); setAdding(false); }} onClose={() => setAdding(false)} />}
    </div>
  );
}

function StepEditor({ step, me, onClose }: { step: TimelineStep; me: 'gijs' | 'coen'; onClose: () => void }) {
  const { t } = useI18n();
  const [time, setTime] = useState(hhmm(step.plannedAt));
  const [moveRest, setMoveRest] = useState(true);
  return (
    <Modal title={step.label} onClose={onClose} footer={<>
      <button className="btn ghost" onClick={onClose}>{t('common.cancel')}</button>
      <button className="btn primary" onClick={async () => { await setPlanned(step, isoAt(step.plannedAt, time), moveRest); onClose(); }}>{t('common.save')}</button>
    </>}>
      {step.actualAt
        ? <button className="btn" onClick={async () => { await undoStep(step); onClose(); }}>{t('gd.undo')} ({hhmm(step.actualAt)})</button>
        : <button className="btn primary" onClick={async () => { await doneStep(step, me); onClose(); }}>{t('gd.doneNow')}</button>}
      <label className="field"><span>{t('gd.plannedTime')}</span><input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
      {step.kind !== 'curfew' && <Check label={t('gd.moveRest')} checked={moveRest} onChange={setMoveRest} />}
    </Modal>
  );
}

function AddStep({ gigStart, onAdd, onClose }: { gigStart: string; onAdd: (label: string, iso: string) => void; onClose: () => void }) {
  const { t } = useI18n();
  const [label, setLabel] = useState('');
  const [time, setTime] = useState(hhmm(gigStart));
  return (
    <Modal title={t('gd.addStep')} onClose={onClose} footer={<button className="btn primary" disabled={!label.trim()} onClick={() => onAdd(label.trim(), isoAt(gigStart, time))}>{t('common.save')}</button>}>
      <label className="field"><span>{t('gd.stepLabel')}</span><input value={label} onChange={(e) => setLabel(e.target.value)} autoFocus /></label>
      <label className="field"><span>{t('gd.plannedTime')}</span><input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
    </Modal>
  );
}

export default function TimelinePage() {
  return <TimelineList />;
}
