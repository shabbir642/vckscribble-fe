import { io, type Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '../generated/contract';
import { SERVER_URL } from './server';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * The fast path: straight to the game server on its own port, which serves
 * HTTPS itself (VITE_DIRECT_SOCKET_HOST/PORT, set by the production build).
 * Every drawing frame then skips the web server in front of the site.
 *
 * Some networks — offices especially — allow nothing but port 443, so the
 * first attempt gets a short timeout, and on failure the socket falls back to
 * the page's own origin (proxied to the same server), for the rest of the
 * visit. A browser where the direct port never worked skips it for a day.
 */
const directHost = import.meta.env['VITE_DIRECT_SOCKET_HOST'] as string | undefined;
const directPort = (import.meta.env['VITE_DIRECT_SOCKET_PORT'] as string | undefined) || '8443';
const DIRECT_URL =
  directHost && window.location.protocol === 'https:' && SERVER_URL === window.location.origin
    ? `https://${directHost}:${directPort}`
    : null;

const BLOCKED_KEY = 'vck:direct-blocked';
const BLOCKED_FOR_MS = 24 * 3600_000;
function directBlocked(): boolean {
  try {
    return Date.now() - Number(localStorage.getItem(BLOCKED_KEY) ?? 0) < BLOCKED_FOR_MS;
  } catch {
    return false;
  }
}
function rememberBlocked(): void {
  try {
    localStorage.setItem(BLOCKED_KEY, String(Date.now()));
  } catch {
    /* only costs a slower first connect next time */
  }
}

const startDirect = DIRECT_URL !== null && !directBlocked();

/**
 * Single connection for the app. WebSocket first: starting on HTTP long-polling
 * and upgrading costs extra round trips per connect, and polling requests from
 * one client must all reach the same server process. Polling stays as a
 * fallback for networks that block WebSockets.
 */
export const socket: GameSocket = io(startDirect ? DIRECT_URL : SERVER_URL, {
  autoConnect: false,
  transports: startDirect ? ['websocket'] : ['websocket', 'polling'],
  // A firewall that silently drops the direct port would otherwise hold the
  // first connect for the default 20 s before falling back.
  timeout: startDirect ? 5000 : 20000,
});

// The manager opens every (re)connection to its `uri`: a plain field, typed private.
const manager = socket.io as unknown as { uri: string };

/** Whether this page is connected straight to the game server right now. */
export const isDirect = () => DIRECT_URL !== null && manager.uri === DIRECT_URL;

/**
 * Back to the tab (or the network) after a drop: reconnect now. Left alone,
 * the manager waits out its backoff — up to five seconds of "reconnecting"
 * the moment someone looks at the game again. Only while it is trying anyway
 * (`active`): a player who left stays disconnected.
 */
function reconnectNow(): void {
  if (socket.connected || !socket.active) return;
  socket.disconnect();
  socket.connect();
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) reconnectNow();
});
window.addEventListener('online', reconnectNow);

if (startDirect) {
  // Switching the manager's uri is how the fallback redirects the reconnects
  // the manager already makes on its own (checked against socket.io-client 4.8).
  let directWorked = false;
  socket.on('connect', () => {
    if (manager.uri === DIRECT_URL) directWorked = true;
  });
  socket.on('connect_error', () => {
    if (manager.uri !== DIRECT_URL) return;
    // The manager reconnects on its own; the next attempt goes to the origin.
    manager.uri = SERVER_URL;
    socket.io.opts.transports = ['websocket', 'polling'];
    socket.io.timeout(20000);
    if (!directWorked) rememberBlocked();
  });
}
