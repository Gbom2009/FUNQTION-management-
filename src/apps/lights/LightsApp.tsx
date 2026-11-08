import { Route, Routes } from 'react-router-dom';
import { AppShell, type NavItem } from '../../core/ui/AppShell';
import Live from './pages/Live';
import Cues from './pages/Cues';
import Patch from './pages/Patch';
import ShowLog from './pages/ShowLog';
import LightsSettings from './pages/LightsSettings';

export default function LightsApp() {
  const nav: NavItem[] = [
    { to: '/lights', key: 'lt.nav.live', icon: 'today', end: true },
    { to: '/lights/cues', key: 'lt.nav.cues', icon: 'tasks' },
    { to: '/lights/patch', key: 'lt.nav.patch', icon: 'hub' },
    { to: '/lights/log', key: 'lt.nav.log', icon: 'pipeline' },
  ];
  return (
    <Routes>
      {/* Stage mode: full screen, no app chrome */}
      <Route path="stage" element={<Live stage />} />
      <Route path="*" element={
        <AppShell title="app.lights" nav={nav} settingsTo="/lights/settings">
          <Routes>
            <Route index element={<Live />} />
            <Route path="cues" element={<Cues />} />
            <Route path="patch" element={<Patch />} />
            <Route path="log" element={<ShowLog />} />
            <Route path="settings" element={<LightsSettings />} />
          </Routes>
        </AppShell>
      } />
    </Routes>
  );
}
