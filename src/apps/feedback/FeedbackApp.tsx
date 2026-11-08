import { Route, Routes } from 'react-router-dom';
import { AppShell, type NavItem } from '../../core/ui/AppShell';
import { useSession } from '../../core/session';
import { useReviews } from './data';
import { reminderDue, waiting } from './domain/feedback';
import Requests from './pages/Requests';
import Reviews from './pages/Reviews';
import Insights from './pages/Insights';
import FeedbackSettings from './pages/FeedbackSettings';

export default function FeedbackApp() {
  const { settings } = useSession();
  const reviews = useReviews();
  const due = reviews.filter((r) => reminderDue(r, new Date(), settings.feedbackReminderDays ?? 5)).length;
  const nav: NavItem[] = [
    { to: '/feedback', key: 'fb.nav.requests', icon: 'enquiries', end: true, badge: due || reviews.filter(waiting).length ? due : undefined },
    { to: '/feedback/reviews', key: 'fb.nav.reviews', icon: 'tasks' },
    { to: '/feedback/insights', key: 'fb.nav.insights', icon: 'pipeline' },
    { to: '/presskit', key: 'app.presskit', icon: 'nav' },
  ];
  return (
    <AppShell title="app.feedback" nav={nav} settingsTo="/feedback/settings">
      <Routes>
        <Route index element={<Requests />} />
        <Route path="reviews" element={<Reviews />} />
        <Route path="insights" element={<Insights />} />
        <Route path="settings" element={<FeedbackSettings />} />
      </Routes>
    </AppShell>
  );
}
