import { Route, Routes, useParams } from 'react-router-dom';
import { useI18n } from '../../core/i18n';
import { AppShell, type NavItem } from '../../core/ui/AppShell';
import Dashboard from './pages/Dashboard';
import { ExpenseEditor, ExpenseList } from './pages/Expenses';
import Bank from './pages/Bank';
import Trips from './pages/Trips';
import Reports from './pages/Reports';
import MoneySettings from './pages/MoneySettings';
import { Assets, GigProfits, Hours, MoreMenu, Partners } from './pages/More';
import { useBankLines } from './data';

export default function MoneyApp() {
  const { t } = useI18n();
  const unmatched = useBankLines().filter((l) => l.status === 'unmatched').length;
  const nav: NavItem[] = [
    { to: '/money', key: 'm.dashboard', icon: 'today', end: true },
    { to: '/money/expenses', key: 'm.expenses', icon: 'tasks' },
    { to: '/money/bank', key: 'm.bank', icon: 'pipeline', badge: unmatched },
    { to: '/money/trips', key: 'm.trips', icon: 'nav' },
    { to: '/money/more', key: 'nav.more', icon: 'more' },
    { to: '/money/gigs', key: 'm.perGig', icon: 'calendar', mobile: false },
    { to: '/money/partners', key: 'm.partners', icon: 'contacts', mobile: false },
    { to: '/money/reports', key: 'm.reports', icon: 'enquiries', mobile: false },
    { to: '/money/assets', key: 'm.assets', icon: 'hub', mobile: false },
    { to: '/money/hours', key: 'm.hours', icon: 'today', mobile: false },
  ];
  return (
    <AppShell title="app.accounting" nav={nav} primary={{ to: '/money/expenses/new', label: t('m.receipt') }} settingsTo="/money/settings">
      <Routes>
        <Route index element={<Dashboard />} />
        <Route path="expenses" element={<ExpenseList />} />
        <Route path="expenses/:id" element={<ExpenseKeyed />} />
        <Route path="bank" element={<Bank />} />
        <Route path="trips" element={<Trips />} />
        <Route path="gigs" element={<GigProfits />} />
        <Route path="partners" element={<Partners />} />
        <Route path="reports" element={<Reports />} />
        <Route path="assets" element={<Assets />} />
        <Route path="hours" element={<Hours />} />
        <Route path="more" element={<MoreMenu />} />
        <Route path="settings" element={<MoneySettings />} />
      </Routes>
    </AppShell>
  );
}

function ExpenseKeyed() {
  const { id } = useParams();
  return <ExpenseEditor key={id} />;
}
