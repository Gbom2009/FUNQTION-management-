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
import PromoApp from './apps/promo/PromoApp';
import PressKitApp from './apps/presskit/PressKitApp';
import FeedbackApp from './apps/feedback/FeedbackApp';
import Settings from './settings/Settings';

// Maps (MapLibre, voice, routing) is big: it loads only when you open it.
const MapsApp = lazy(() => import('./apps/maps/MapsApp'));
// Public pages for clients and guests: no login, own small chunk.
const FeedbackPage = lazy(() => import('./public/FeedbackPage'));

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
      <Route path="/promo/*" element={<PromoApp />} />
      <Route path="/presskit/*" element={<PressKitApp />} />
      <Route path="/feedback/*" element={<FeedbackApp />} />
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
      <Routes>
        <Route path="/f/:data" element={<Suspense fallback={null}><FeedbackPage /></Suspense>} />
        <Route path="*" element={
          <SessionProvider>
            <ToastProvider>
              <Gate />
            </ToastProvider>
          </SessionProvider>
        } />
      </Routes>
    </HashRouter>
  );
}
