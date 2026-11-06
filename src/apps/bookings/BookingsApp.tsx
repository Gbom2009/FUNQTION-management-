import { Route, Routes, useParams } from 'react-router-dom';
import { useI18n } from '../../core/i18n';
import { useSession } from '../../core/session';
import { AppShell, type NavItem } from '../../core/ui/AppShell';
import Today from './pages/Today';
import Pipeline from './pages/Pipeline';
import Calendar from './pages/Calendar';
import Tasks from './pages/Tasks';
import GigPage from './pages/GigPage';
import { EnquiryEditor, EnquiryList } from './pages/Enquiries';
import { ContactDetail, ContactList } from './pages/Contacts';
import Settings from '../../settings/Settings';
import { useEnquiries, useTasks } from './data';

export default function BookingsApp() {
  const { t } = useI18n();
  const { me } = useSession();
  const newEnq = useEnquiries().filter((e) => e.status === 'new').length;
  const due = useTasks().filter((x) => x.status === 'open' && (x.assignedTo === me?.id || x.assignedTo === 'both') && new Date(x.snoozedUntil ?? x.dueAt) <= new Date()).length;
  const nav: NavItem[] = [
    { to: '/bookings', key: 'nav.today', icon: 'today', end: true },
    { to: '/bookings/enquiries', key: 'nav.enquiries', icon: 'enquiries', badge: newEnq, mobile: false },
    { to: '/bookings/pipeline', key: 'nav.pipeline', icon: 'pipeline' },
    { to: '/bookings/calendar', key: 'nav.calendar', icon: 'calendar' },
    { to: '/bookings/contacts', key: 'nav.contacts', icon: 'contacts' },
    { to: '/bookings/tasks', key: 'nav.tasks', icon: 'tasks', badge: due },
  ];
  return (
    <AppShell title="app.bookings" nav={nav} primary={{ to: '/bookings/enquiries/new', label: t('enq.new') }} settingsTo="/bookings/settings"
      topLinks={[{ to: '/bookings/enquiries', label: t('nav.enquiries'), badge: newEnq }]}>
      <Routes>
        <Route index element={<Today />} />
        <Route path="enquiries" element={<EnquiryList />} />
        <Route path="enquiries/:id" element={<EnquiryKeyed />} />
        <Route path="pipeline" element={<Pipeline />} />
        <Route path="gigs/:id" element={<GigPageKeyed />} />
        <Route path="calendar" element={<Calendar />} />
        <Route path="contacts" element={<ContactList />} />
        <Route path="contacts/person/:id" element={<ContactDetail kind="person" />} />
        <Route path="contacts/org/:id" element={<ContactDetail kind="org" />} />
        <Route path="contacts/venue/:id" element={<ContactDetail kind="venue" />} />
        <Route path="tasks" element={<Tasks />} />
        <Route path="settings" element={<Settings />} />
      </Routes>
    </AppShell>
  );
}

// Re-mount editors when navigating between records so drafts never leak.
function GigPageKeyed() {
  const { id } = useParams();
  return <GigPage key={id} />;
}
function EnquiryKeyed() {
  const { id } = useParams();
  return <EnquiryEditor key={id} />;
}
