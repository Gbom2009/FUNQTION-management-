import { useEffect, useState } from 'react';
import { useI18n } from '../../../core/i18n';
import { Empty, Section, useToast } from '../../../core/ui';
import { fmtDateTime } from '../../../core/format';
import { download } from '../../../core/backup';
import type { Epk } from '../../../core/types';
import { epkInput, makePdf, publishZip, restorePublish, usePublishes } from '../data';
import { planPublish, type Plan } from '../domain/epk';

export default function Publish({ epk }: { epk: Epk }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const history = usePublishes();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { epkInput().then((i) => setPlan(planPublish(i, { logoZip: 'x', pdf: 'x' }))); }, [epk.updatedAt]);
  const warn = (w: string) => {
    const [k, v] = w.split(':');
    if (k === 'usage') return t('pk.warn.usage', { name: v });
    if (k === 'consent') return t('pk.warn.consent', { name: v });
    if (k === 'en') return t('pk.warn.en');
    return t('pk.warn.bioShort');
  };
  return (
    <div>
      <div className="page-head"><h1>{t('pk.nav.publish')}</h1></div>
      <Section title={t('pk.checks')}>
        {plan && (
          <div className="stack">
            <div className={`banner ${plan.overBudget ? 'danger' : 'ok'}`}><span className="txt">{t('pk.budget', { kb: Math.round(plan.htmlBytes / 1024) })}</span></div>
            {plan.warnings.map((w) => <div key={w} className="banner warn"><span className="txt">{warn(w)}</span></div>)}
            <div className="small muted">{t('pk.willWrite', { photos: plan.photos.length, logos: plan.logos.length })}</div>
          </div>
        )}
      </Section>
      <Section title={t('pk.howTo')}>
        <ol className="small" style={{ paddingLeft: '1.2em' }}>
          <li>{t('pk.step1')}</li>
          <li>{t('pk.step2')}</li>
          <li>{t('pk.step3')}</li>
        </ol>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button className="btn primary" disabled={busy || !!plan?.overBudget} onClick={async () => {
            setBusy(true);
            try { const r = await publishZip(); toast(t('pk.published', { v: r.version, n: r.files.length })); }
            catch { toast(t('pk.publishFailed')); }
            setBusy(false);
          }}>{busy ? '…' : t('pk.makeZip')}</button>
          {(['nl', 'en'] as const).map((l) => (
            <button key={l} className="btn" disabled={busy} onClick={async () => {
              setBusy(true);
              try { download(`funqtion-presskit-${l}.pdf`, await makePdf(await epkInput(), l), 'application/pdf'); } finally { setBusy(false); }
            }}>PDF {l.toUpperCase()}</button>
          ))}
        </div>
      </Section>
      <Section title={t('pk.history')}>
        {history.length ? (
          <div className="list">
            {history.map((h) => (
              <div key={h.id} className="list-item row between">
                <span>v{h.version} · {fmtDateTime(h.at, lang)} · {h.files.length} {t('pk.files')}</span>
                <button className="btn small ghost" onClick={async () => { await restorePublish(h); toast(t('pk.restored', { v: h.version })); }}>{t('pk.restore')}</button>
              </div>
            ))}
          </div>
        ) : <Empty>{t('pk.noHistory')}</Empty>}
      </Section>
    </div>
  );
}
