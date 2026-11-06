import { useState } from 'react';
import { useI18n, type Key } from '../../../core/i18n';
import { useSession } from '../../../core/session';
import { Section, useToast } from '../../../core/ui';
import { euro, fmtDateTime } from '../../../core/format';
import { save } from '../../../core/repo';
import { todayStr } from '../../../core/dates';
import { download } from '../../../core/backup';
import type { VatPeriod } from '../../../core/types';
import { hoursFor, periodOf, pnl, resultShares, vatBoxes } from '../domain/ledger';
import { useCategories, useHours, useLedger, useVatPeriods } from '../data';
import { Amount, PeriodBar, usePeriod } from '../components';

export default function Reports() {
  const { t, lang } = useI18n();
  const { settings } = useSession();
  const toast = useToast();
  const d = useLedger();
  const cats = new Map(useCategories().map((c) => [c.id, c]));
  const hours = useHours();
  const vatPeriods = useVatPeriods();
  const ctl = usePeriod('year');
  const [qKey, setQKey] = useState(periodOf('quarter', todayStr()));
  const [busy, setBusy] = useState(false);
  if (!d) return null;
  const r = pnl(d, ctl.period);
  const shares = resultShares(d, ctl.period);
  const year = ctl.period.from.slice(0, 4);
  const h = { gijs: hoursFor('gijs', year, hours, d.gigs).total, coen: hoursFor('coen', year, hours, d.gigs).total };

  async function makePdf() {
    const [{ yearReportDefinition }, { pdfBlob }] = await Promise.all([import('../reports'), import('../../invoicing/pdf')]);
    return pdfBlob(yearReportDefinition(d!, ctl.period, lang, h));
  }
  async function exportPdf() { setBusy(true); try { download(`jaaroverzicht-${ctl.period.key}.pdf`, await makePdf(), 'application/pdf'); } finally { setBusy(false); } }
  async function exportPack() {
    setBusy(true);
    try {
      const { accountantPack } = await import('../reports');
      download(`funqtion-administratie-${ctl.period.key}.zip`, await accountantPack(d!, ctl.period, await makePdf()), 'application/zip');
    } finally { setBusy(false); }
  }

  const boxes = vatBoxes(d, qKey);
  const filed = vatPeriods.find((v) => v.key === qKey.key);
  const BOXES: [string, Key][] = [['1a', 'm.box1a'], ['1b', 'm.box1b'], ['1e', 'm.box1e'], ['4b', 'm.box4b']];

  return (
    <div>
      <div className="page-head"><h1>{t('m.reports')}</h1>
        <div className="row"><PeriodBar ctl={ctl} /><button className="btn" disabled={busy} onClick={exportPdf}>PDF</button><button className="btn primary" disabled={busy} onClick={exportPack}>{t('m.accountantPack')}</button></div></div>
      <div className="layout-2">
        <Section title={t('m.pnl')}>
          <div className="table-wrap">
            <table className="tbl">
              <tbody>
                <tr><td className="strong">{t('m.revenue')}</td><td style={{ textAlign: 'right' }}><Amount cents={r.revenueEx} strong /></td></tr>
                {Object.entries(r.revenueByType).map(([k, v]) => <tr key={k}><td className="muted">&nbsp;&nbsp;{t(`event.${k}` as Key)}</td><td style={{ textAlign: 'right' }} className="muted"><Amount cents={v} /></td></tr>)}
                {Object.entries(r.costsByCategory).sort((a, b) => b[1].costEx - a[1].costEx).map(([k, v]) => (
                  <tr key={k}><td>{cats.get(k)?.icon} {lang === 'en' ? cats.get(k)?.nameEn : cats.get(k)?.name}{v.deductible !== v.costEx && <span className="tiny muted"> · {t('m.deductible')} {euro(v.deductible, lang)}</span>}</td><td style={{ textAlign: 'right' }}><Amount cents={-v.costEx} /></td></tr>
                ))}
                <tr><td>{t('m.mileage')} ({Math.round(r.km)} km)</td><td style={{ textAlign: 'right' }}><Amount cents={-r.mileage} /></td></tr>
                <tr><td>{t('m.depreciation')}</td><td style={{ textAlign: 'right' }}><Amount cents={-r.depreciation} /></td></tr>
                <tr><td className="strong">{t('m.result')}</td><td style={{ textAlign: 'right' }}><Amount cents={r.result} strong /></td></tr>
                <tr><td className="strong">{t('m.fiscalResult')} <span className="tiny muted">({t('m.indication')})</span></td><td style={{ textAlign: 'right' }}><Amount cents={r.fiscalResult} strong /></td></tr>
                <tr><td className="muted">{t('m.cashResult')}</td><td style={{ textAlign: 'right' }} className="muted"><Amount cents={r.cashResult} /></td></tr>
              </tbody>
            </table>
          </div>
        </Section>
        <div>
          <Section title={t('m.perPartner')}>
            <dl className="kv">
              <dt>Gijs</dt><dd><Amount cents={shares.gijs} strong /> <span className="tiny muted">· {h.gijs} {t('unit.hour')}</span></dd>
              <dt>Coen</dt><dd><Amount cents={shares.coen} strong /> <span className="tiny muted">· {h.coen} {t('unit.hour')}</span></dd>
            </dl>
            <p className="tiny muted" style={{ marginTop: 'var(--s2)' }}>{t(`m.modeNote.${settings.vatMode}`)}</p>
          </Section>
          <Section title={t('m.vat')}>
            {settings.vatMode !== 'vat' ? <p className="small muted">{t(settings.vatMode === 'kor' ? 'm.vatKor' : 'm.vatPrivate')}</p> : (
              <div className="stack">
                <div className="row">
                  <button className="btn small" onClick={() => setQKey(periodOf('quarter', new Date(new Date(qKey.from).setMonth(new Date(qKey.from).getMonth() - 3)).toISOString().slice(0, 10)))}>←</button>
                  <span className="strong">{qKey.key}</span>
                  <button className="btn small" onClick={() => setQKey(periodOf('quarter', new Date(new Date(qKey.from).setMonth(new Date(qKey.from).getMonth() + 3)).toISOString().slice(0, 10)))}>→</button>
                </div>
                <table className="tbl"><tbody>
                  {BOXES.map(([b, k]) => (
                    <tr key={b}><td>{b} · {t(k)}</td><td style={{ textAlign: 'right' }}>{euro(boxes[`${b}_base`] ?? 0, lang)}</td><td style={{ textAlign: 'right' }}>{b === '1e' ? '' : euro(boxes[`${b}_vat`] ?? 0, lang)}</td>
                      <td><button className="btn small ghost" onClick={() => navigator.clipboard?.writeText(String(Math.round((boxes[`${b}_vat`] ?? boxes[`${b}_base`] ?? 0) / 100)))}>{t('common.copy')}</button></td></tr>
                  ))}
                  <tr><td>5a · {t('m.box5a')}</td><td /><td style={{ textAlign: 'right' }}>{euro(boxes['5a'], lang)}</td><td /></tr>
                  <tr><td>5b · {t('m.box5b')}</td><td /><td style={{ textAlign: 'right' }}>{euro(boxes['5b'], lang)}</td><td /></tr>
                  <tr><td className="strong">{boxes.total >= 0 ? t('m.vatToPay') : t('m.vatToReceive')}</td><td /><td style={{ textAlign: 'right' }} className="strong">{euro(Math.abs(boxes.total), lang)}</td><td /></tr>
                </tbody></table>
                {filed?.filedAt ? <p className="small" style={{ color: 'var(--ok)' }}>✓ {t('m.filedOn', { date: fmtDateTime(filed.filedAt, lang) })}</p> : (
                  <button className="btn" onClick={async () => { await save<VatPeriod>('vatPeriods', { key: qKey.key, boxes, filedAt: new Date().toISOString() }); toast(t('common.saved')); }}>{t('m.markFiled')}</button>
                )}
                <p className="tiny muted">{t('m.vatHelp')}</p>
              </div>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
