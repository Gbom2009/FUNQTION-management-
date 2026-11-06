import { Route, Routes, useParams } from 'react-router-dom';
import { useI18n } from '../../core/i18n';
import { AppShell, type NavItem } from '../../core/ui/AppShell';
import Overview from './pages/Overview';
import { QuoteEditor, QuoteList } from './pages/Quotes';
import { InvoiceDetail, InvoiceList } from './pages/Invoices';
import Catalog from './pages/Catalog';
import InvSettings from './pages/InvSettings';
import { invoiceState } from './domain/money';
import { useInvoices, usePayments } from './data';

export default function InvoicingApp() {
  const { t } = useI18n();
  const payments = usePayments();
  const overdue = useInvoices().filter((i) => invoiceState(i, payments) === 'overdue').length;
  const nav: NavItem[] = [
    { to: '/invoicing', key: 'inv.overview', icon: 'today', end: true },
    { to: '/invoicing/quotes', key: 'inv.quotes', icon: 'enquiries' },
    { to: '/invoicing/invoices', key: 'inv.invoices', icon: 'pipeline', badge: overdue },
    { to: '/invoicing/catalog', key: 'inv.catalog', icon: 'tasks' },
    { to: '/bookings', key: 'nav.bookings', icon: 'calendar' },
  ];
  return (
    <AppShell title="app.invoicing" nav={nav} primary={{ to: '/invoicing/quotes', label: t('inv.newQuote') }} settingsTo="/invoicing/settings">
      <Routes>
        <Route index element={<Overview />} />
        <Route path="quotes" element={<QuoteList />} />
        <Route path="quotes/:id" element={<Keyed el="quote" />} />
        <Route path="invoices" element={<InvoiceList />} />
        <Route path="invoices/:id" element={<Keyed el="invoice" />} />
        <Route path="catalog" element={<Catalog />} />
        <Route path="settings" element={<InvSettings />} />
      </Routes>
    </AppShell>
  );
}

function Keyed({ el }: { el: 'quote' | 'invoice' }) {
  const { id } = useParams();
  return el === 'quote' ? <QuoteEditor key={id} /> : <InvoiceDetail key={id} />;
}
