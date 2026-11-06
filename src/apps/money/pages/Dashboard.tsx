import { Link } from 'react-router-dom';
import { useI18n } from '../../../core/i18n';
import { useSession } from '../../../core/session';
import { Section } from '../../../core/ui';
import { euro } from '../../../core/format';
import { todayStr, toDateStr } from '../../../core/dates';
import { invoiceState, invoiceTotals, paidAmount } from '../../invoicing/domain/money';
import { partnerBalances, periodOf, pnl, tripSuggestions, vatBoxes } from '../domain/ledger';
import { useBankLines, useLedger } from '../data';
import { Amount, InOutChart, PeriodBar, Stat, usePeriod } from '../components';

export default function Dashboard() {
  const { t, lang } = useI18n();
  const { settings, memberName } = useSession();
  const d = useLedger();
  const lines = useBankLines();
  const ctl = usePeriod('month');
  if (!d) return null;
  const r = pnl(d, ctl.period);
  const today = todayStr();
  const year = periodOf('year', today);
  const ytd = pnl(d, { ...year, to: today });
  const quarter = periodOf('quarter', today);
  const vat = settings.vatMode === 'vat' ? vatBoxes(d, quarter).total : 0;
  const bal = partnerBalances(d, today);
  const openInv = d.invoices.filter((i) => !i.deletedAt).map((i) => ({ i, st: invoiceState(i, d.payments) })).filter((x) => ['sent', 'partially_paid', 'overdue'].includes(x.st));
  const openSum = openInv.reduce((s, x) => s + invoiceTotals(x.i).total - paidAmount(x.i.id, d.payments), 0);
  const overdue = openInv.filter((x) => x.st === 'overdue').length;
  const unmatched = lines.filter((l) => l.status === 'unmatched').length;
  const missing = d.expenses.filter((e) => e.status === 'missing_receipt').length;
  const tripTodo = tripSuggestions(d.gigs, d.trips).length;
  const taxBase = Math.max(0, ytd.fiscalResult);
  const taxAside = Math.round((taxBase * settings.taxSetAsidePct) / 100);
  const backupDays = settings.lastBackupAt ? Math.floor((Date.now() - new Date(settings.lastBackupAt).getTime()) / 86_400_000) : null;

  const months = Array.from({ length: 6 }, (_, i) => {
    const dt = new Date(); dt.setDate(1); dt.setMonth(dt.getMonth() - (5 - i));
    const p = periodOf('month', toDateStr(dt));
    const x = pnl(d, p);
    return { label: new Intl.DateTimeFormat(lang === 'nl' ? 'nl-NL' : 'en-GB', { month: 'short' }).format(dt), in: x.cashIn, out: x.cashOut + x.mileage };
  });

  return (
    <div>
      <div className="page-head">
        <div><div className="legend">{t('app.accounting')}</div><h1>{t('m.dashboard')}</h1></div>
        <PeriodBar ctl={ctl} />
      </div>
      {(backupDays == null || backupDays > 14) && (
        <div className="banner warn" style={{ marginBottom: 'var(--s4)' }}><span>!</span><div className="txt">{backupDays == null ? t('backup.never') : t('m.backupOld', { days: backupDays })} <Link to="/money/settings">{t('settings.export')}</Link></div></div>
      )}
      <div className="grid4" style={{ marginBottom: 'var(--s4)' }}>
        <Stat label={t('m.in')} cents={r.cashIn} note={`${t('m.invoiced')} ${euro(r.revenueEx, lang)}`} />
        <Stat label={t('m.out')} cents={r.cashOut + r.mileage} note={`${t('m.mileage')} ${euro(r.mileage, lang)}`} />
        <Stat label={t('m.result')} cents={r.result} note={t('m.resultNote')} tone={r.result < 0 ? 'danger' : undefined} />
        <Stat label={t('m.open')} cents={openSum} note={overdue ? t('m.overdueCount', { n: overdue }) : `${openInv.length}×`} tone={overdue ? 'danger' : undefined} />
      </div>
      <div className="grid2" style={{ marginBottom: 'var(--s4)' }}>
        <Stat label={`${t('m.vatAside')} · ${quarter.key}`} cents={vat} note={settings.vatMode === 'vat' ? t('m.vatAsideNote') : t('m.noVat')} />
        <Stat label={t('m.taxAside')} cents={taxAside} dashed note={t('m.taxAsideNote', { pct: settings.taxSetAsidePct, base: euro(taxBase, lang) })} />
      </div>
      <div className="dash">
        <Section title={t('m.partners')} actions={<Link className="btn small ghost" to="/money/partners">→</Link>}>
          {bal.payout ? <p className="strong">{t('m.payoutLine', { gijs: euro(bal.payout.gijs, lang), coen: euro(bal.payout.coen, lang) })}</p>
            : bal.settle ? <p className="strong">{t('m.settleLine', { from: memberName(bal.settle.from), to: memberName(bal.settle.to), amount: euro(bal.settle.amount, lang) })}</p> : <p className="muted small">{t('m.settled')}</p>}
          <dl className="kv">
            <dt>Gijs</dt><dd><Amount cents={bal.partners.gijs.balance} /></dd>
            <dt>Coen</dt><dd><Amount cents={bal.partners.coen.balance} /></dd>
            <dt>{t('m.payer.business')}</dt><dd><Amount cents={bal.businessCash} /></dd>
          </dl>
        </Section>
        <Section title={t('m.todo')}>
          <div className="list">
            <Link className="list-item" to="/money/bank"><span className="grow">{t('m.todoBank')}</span><span className="strong" style={{ color: unmatched ? 'var(--fq-accent)' : undefined }}>{unmatched}</span></Link>
            <Link className="list-item" to="/money/expenses?missing=1"><span className="grow">{t('m.todoReceipts')}</span><span className="strong" style={{ color: missing ? 'var(--fq-accent)' : undefined }}>{missing}</span></Link>
            <Link className="list-item" to="/money/trips"><span className="grow">{t('m.todoTrips')}</span><span className="strong" style={{ color: tripTodo ? 'var(--fq-accent)' : undefined }}>{tripTodo}</span></Link>
          </div>
        </Section>
        <Section title={t('m.last6')}>
          <InOutChart rows={months} />
          <div className="row tiny muted"><span style={{ color: 'var(--ok)' }}>■</span> {t('m.in')} <span>■</span> {t('m.out')}</div>
        </Section>
        <Section title={`${t('m.ytd')} ${year.key}`}>
          <dl className="kv">
            <dt>{t('m.revenue')}</dt><dd><Amount cents={ytd.revenueEx} /></dd>
            <dt>{t('m.costs')}</dt><dd><Amount cents={-ytd.costsEx} /></dd>
            <dt>{t('m.mileage')} ({Math.round(ytd.km)} km)</dt><dd><Amount cents={-ytd.mileage} /></dd>
            <dt>{t('m.depreciation')}</dt><dd><Amount cents={-ytd.depreciation} /></dd>
            <dt className="strong">{t('m.result')}</dt><dd><Amount cents={ytd.result} strong /></dd>
          </dl>
          <Link className="btn small" style={{ marginTop: 'var(--s3)' }} to="/money/reports">{t('m.reports')} →</Link>
        </Section>
      </div>
    </div>
  );
}
