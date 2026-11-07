import { Route, Routes, useParams } from 'react-router-dom';
import { AppShell, type NavItem } from '../../core/ui/AppShell';
import SetList from './pages/SetList';
import SetEditor from './pages/SetEditor';
import History from './pages/History';
import Live from './pages/Live';

export default function SetsApp() {
  const nav: NavItem[] = [
    { to: '/sets', key: 'app.sets', icon: 'calendar', end: true },
    { to: '/sets/history', key: 'sets.history', icon: 'tasks' },
    { to: '/library', key: 'app.library', icon: 'more' },
    { to: '/requests', key: 'app.requests', icon: 'enquiries' },
  ];
  return (
    <Routes>
      {/* Live view behind the decks: full screen, no app chrome */}
      <Route path=":id/live" element={<KeyedLive />} />
      <Route path="*" element={
        <AppShell title="app.sets" nav={nav} settingsTo="/settings">
          <Routes>
            <Route index element={<SetList />} />
            <Route path="history" element={<History />} />
            <Route path=":id" element={<KeyedEditor />} />
          </Routes>
        </AppShell>
      } />
    </Routes>
  );
}

function KeyedEditor() { const { id } = useParams(); return <SetEditor key={id} />; }
function KeyedLive() { const { id } = useParams(); return <Live key={id} />; }
