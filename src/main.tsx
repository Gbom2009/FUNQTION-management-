import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/jetbrains-mono/300.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/archivo-black/400.css';
import './styles/tokens.css';
import './styles/app.css';
import App from './App';

// Offline support for the web/PWA build. Inside the desktop shell the app is
// served from disk, so no service worker is needed there.
if (!('__TAURI_INTERNALS__' in window)) {
  import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true })).catch(() => undefined);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
