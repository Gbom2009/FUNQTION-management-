import { useEffect, useState } from 'react';
import { useI18n } from '../../../core/i18n';
import { Chips } from '../../../core/ui';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../../core/db';
import { mediaUrl } from '../../promo/data';
import { epkInput } from '../data';
import { planPublish } from '../domain/epk';

/** Exactly the page that will be published, with the live site's CSS. */
export default function Preview() {
  const { t } = useI18n();
  const [lang, setLang] = useState<'nl' | 'en'>('nl');
  const [width, setWidth] = useState<'phone' | 'desktop'>('desktop');
  const [html, setHtml] = useState('');
  const [kb, setKb] = useState(0);
  const stamp = useLiveQuery(() => db.epk.get('epk').then((e) => e?.updatedAt), []);
  useEffect(() => {
    epkInput().then((input) => {
      const plan = planPublish(input, { logoZip: 'funqtion-logos.zip', pdf: 'funqtion-presskit-{lang}.pdf' });
      let page = plan.pages[lang === 'nl' ? 'presskit/index.html' : 'en/presskit/index.html'];
      // Resolve the site's CSS/JS/images against the live site; photos from this device.
      const base = input.epk.siteBase.replace(/\/?$/, '/') + (lang === 'nl' ? 'presskit/' : 'en/presskit/');
      page = page.replace('<head>', `<head>\n<base href="${base}">`);
      for (const p of plan.photos) page = page.split(`${lang === 'nl' ? '' : '../../presskit/'}media/${p.file}`).join(mediaUrl(p.m) ?? '');
      setHtml(page);
      setKb(Math.round(plan.htmlBytes / 1024));
    });
  }, [lang, stamp]);
  return (
    <div>
      <div className="page-head row between">
        <h1>{t('pk.nav.preview')}</h1>
        <span className="tiny muted mono-num">HTML {kb} KB / 150 KB</span>
      </div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <Chips options={[{ value: 'nl', label: 'NL' }, { value: 'en', label: 'EN' }]} value={lang} onChange={(v) => setLang(v as 'nl' | 'en')} />
        <Chips options={[{ value: 'desktop', label: t('pk.desktop') }, { value: 'phone', label: t('pk.phone') }]} value={width} onChange={(v) => setWidth(v as 'phone' | 'desktop')} />
      </div>
      <iframe title={t('pk.nav.preview')} srcDoc={html} sandbox="allow-same-origin allow-scripts allow-popups"
        style={{ width: width === 'phone' ? 390 : '100%', maxWidth: '100%', height: '75vh', border: 'var(--fq-rule)', background: '#040404', display: 'block', marginTop: 'var(--s3)' }} />
      <p className="tiny muted">{t('pk.previewNote')}</p>
    </div>
  );
}
