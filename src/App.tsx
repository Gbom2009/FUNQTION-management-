import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { SessionProvider, useSession } from './core/session';
import { ToastProvider } from './core/ui';
import Login from './core/Login';
import Hub from './hub/Hub';
import BookingsApp from './apps/bookings/BookingsApp';
import InvoicingApp from './apps/invoicing/InvoicingApp';
import MoneyApp from './apps/money/MoneyApp';
import Settings from './settings/Settings';

function Gate() {
  const { locked } = useSession();
  if (locked) return <Login />;
  return (
    <Routes>
      <Route path="/" element={<Hub />} />
      <Route path="/bookings/*" element={<BookingsApp />} />
      <Route path="/invoicing/*" element={<InvoicingApp />} />
      <Route path="/money/*" element={<MoneyApp />} />
      <Route path="/settings" element={<main className="main" style={{ maxWidth: 1200, margin: '0 auto' }}><Settings /></main>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

// HashRouter: works unchanged on GitHub Pages, from a file inside the
// desktop/iOS shell and on any self-hosted static server.
export default function App() {
  return (
    <HashRouter>
      <SessionProvider>
        <ToastProvider>
          <Gate />
        </ToastProvider>
      </SessionProvider>
    </HashRouter>
  );
}
