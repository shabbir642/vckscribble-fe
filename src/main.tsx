import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { startNetReporting } from './lib/netReport';
import { installErrorReporting } from './lib/report';
// Served with the app rather than from Google: no extra connection on the
// first visit, and no visible swap from a fallback font.
import '@fontsource-variable/fredoka';
import '@fontsource-variable/nunito';
import './index.css';

installErrorReporting();
startNetReporting();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
