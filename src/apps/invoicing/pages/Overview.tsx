import { Link } from 'react-router-dom';
import { useI18n } from '../../../core/i18n';
import { useSession } from '../../../core/session';
import { Section } from '../../../core/ui';
import { euro, fmtDate } from '../../../core/format';
import { invoiceState, invoiceTotals, paidAmount, quoteTotals } from '../domain/money';
import { useAllQuotes, useInvoices, usePayments } from '../data';
import { DocPill } from '../components';

const KOR_LIMIT = 2_000_000; // € 20.000 in cents

export default function Overview() {
  const { t, lang } = useI18n();
  const { settings } = useSession();
  const invoices = useInvoices();
  const payments = usePayments();
  const quotes = useAllQuotes();
  const year = String(new Date().getFullYear());
  const rows = invoices.map((i) => ({ i, st: invoiceState(i, payments), tt: invoiceTotals(i), paid: paidAmount(i.id, payments) }));
  const openRows = rows.filter((r) => ['sent', 'partially_paid', 'overdue'].includes(r.st));
  const overdue = rows.filter((r) => r.st === 'overdue');
  const openSum = openRows.reduce((s, r) => s + r.tt.total - r.paid, 0);
  const overdueSum = overdue.reduce((s, r) => s + r.tt.total - r.paid, 0);
  const paidYear = payments.filter((p) => p.date.startsWith(year)).reduce((s, p) => s + p.amount, 0);
  // Turnover = finalised invoices (incl. credit notes) issued this year, excl. VAT.
  const turnover = rows.filter((r) => r.i.status !== 'draft' && (r.i.issueDate ?? '').startsWith(year)).reduce((s, r) => s + r.tt.ex, 0);
  const awaiting = quotes.filter((q) => q.status === 'sent');
  const drafts = [...quotes.filter((q) => q.status === 'draft').map((q) => ({ id: q.id, kind: 'quote' as const, label: `${t('pdf.quote')} ${q.client?.name ?? ''}`, at: q.updatedAt })),
    ...invoices.filter((i) => i.status === 'draft').map((i) => ({ id: i.id, kind: 'invoice' as const, label: `${t(`i.kind.${i.kind}`)} ${i.client.name}`, at: i.updatedAt }))]
    .sort((a, b) => b.at.localeCompare(a.at));
  const profileIncomplete = !settings.address || !settings.city;
  const pct = Math.min(100, Math.round((turnover / KOR_LIMIT) * 100));

  return (
    <div>
      <div className="page-head">
        <div><div className="legend">{t('app.invoicing')}</div><h1>{t('inv.overview')}</h1></div>
        <div className="tagline only-desktop">{t('app.tagline')}</div>
      </div>
      {profileIncomplete && (
        <div className="banner warn" style={{ marginBottom: 'var(--s4)' }}><span>!</span><div className="txt">{t('inv.profileIncomplete')} <Link to="/invoicing/settings">{t('inv.goSettings')}</Link></div></div>
      )}
      <div className="grid4" style={{ marginBottom: 'var(--s4)' }}>
        <div className="stat"><div className="legend">{t('inv.open')}</div><div className="v">{euro(openSum, lang)}</div><div className="tiny muted">{openRows.length}×</div></div>
        <div className="stat"><div className="legend" style={{ color: overdueSum ? 'var(--danger)' : undefined }}>{t('inv.overdue')}</div><div className="v">{euro(overdueSum, lang)}</div><div className="tiny muted">{overdue.length}×</div></div>
        <div className="stat"><div className="legend">{t('inv.paidYear')}</div><div className="v">{euro(paidYear, lang)}</div></div>
        <div className="stat"><div className="legend">{t('inv.turnover')}</div><div className="v">{euro(turnover, lang)}</div></div>
      </div>
      {settings.vatMode !== 'vat' && (
        <Section title={t('s.korTurnover')}>
          <div className="small">{t('inv.korMeter', { used: euro(turnover, lang), limit: euro(KOR_LIMIT, lang) })}</div>
          <div style={{ height: 8, border: 'var(--fq-rule)', marginTop: 'var(--s2)' }} role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div style={{ width: `${pct}%`, height: '100%', background: pct >= 80 ? 'var(--warning)' : 'var(--fq-accent)' }} />
          </div>
          {pct >= 80 && <p className="small" style={{ color: 'var(--warning)', marginTop: 'var(--s2)' }}>{t('inv.korWarn')}</p>}
        </Section>
      )}
      <div className="dash">
        <Section title={t('inv.overdue')}>
          {overdue.length === 0 ? <p className="muted small">—</p> : (
            <div className="list">{overdue.sort((a, b) => (a.i.dueDate ?? '').localeCompare(b.i.dueDate ?? '')).map(({ i, tt, paid }) => (
              <Link key={i.id} className="list-item" to={`/invoicing/invoices/${i.id}`}><div className="grow"><div className="strong">{i.client.name}</div><div className="tiny" style={{ color: 'var(--danger)' }}>{i.number} · {fmtDate(i.dueDate, lang)}</div></div><span className="strong">{euro(tt.total - paid, lang)}</span></Link>
            ))}</div>
          )}
        </Section>
        <Section title={t('inv.awaiting')}>
          {awaiting.length === 0 ? <p className="muted small">—</p> : (
            <div className="list">{awaiting.map((q) => (
              <Link key={q.id} className="list-item" to={`/invoicing/quotes/${q.id}`}><div className="grow"><div className="strong">{q.client?.name}</div><div className="tiny muted">{q.number} · {t('quote.validUntil')} {fmtDate(q.validUntil, lang)}</div></div><span className="small">{euro(quoteTotals(q).total, lang)}</span><DocPill state={q.status} kind="quote" /></Link>
            ))}</div>
          )}
        </Section>
        <Section title={t('inv.drafts')}>
          {drafts.length === 0 ? <p className="muted small">—</p> : (
            <div className="list">{drafts.slice(0, 10).map((x) => <Link key={x.id} className="list-item" to={`/invoicing/${x.kind === 'quote' ? 'quotes' : 'invoices'}/${x.id}`}>{x.label}</Link>)}</div>
          )}
        </Section>
      </div>
    </div>
  );
}
