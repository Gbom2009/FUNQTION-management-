import { useI18n } from '../../../core/i18n';
import { useSession } from '../../../core/session';
import { Field, Section } from '../../../core/ui';
import { DEFAULT_PUBLIC_URL } from '../../../core/share';

export default function FeedbackSettings() {
  const { t } = useI18n();
  const { settings, updateSettings } = useSession();
  return (
    <div>
      <div className="page-head"><h1>{t('fb.settings')}</h1></div>
      <Section title={t('fb.links')}>
        <Field label={t('fb.publicUrl')} hint={t('fb.publicUrlHint')}><input value={settings.publicAppUrl ?? ''} placeholder={DEFAULT_PUBLIC_URL} onChange={(e) => updateSettings({ publicAppUrl: e.target.value.trim() || undefined })} /></Field>
        <Field label={t('fb.answerWa')} hint={t('fb.answerWaHint')}><input inputMode="tel" value={settings.answerWhatsApp ?? ''} placeholder={settings.bizPhone ?? '06…'} onChange={(e) => updateSettings({ answerWhatsApp: e.target.value.trim() || undefined })} /></Field>
        <Field label={t('fb.reminderDays')}><input inputMode="numeric" value={String(settings.feedbackReminderDays ?? 5)} onChange={(e) => updateSettings({ feedbackReminderDays: Number(e.target.value) || 5 })} /></Field>
        <Field label={t('settings.reviewLink')} hint={t('fb.googleHint')}><input value={settings.reviewLink ?? ''} placeholder="https://g.page/r/…" onChange={(e) => updateSettings({ reviewLink: e.target.value.trim() })} /></Field>
      </Section>
    </div>
  );
}
