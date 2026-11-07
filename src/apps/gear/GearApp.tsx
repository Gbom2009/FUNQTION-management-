import { Route, Routes, useParams } from 'react-router-dom';
import { useI18n } from '../../core/i18n';
import { AppShell, type NavItem } from '../../core/ui/AppShell';
import GearHome from './pages/Home';
import Scan from './pages/Scan';
import { ItemList, ItemPage } from './pages/Items';
import PackPage from './pages/PackPage';
import Kits from './pages/Kits';
import Care from './pages/Care';
import { GearSettings, Insurance, Labels, More, Rentals, Wishlist } from './pages/More';
import { useGearItems, useIssues } from './data';

export default function GearApp() {
  const { t } = useI18n();
  const broken = useGearItems().filter((i) => i.status === 'missing').length;
  const issues = useIssues().filter((i) => i.status === 'open').length;
  const nav: NavItem[] = [
    { to: '/gear', key: 'g.overview', icon: 'today', end: true, badge: broken },
    { to: '/gear/scan', key: 'g.scan', icon: 'scan' },
    { to: '/gear/items', key: 'g.items', icon: 'tasks' },
    { to: '/gear/care', key: 'g.care', icon: 'settings', badge: issues },
    { to: '/gear/more', key: 'g.more', icon: 'more' },
    { to: '/bookings', key: 'nav.bookings', icon: 'calendar', mobile: false },
  ];
  return (
    <AppShell title="app.gear" nav={nav} primary={{ to: '/gear/items/new', label: t('g.newItem') }} settingsTo="/gear/settings">
      <Routes>
        <Route index element={<GearHome />} />
        <Route path="scan" element={<Scan />} />
        <Route path="items" element={<ItemList />} />
        <Route path="items/:id" element={<Keyed el="item" />} />
        <Route path="gigs/:gigId" element={<Keyed el="pack" />} />
        <Route path="kits" element={<Kits />} />
        <Route path="care" element={<Care />} />
        <Route path="rentals" element={<Rentals />} />
        <Route path="insurance" element={<Insurance />} />
        <Route path="labels" element={<Labels />} />
        <Route path="wishlist" element={<Wishlist />} />
        <Route path="more" element={<More />} />
        <Route path="settings" element={<GearSettings />} />
      </Routes>
    </AppShell>
  );
}

function Keyed({ el }: { el: 'item' | 'pack' }) {
  const { id, gigId } = useParams();
  return el === 'item' ? <ItemPage key={id} /> : <PackPage key={gigId} />;
}
