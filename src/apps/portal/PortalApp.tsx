import { Route, Routes, useParams } from 'react-router-dom';
import { AppShell, type NavItem } from '../../core/ui/AppShell';
import PortalList from './pages/PortalList';
import GigPortal from './pages/GigPortal';

export default function PortalApp() {
  const nav: NavItem[] = [
    { to: '/portal', key: 'po.nav.pages', icon: 'contacts', end: true },
    { to: '/feedback', key: 'app.feedback', icon: 'enquiries' },
    { to: '/bookings', key: 'nav.bookings', icon: 'calendar' },
  ];
  return (
    <AppShell title="app.portal" nav={nav} settingsTo="/feedback/settings">
      <Routes>
        <Route index element={<PortalList />} />
        <Route path=":gigId" element={<Keyed />} />
      </Routes>
    </AppShell>
  );
}
function Keyed() { const { gigId } = useParams(); return <GigPortal key={gigId} />; }
