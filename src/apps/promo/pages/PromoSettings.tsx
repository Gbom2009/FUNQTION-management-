import { useState } from 'react';
import { useI18n } from '../../../core/i18n';
import { useSession } from '../../../core/session';
import { Field, Section } from '../../../core/ui';
import type { BrandKit } from '../../../core/types';
import { brandOf, parseTags } from '../domain/promo';

export default function PromoSettings() {
  const { t } = useI18n();
  const { settings, updateSettings } = useSession();
  const brand = brandOf(settings);
  const setBrand = (c: Partial<BrandKit>) => updateSettings({ brand: { ...brand, ...c } });
  const [tags, setTags] = useState(brand.hashtags.map((h) => `#${h}`).join(' '));
  const [colours, setColours] = useState(brand.colours.join(', '));
  return (
    <div>
      <div className="page-head"><h1>{t('pr.settings')}</h1></div>
      <Section title={t('pr.brandKit')}>
        <p className="small muted">{t('pr.brandHelp')}</p>
        <div className="grid2">
          <Field label={t('pr.tagline')}><input value={brand.tagline} onChange={(e) => setBrand({ tagline: e.target.value })} /></Field>
          <Field label="Instagram"><input value={brand.instagram} onChange={(e) => setBrand({ instagram: e.target.value.replace(/^@/, '') })} /></Field>
        </div>
        <Field label={t('pr.colours')}>
          <input value={colours} onChange={(e) => setColours(e.target.value)} onBlur={() => setBrand({ colours: colours.split(/[\s,]+/).filter((c) => /^#[0-9a-f]{3,8}$/i.test(c)) })} />
        </Field>
        <div className="row">{brand.colours.map((c) => <span key={c} className="swatch" title={c} style={{ background: c, width: 28, height: 28, border: 'var(--fq-rule)', display: 'inline-block' }} />)}</div>
        <Field label={t('pr.defaultTags')}><input value={tags} onChange={(e) => setTags(e.target.value)} onBlur={() => setBrand({ hashtags: parseTags(tags) })} /></Field>
        <div className="grid2">
          <Field label={t('pr.footerNl')}><input value={brand.captionFooterNl} onChange={(e) => setBrand({ captionFooterNl: e.target.value })} /></Field>
          <Field label={t('pr.footerEn')}><input value={brand.captionFooterEn} onChange={(e) => setBrand({ captionFooterEn: e.target.value })} /></Field>
        </div>
      </Section>
      <Section title={t('pr.reminders')}>
        <div className="grid2">
          <Field label={t('pr.tonightAt')}><input type="time" value={settings.promoTonightAt ?? '12:00'} onChange={(e) => updateSettings({ promoTonightAt: e.target.value })} /></Field>
          <Field label={t('pr.thanksAt')}><input type="time" value={settings.promoThanksAt ?? '11:00'} onChange={(e) => updateSettings({ promoThanksAt: e.target.value })} /></Field>
        </div>
        <p className="small muted">{t('pr.remindersHelp')}</p>
      </Section>
    </div>
  );
}
