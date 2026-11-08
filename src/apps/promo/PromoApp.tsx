import { Route, Routes, useParams } from 'react-router-dom';
import { useI18n } from '../../core/i18n';
import { AppShell, type NavItem } from '../../core/ui/AppShell';
import { postState } from './domain/promo';
import { usePosts } from './data';
import Calendar from './pages/Calendar';
import PostEditor from './pages/PostEditor';
import MediaLibrary from './pages/MediaLibrary';
import Consents from './pages/Consents';
import Stats from './pages/Stats';
import PromoSettings from './pages/PromoSettings';
import Due from './pages/Due';

export default function PromoApp() {
  const { t } = useI18n();
  const due = usePosts().filter((p) => postState(p) === 'due').length;
  const nav: NavItem[] = [
    { to: '/promo', key: 'pr.nav.calendar', icon: 'calendar', end: true },
    { to: '/promo/due', key: 'pr.nav.due', icon: 'warn', badge: due },
    { to: '/promo/media', key: 'pr.nav.media', icon: 'hub' },
    { to: '/promo/consents', key: 'pr.nav.consents', icon: 'tasks' },
    { to: '/promo/stats', key: 'pr.nav.stats', icon: 'pipeline' },
  ];
  return (
    <AppShell title="app.promo" nav={nav} primary={{ to: '/promo/posts/new', label: t('pr.newPost') }} settingsTo="/promo/settings"
      topLinks={due ? [{ to: '/promo/due', label: t('pr.nav.due'), badge: due }] : []}>
      <Routes>
        <Route index element={<Calendar />} />
        <Route path="due" element={<Due />} />
        <Route path="posts/:id" element={<Keyed />} />
        <Route path="media" element={<MediaLibrary />} />
        <Route path="consents" element={<Consents />} />
        <Route path="stats" element={<Stats />} />
        <Route path="settings" element={<PromoSettings />} />
      </Routes>
    </AppShell>
  );
}

function Keyed() {
  const { id } = useParams();
  return <PostEditor key={id} />;
}
