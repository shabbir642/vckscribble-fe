import { socket } from './socket';

type Source = 'render' | 'window' | 'promise' | 'socket';

interface Report {
  source: Source;
  message: string;
  detail?: string;
  url?: string;
}

const SERVER =
  import.meta.env['VITE_SERVER_URL'] ?? `http://${window.location.hostname}:3001`;

/** Identical messages repeat endlessly in a render loop; report each once. */
const seen = new Set<string>();
const MAX_DISTINCT = 20;

/**
 * Send a client-side failure to the server.
 *
 * Prefers the socket, which already carries the player's identity. Falls back
 * to the HTTP beacon when the socket is down — which is precisely when it
 * matters most, because a connection that never establishes is invisible to the
 * server otherwise. A CORS misconfiguration once took the game down completely
 * while the backend logs stayed clean.
 */
export function report(r: Report): void {
  try {
    const key = `${r.source}:${r.message}`;
    if (seen.has(key) || seen.size > MAX_DISTINCT) return;
    seen.add(key);

    const payload = { ...r, url: r.url ?? window.location.href };
    if (socket.connected) {
      socket.emit('client:error', payload);
      return;
    }
    const body = JSON.stringify(payload);
    // keepalive lets the request outlive a page that is already unloading.
    void fetch(`${SERVER}/api/client-log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {
      /* nothing more to try; never let reporting throw */
    });
  } catch {
    /* reporting must never become the error */
  }
}

/** Global traps. Called once at startup. */
export function installErrorReporting(): void {
  window.addEventListener('error', (e) => {
    report({
      source: 'window',
      message: String(e.message || 'script error'),
      detail: e.error instanceof Error ? e.error.stack?.slice(0, 2000) : undefined,
    });
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    report({
      source: 'promise',
      message: r instanceof Error ? r.message : String(r).slice(0, 500),
      detail: r instanceof Error ? r.stack?.slice(0, 2000) : undefined,
    });
  });
  socket.on('connect_error', (err) => {
    report({ source: 'socket', message: `connect_error: ${err.message}` });
  });
}
