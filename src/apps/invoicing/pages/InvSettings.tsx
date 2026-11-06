import { useI18n, type Key } from '../../../core/i18n';
import { useSession } from '../../../core/session';
import { Field, Section } from '../../../core/ui';
import type { Settings as S, VatMode } from '../../../core/types';
import { TERMS_EN, TERMS_NL } from '../terms';
import { runTaskSync } from '../../bookings/domain/taskSync';

export default function InvSettings() {
  const { t } = useI18n();
  const { settings, updateSettings } = useSession();
  // Text fields save on blur, so the audit-free settings record is not rewritten per keystroke.
  const text = (k: keyof S, label: Key, opts: { type?: string; hint?: Key; multiline?: boolean } = {}) => (
    <Field label={t(label)} hint={opts.hint ? t(opts.hint) : undefined}>
      {opts.multiline
        ? <textarea key={String(settings[k] ?? '')} defaultValue={String(settings[k] ?? '')} rows={3} onBlur={(e) => updateSettings({ [k]: e.target.value } as Partial<S>)} />
        : <input key={String(settings[k] ?? '')} type={opts.type ?? 'text'} defaultValue={String(settings[k] ?? '')} onBlur={(e) => updateSettings({ [k]: e.target.value.trim() } as Partial<S>)} autoComplete="off" />}
    </Field>
  );
  const num = (k: keyof S, label: Key) => (
    <Field label={t(label)}><input inputMode="numeric" value={String(settings[k] ?? '')} onChange={(e) => { updateSettings({ [k]: Number(e.target.value) || 0 } as Partial<S>); }} onBlur={() => runTaskSync()} /></Field>
  );
  const scale = [...settings.cancellationScale].sort((a, b) => b.daysBefore - a.daysBefore);
  const setScale = (s: S['cancellationScale']) => updateSettings({ cancellationScale: s });

  return (
    <div>
      <div className="page-head"><h1>{t('s.inv.title')}</h1></div>
      <Section title={t('s.vatMode')}>
        <div className="stack">
          <div className="chips">
            {(['private', 'kor', 'vat'] as VatMode[]).map((m) => <button key={m} className="chip" aria-pressed={settings.vatMode === m} onClick={() => updateSettings({ vatMode: m })}>{t(`s.vatMode.${m}`)}</button>)}
          </div>
          <p className="small muted">{t('s.vatModeHint')}</p>
        </div>
      </Section>
      <div className="dash">
        <Section title={t('s.profile')}>
          <div className="stack">
            {text('businessName', 'settings.businessName')}
            {text('legalNames', 's.legalNames')}
            {text('address', 'venue.street')}
            <div className="grid2">{text('postcode', 'venue.postcode')}{text('city', 'venue.city')}</div>
            {text('bizEmail', 's.bizEmail', { type: 'email' })}
            {text('bizPhone', 's.bizPhone', { type: 'tel' })}
            {text('website', 's.website')}
            {settings.vatMode !== 'private' && text('kvk', 's.kvk')}
            {settings.vatMode === 'vat' && text('vatId', 's.vatId')}
          </div>
        </Section>
        <Section title={t('s.iban')}>
          <div className="stack">
            {text('iban', 's.iban', { hint: 's.ibanHint' })}
            {text('accountHolder', 's.accountHolder')}
          </div>
        </Section>
        <Section title={t('gig.money')}>
          <div className="stack">
            {num('paymentTermDays', 's.paymentTerm')}
            {num('depositPct', 's.depositPct')}
            {num('quoteValidDays', 'settings.quoteValid')}
          </div>
        </Section>
        <Section title={t('s.dunning')}>
          <div className="stack">
            {num('dunning1Days', 's.dun1')}
            {num('dunning2Days', 's.dun2')}
            {num('dunning3Days', 's.dun3')}
          </div>
        </Section>
        <Section title={t('s.scale')}>
          <div className="stack">
            {scale.map((r, i) => (
              <div key={i} className="row">
                <label className="field" style={{ flex: 1 }}><span>{t('s.scaleDays')}</span>
                  <input className="input" inputMode="numeric" value={r.daysBefore} onChange={(e) => setScale(scale.map((x, j) => (j === i ? { ...x, daysBefore: Number(e.target.value) || 0 } : x)))} /></label>
                <label className="field" style={{ width: 110 }}><span>{t('s.scalePct')}</span>
                  <input className="input" inputMode="numeric" value={r.pct} onChange={(e) => setScale(scale.map((x, j) => (j === i ? { ...x, pct: Number(e.target.value) || 0 } : x)))} /></label>
                <button className="btn icon small" style={{ alignSelf: 'flex-end' }} aria-label={t('common.delete')} onClick={() => setScale(scale.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
            <div><button className="btn small" onClick={() => setScale([...scale, { daysBefore: 0, pct: 100 }])}>{t('s.addScale')}</button></div>
          </div>
        </Section>
        <Section title={t('pdf.vat')}>
          <div className="stack">
            {text('notePrivate', 's.notePrivate', { multiline: true })}
            {text('noteKor', 's.noteKor', { multiline: true })}
          </div>
        </Section>
      </div>
      <Section title={t('s.terms')} actions={<button className="btn small ghost" onClick={() => updateSettings({ termsNl: TERMS_NL, termsEn: TERMS_EN })}>{t('s.resetTerms')}</button>}>
        <p className="small muted">{t('s.termsHint')}</p>
        <div className="grid2">
          <Field label={t('s.terms')}><textarea key={'nl' + settings.termsNl.length} rows={16} defaultValue={settings.termsNl} onBlur={(e) => updateSettings({ termsNl: e.target.value })} style={{ fontSize: 12 }} /></Field>
          <Field label={t('s.termsEn')}><textarea key={'en' + settings.termsEn.length} rows={16} defaultValue={settings.termsEn} onBlur={(e) => updateSettings({ termsEn: e.target.value })} style={{ fontSize: 12 }} /></Field>
        </div>
      </Section>
    </div>
  );
}
