import { lazy, Suspense } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { SessionProvider, useSession } from './core/session';
import { ToastProvider } from './core/ui';
import Login from './core/Login';
import Hub from './hub/Hub';
import BookingsApp from './apps/bookings/BookingsApp';
import InvoicingApp from './apps/invoicing/InvoicingApp';
import MoneyApp from './apps/money/MoneyApp';
import ContractsApp from './apps/contracts/ContractsApp';
import SignHere from './apps/contracts/pages/SignHere';
import GearApp from './apps/gear/GearApp';
import GigDayApp from './apps/gigday/GigDayApp';
import Settings from './settings/Settings';

// Maps (MapLibre, voice, routing) is big: it loads only when you open it.
const MapsApp = lazy(() => import('./apps/maps/MapsApp'));
// Music apps (7–9): loaded on first use.
const LibraryApp = lazy(() => import('./apps/library/LibraryApp'));
const SetsApp = lazy(() => import('./apps/sets/SetsApp'));
const RequestsApp = lazy(() => import('./apps/requests/RequestsApp'));
const wait = <main className="main"><p className="muted">…</p></main>;

function Gate() {
  const { locked } = useSession();
  if (locked) return <Login />;
  return (
    <Routes>
      <Route path="/" element={<Hub />} />
      <Route path="/bookings/*" element={<BookingsApp />} />
      <Route path="/invoicing/*" element={<InvoicingApp />} />
      <Route path="/money/*" element={<MoneyApp />} />
      <Route path="/contracts/:id/sign" element={<SignHere />} />
      <Route path="/contracts/*" element={<ContractsApp />} />
      <Route path="/gear/*" element={<GearApp />} />
      <Route path="/gigday/*" element={<GigDayApp />} />
      <Route path="/library/*" element={<Suspense fallback={wait}><LibraryApp /></Suspense>} />
      <Route path="/sets/*" element={<Suspense fallback={wait}><SetsApp /></Suspense>} />
      <Route path="/requests/*" element={<Suspense fallback={wait}><RequestsApp /></Suspense>} />
      <Route path="/maps/*" element={<Suspense fallback={<main className="main"><p className="muted">…</p></main>}><MapsApp /></Suspense>} />
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
