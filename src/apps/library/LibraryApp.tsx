import { Route, Routes } from 'react-router-dom';
import { AppShell, type NavItem } from '../../core/ui/AppShell';
import { useTracks } from './data';
import Collection from './pages/Collection';
import Locations from './pages/Locations';
import Problems from './pages/Problems';
import Export from './pages/Export';

export default function LibraryApp() {
  const inbox = useTracks().filter((t) => t.status === 'inbox').length;
  const nav: NavItem[] = [
    { to: '/library', key: 'lib.collection', icon: 'tasks', end: true },
    { to: '/library/inbox', key: 'lib.inbox', icon: 'enquiries', badge: inbox },
    { to: '/library/problems', key: 'lib.problems', icon: 'warn' },
    { to: '/library/locations', key: 'lib.locations', icon: 'nav' },
    { to: '/library/export', key: 'lib.export', icon: 'more' },
    { to: '/sets', key: 'app.sets', icon: 'calendar', mobile: false },
  ];
  return (
    <AppShell title="app.library" nav={nav} settingsTo="/settings">
      <Routes>
        <Route index element={<Collection />} />
        <Route path="inbox" element={<Collection statusOnly="inbox" key="inbox" />} />
        <Route path="problems" element={<Problems />} />
        <Route path="locations" element={<Locations />} />
        <Route path="export" element={<Export />} />
      </Routes>
    </AppShell>
  );
}
