import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n, type Key } from '../../../core/i18n';
import { useSession } from '../../../core/session';
import { Check, Field, Section, useToast } from '../../../core/ui';
import { centsFromInput, inputFromCents } from '../../../core/format';
import type { Settings as S } from '../../../core/types';
import { runTaskSync } from '../../bookings/domain/taskSync';
import { SignaturePad } from '../components';

export default function CtSettings() {
  const { t } = useI18n();
  const toast = useToast();
  const { settings, updateSettings, me } = useSession();
  const [drawing, setDrawing] = useState(false);
  const [sig, setSig] = useState<string>();
  const num = (k: keyof S, label: Key) => (
    <Field label={t(label)}><input inputMode="numeric" value={String(settings[k] ?? '')} onChange={(e) => updateSettings({ [k]: Number(e.target.value) || 0 } as Partial<S>)} onBlur={() => runTaskSync()} /></Field>
  );
  const mine = me ? settings.memberSignatures?.[me.id] : undefined;
  return (
    <div>
      <div className="page-head"><h1>{t('ct.settings')}</h1></div>
      <div className="dash">
        <Section title={t('ct.settingsSigning')}>
          <div className="stack">
            {num('contractSignByDays', 'ct.signByDays')}
            {num('contractReminderDays', 'ct.reminderDays')}
            <Field label={t('ct.overtimeRate')}><input inputMode="decimal" key={settings.overtimeRateHalfHour} defaultValue={inputFromCents(settings.overtimeRateHalfHour)} onBlur={(e) => updateSettings({ overtimeRateHalfHour: centsFromInput(e.target.value) ?? 0 })} /></Field>
            <Check label={t('ct.autoCountersign')} checked={settings.contractAutoCountersign} onChange={(v) => updateSettings({ contractAutoCountersign: v })} />
          </div>
        </Section>
        <Section title={t('ct.mySignature', { name: me?.name ?? '' })}>
          <div className="stack">
            <p className="small muted">{t('ct.mySignatureHint')}</p>
            {mine && !drawing && <img src={mine} alt={me?.name} style={{ background: '#fff', maxWidth: 260, border: '1px solid var(--fq-rule-color)' }} />}
            {drawing ? (
              <>
                <SignaturePad label={t('ct.sign.drawHere')} onChange={setSig} />
                <div className="row">
                  <button className="btn ghost" onClick={() => setDrawing(false)}>{t('common.cancel')}</button>
                  <button className="btn primary" disabled={!sig || !me} onClick={async () => { await updateSettings({ memberSignatures: { ...settings.memberSignatures, [me!.id]: sig } }); setDrawing(false); toast(t('common.saved')); }}>{t('common.save')}</button>
                </div>
              </>
            ) : <div><button className="btn small" onClick={() => setDrawing(true)}>{mine ? t('ct.redraw') : t('ct.draw')}</button></div>}
          </div>
        </Section>
        <Section title={t('ct.settingsMoney')}>
          <p className="small">{t('ct.settingsMoneyHint')}</p>
          <Link className="btn small" to="/invoicing/settings">{t('ct.toInvSettings')}</Link>
        </Section>
      </div>
    </div>
  );
}
