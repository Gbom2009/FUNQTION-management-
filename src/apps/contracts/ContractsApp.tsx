import { Route, Routes, useParams } from 'react-router-dom';
import { useI18n } from '../../core/i18n';
import { AppShell, type NavItem } from '../../core/ui/AppShell';
import Overview from './pages/Overview';
import ContractPage from './pages/ContractPage';
import Library from './pages/Library';
import CtSettings from './pages/CtSettings';
import { useContracts } from './data';

export default function ContractsApp() {
  const { t } = useI18n();
  const open = useContracts().filter((c) => c.status === 'draft' || c.status === 'sent' || c.pendingAddendum).length;
  const nav: NavItem[] = [
    { to: '/contracts', key: 'ct.overview', icon: 'today', end: true, badge: open },
    { to: '/contracts/library', key: 'ct.library', icon: 'tasks' },
    { to: '/invoicing/quotes', key: 'inv.quotes', icon: 'enquiries' },
    { to: '/bookings', key: 'nav.bookings', icon: 'calendar' },
  ];
  return (
    <AppShell title="app.contracts" nav={nav} primary={{ to: '/contracts?new=1', label: t('ct.new') }} settingsTo="/contracts/settings">
      <Routes>
        <Route index element={<Overview />} />
        <Route path="library" element={<Library />} />
        <Route path="settings" element={<CtSettings />} />
        <Route path=":id" element={<Keyed />} />
      </Routes>
    </AppShell>
  );
}

function Keyed() {
  const { id } = useParams();
  return <ContractPage key={id} />;
}
