import { useState } from 'react';
import { useI18n, type Key } from '../../../core/i18n';
import { Empty, Field, Modal, Section } from '../../../core/ui';
import { fmtDateTime } from '../../../core/format';
import { CONSENT_PURPOSES, type Consent } from '../../../core/types';
import { useGigs } from '../../bookings/data';
import { addConsent, useConsents, withdrawConsent } from '../data';

const SOURCES: Consent['source'][] = ['portal', 'feedback_form', 'contract', 'in_person', 'whatsapp', 'email', 'other'];

/** Proof of who agreed to what (AVG/GDPR, portrait rights). Withdrawn consents stay listed. */
export default function Consents() {
  const { t, lang } = useI18n();
  const gigs = useGigs();
  const gigTitle = new Map(gigs.map((g) => [g.id, `${g.date} · ${g.title}`]));
  const all = useConsents().sort((a, b) => b.at.localeCompare(a.at));
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div className="page-head row between">
        <h1>{t('pr.nav.consents')}</h1>
        <button className="btn small" onClick={() => setOpen(true)}>+ {t('pr.addConsent')}</button>
      </div>
      <p className="small muted">{t('pr.consentsHelp')}</p>
      <Section>
        {all.length ? (
          <div className="list">
            {all.map((c) => (
              <div key={c.id} className="list-item row between">
                <div>
                  <div className="strong">{c.subjectName} · {t(`pr.purpose.${c.purpose}` as Key)}</div>
                  <div className="tiny muted">
                    {c.given ? t('pr.given') : t('pr.refused')} · {t(`pr.source.${c.source}` as Key)} · {fmtDateTime(c.at, lang)}
                    {c.gigId ? ` · ${gigTitle.get(c.gigId) ?? ''}` : ''}{c.scope ? ` · ${c.scope}` : ''}
                  </div>
                  {c.withdrawnAt && <div className="tiny danger-text">{t('pr.withdrawnAt', { at: fmtDateTime(c.withdrawnAt, lang) })}</div>}
                </div>
                {!c.withdrawnAt && c.given && <button className="btn small ghost" onClick={() => withdrawConsent(c.id)}>{t('pr.withdraw')}</button>}
              </div>
            ))}
          </div>
        ) : <Empty>{t('pr.noConsents')}</Empty>}
      </Section>
      {open && <NewConsent onClose={() => setOpen(false)} />}
    </div>
  );
}

function NewConsent({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const gigs = useGigs().sort((a, b) => b.date.localeCompare(a.date));
  const [v, setV] = useState<{ purpose: Consent['purpose']; gigId: string; subjectName: string; given: boolean; source: Consent['source']; scope: string; evidence: string }>(
    { purpose: 'photo_promo', gigId: '', subjectName: '', given: true, source: 'whatsapp', scope: 'Instagram + website', evidence: '' });
  return (
    <Modal title={t('pr.addConsent')} onClose={onClose} footer={<button className="btn primary" disabled={!v.subjectName.trim()} onClick={async () => {
      await addConsent({ ...v, gigId: v.gigId || undefined, subjectName: v.subjectName.trim(), evidence: v.evidence || undefined });
      onClose();
    }}>{t('pr.save')}</button>}>
      <div className="stack">
        <Field label={t('pr.purposeLabel')}>
          <select value={v.purpose} onChange={(e) => setV({ ...v, purpose: e.target.value as Consent['purpose'] })}>
            {CONSENT_PURPOSES.map((p) => <option key={p} value={p}>{t(`pr.purpose.${p}` as Key)}</option>)}
          </select>
        </Field>
        <Field label={t('pr.who')}><input value={v.subjectName} placeholder="Lisa & Tom" onChange={(e) => setV({ ...v, subjectName: e.target.value })} /></Field>
        <Field label={t('pr.gig')}>
          <select value={v.gigId} onChange={(e) => setV({ ...v, gigId: e.target.value })}>
            <option value="">—</option>
            {gigs.map((g) => <option key={g.id} value={g.id}>{g.date} · {g.title}</option>)}
          </select>
        </Field>
        <div className="grid2">
          <Field label={t('pr.sourceLabel')}>
            <select value={v.source} onChange={(e) => setV({ ...v, source: e.target.value as Consent['source'] })}>
              {SOURCES.map((s) => <option key={s} value={s}>{t(`pr.source.${s}` as Key)}</option>)}
            </select>
          </Field>
          <Field label={t('pr.answer')}>
            <select value={v.given ? 'yes' : 'no'} onChange={(e) => setV({ ...v, given: e.target.value === 'yes' })}>
              <option value="yes">{t('pr.given')}</option>
              <option value="no">{t('pr.refused')}</option>
            </select>
          </Field>
        </div>
        <Field label={t('pr.scope')}><input value={v.scope} onChange={(e) => setV({ ...v, scope: e.target.value })} /></Field>
        <Field label={t('pr.evidence')} hint={t('pr.evidenceHint')}><textarea rows={2} value={v.evidence} onChange={(e) => setV({ ...v, evidence: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
