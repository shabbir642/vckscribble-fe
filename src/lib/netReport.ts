import { currentRoute, noteRoundTrip, skippedRoutes, socket } from './socket';

/**
 * Measures what this player's connection is actually like and tells the
 * server once a minute: round-trip times, unanswered pings, reconnects, the
 * route it takes and the faster ones it passes over. The server only sees
 * its own side; without this nobody would know whether real players feel
 * lag, or how many networks block the fast routes.
 *
 * Only while the tab is visible — a background tab's timers are throttled and
 * would report nonsense — and only when there is something to say.
 */
const PING_EVERY_MS = 10_000;
const REPORT_EVERY_MS = 60_000;
const LOST_AFTER_MS = 5_000;

let rtts: number[] = [];
let lost = 0;
let reconnects = 0;
let connectedBefore = false;
/** Why the last connection ended; leaving a room on purpose is not a drop. */
let lastDisconnect = '';

function ping(): void {
  if (!socket.connected || document.hidden) return;
  const t0 = performance.now();
  socket.timeout(LOST_AFTER_MS).emit('net:ping', {}, (err: Error | null) => {
    const rtt = err ? null : performance.now() - t0;
    if (rtt === null) lost++;
    else rtts.push(rtt);
    noteRoundTrip(rtt);
  });
}

/** The device's own name for its network, where the browser says (Chrome on Android). */
function link(): string | undefined {
  const type = (navigator as Navigator & { connection?: { type?: unknown } }).connection?.type;
  return typeof type === 'string' && /^[a-z]{1,16}$/.test(type) ? type : undefined;
}

function report(): void {
  if (!socket.connected || (rtts.length === 0 && lost === 0 && reconnects === 0)) return;
  const sorted = [...rtts].sort((a, b) => a - b);
  const at = (p: number) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0);
  const route = currentRoute();
  const kind = link();
  socket.emit('net:report', {
    rttP50: at(0.5),
    rttP95: at(0.95),
    rttMax: Math.round(sorted[sorted.length - 1] ?? 0),
    samples: sorted.length,
    lost,
    reconnects,
    direct: route === 'direct',
    route,
    skipped: skippedRoutes(),
    ...(kind ? { link: kind } : {}),
  });
  rtts = [];
  lost = 0;
  reconnects = 0;
}

export function startNetReporting(): void {
  socket.on('disconnect', (reason) => {
    lastDisconnect = reason;
  });
  socket.on('connect', () => {
    if (connectedBefore && lastDisconnect !== 'io client disconnect') reconnects++;
    connectedBefore = true;
  });
  setInterval(ping, PING_EVERY_MS);
  setInterval(report, REPORT_EVERY_MS);
}
