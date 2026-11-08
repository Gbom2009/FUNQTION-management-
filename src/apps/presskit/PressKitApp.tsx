import { useEffect } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AppShell, type NavItem } from '../../core/ui/AppShell';
import { ensureEpk, useEpk } from './data';
import Editor from './pages/Editor';
import Preview from './pages/Preview';
import Publish from './pages/Publish';

export default function PressKitApp() {
  const epk = useEpk();
  useEffect(() => { ensureEpk(); }, []);
  const nav: NavItem[] = [
    { to: '/presskit', key: 'pk.nav.edit', icon: 'tasks', end: true },
    { to: '/presskit/preview', key: 'pk.nav.preview', icon: 'today' },
    { to: '/presskit/publish', key: 'pk.nav.publish', icon: 'nav' },
    { to: '/promo/media', key: 'pr.nav.media', icon: 'hub' },
  ];
  return (
    <AppShell title="app.presskit" nav={nav} settingsTo="/presskit">
      {epk ? (
        <Routes>
          <Route index element={<Editor epk={epk} />} />
          <Route path="preview" element={<Preview />} />
          <Route path="publish" element={<Publish epk={epk} />} />
        </Routes>
      ) : <p className="muted">…</p>}
    </AppShell>
  );
}
