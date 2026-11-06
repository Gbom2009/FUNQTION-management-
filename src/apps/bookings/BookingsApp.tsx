import { NavLink, Route, Routes, Link, useParams } from 'react-router-dom';
import { useI18n, type Key } from '../../core/i18n';
import { useSession } from '../../core/session';
import { Icon, Logo } from '../../core/ui';
import Today from './pages/Today';
import Pipeline from './pages/Pipeline';
import Calendar from './pages/Calendar';
import Tasks from './pages/Tasks';
import GigPage from './pages/GigPage';
import { EnquiryEditor, EnquiryList } from './pages/Enquiries';
import { ContactDetail, ContactList } from './pages/Contacts';
import Settings from '../../settings/Settings';
import { useEnquiries, useTasks } from './data';

const NAV: { to: string; key: Key; icon: string; end?: boolean }[] = [
  { to: '/bookings', key: 'nav.today', icon: 'today', end: true },
  { to: '/bookings/enquiries', key: 'nav.enquiries', icon: 'enquiries' },
  { to: '/bookings/pipeline', key: 'nav.pipeline', icon: 'pipeline' },
  { to: '/bookings/calendar', key: 'nav.calendar', icon: 'calendar' },
  { to: '/bookings/contacts', key: 'nav.contacts', icon: 'contacts' },
  { to: '/bookings/tasks', key: 'nav.tasks', icon: 'tasks' },
];
const MOBILE = ['nav.today', 'nav.pipeline', 'nav.calendar', 'nav.contacts', 'nav.tasks'];

function Badge({ n }: { n: number }) {
  return n > 0 ? <span className="tiny" style={{ marginLeft: 'auto', color: 'var(--fq-accent)' }}>{n}</span> : null;
}

export default function BookingsApp() {
  const { t } = useI18n();
  const { me, logout } = useSession();
  const newEnq = useEnquiries().filter((e) => e.status === 'new').length;
  const due = useTasks().filter((x) => x.status === 'open' && (x.assignedTo === me?.id || x.assignedTo === 'both') && new Date(x.snoozedUntil ?? x.dueAt) <= new Date()).length;
  const badge = (k: Key) => (k === 'nav.enquiries' ? newEnq : k === 'nav.tasks' ? due : 0);
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <Link to="/" className="row" style={{ textDecoration: 'none', gap: 'var(--s3)' }}>
            <Logo size={36} />
            <div><div className="strong small" style={{ textTransform: 'uppercase' }}>{t('app.bookings')}</div><div className="tiny" style={{ color: 'var(--fq-accent)', letterSpacing: '0.2em' }}>{t('app.tagline')}</div></div>
          </Link>
        </div>
        <nav aria-label="Bookings">
          {NAV.map((n) => <NavLink key={n.to} to={n.to} end={n.end}><Icon name={n.icon} /> {t(n.key)} <Badge n={badge(n.key)} /></NavLink>)}
          <Link to="/bookings/enquiries/new" className="btn primary" style={{ margin: 'var(--s4) var(--s5)', color: 'var(--fq-on-accent)' }}>+ {t('enq.new')}</Link>
        </nav>
        <div className="foot stack" style={{ gap: 'var(--s2)' }}>
          <NavLink to="/bookings/settings" className="row" style={{ textDecoration: 'none' }}><Icon name="settings" size={16} /> {t('nav.settings')}</NavLink>
          <Link to="/" className="row" style={{ textDecoration: 'none' }}><Icon name="hub" size={16} /> {t('nav.hub')}</Link>
          <button className="btn small ghost" style={{ justifyContent: 'flex-start', paddingLeft: 0 }} onClick={logout}><span className={`member ${me?.id}`}>{me?.name[0]}</span> {t('login.switch')}</button>
        </div>
      </aside>

      <main className="main">
        <div className="mobile-top">
          <Link to="/" className="row" style={{ textDecoration: 'none' }} aria-label={t('nav.hub')}><Logo size={30} /><span className="tiny" style={{ color: 'var(--fq-accent)', letterSpacing: '0.2em' }}>{t('app.tagline')}</span></Link>
          <div className="row">
            <Link className="btn small ghost" to="/bookings/enquiries">{t('nav.enquiries')}{newEnq > 0 && <span style={{ color: 'var(--fq-accent)' }}> {newEnq}</span>}</Link>
            <Link className="btn icon small ghost" to="/bookings/settings" aria-label={t('nav.settings')}><Icon name="settings" /></Link>
          </div>
        </div>
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
      </main>

      <nav className="bottom-nav" aria-label="Bookings">
        {NAV.filter((n) => MOBILE.includes(n.key)).map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end}><Icon name={n.icon} /><span>{t(n.key)}{badge(n.key) > 0 ? ` ·${badge(n.key)}` : ''}</span></NavLink>
        ))}
      </nav>
      <Link to="/bookings/enquiries/new" className="fab" aria-label={t('enq.new')}>+</Link>
    </div>
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
