import { Route, Routes } from 'react-router-dom';
import { useI18n } from '../../core/i18n';
import { AppShell, type NavItem } from '../../core/ui/AppShell';
import { GigLayout } from './components';
import GigList from './pages/GigList';
import Today from './pages/Today';
import Prep from './pages/Prep';
import TimelinePage from './pages/Timeline';
import VenueCard from './pages/VenueCard';
import Music from './pages/Music';
import Log from './pages/Log';
import WrapUp from './pages/WrapUp';
import Booth from './pages/Booth';
import GigDaySettings from './pages/GigDaySettings';

export default function GigDayApp() {
  const { t } = useI18n();
  const nav: NavItem[] = [
    { to: '/gigday', key: 'gd.nav.gigs', icon: 'today', end: true },
    { to: '/bookings/calendar', key: 'nav.calendar', icon: 'calendar' },
    { to: '/maps', key: 'app.navigation', icon: 'nav' },
    { to: '/gear', key: 'app.gear', icon: 'scan' },
  ];
  return (
    <Routes>
      {/* Booth mode: full screen, no app chrome */}
      <Route path=":gigId/booth" element={<GigLayout bare />}>
        <Route index element={<Booth />} />
      </Route>
      <Route path="*" element={
        <AppShell title="app.gigday" nav={nav} settingsTo="/gigday/settings" topLinks={[{ to: '/gigday', label: t('gd.nav.gigs') }]}>
          <Routes>
            <Route index element={<GigList />} />
            <Route path="settings" element={<GigDaySettings />} />
            <Route path=":gigId" element={<GigLayout />}>
              <Route index element={<Today />} />
              <Route path="prep" element={<Prep />} />
              <Route path="timeline" element={<TimelinePage />} />
              <Route path="venue" element={<VenueCard />} />
              <Route path="music" element={<Music />} />
              <Route path="log" element={<Log />} />
              <Route path="wrapup" element={<WrapUp />} />
            </Route>
          </Routes>
        </AppShell>
      } />
    </Routes>
  );
}
