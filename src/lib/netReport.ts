import { isDirect, socket } from './socket';

/**
 * Measures what this player's connection is actually like and tells the
 * server once a minute: round-trip times, unanswered pings, reconnects. The
 * server only sees its own side; without this nobody would know whether real
 * players feel lag, or how many networks block the direct game port.
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
    if (err) lost++;
    else rtts.push(performance.now() - t0);
  });
}

function report(): void {
  if (!socket.connected || (rtts.length === 0 && lost === 0 && reconnects === 0)) return;
  const sorted = [...rtts].sort((a, b) => a - b);
  const at = (p: number) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0);
  socket.emit('net:report', {
    rttP50: at(0.5),
    rttP95: at(0.95),
    rttMax: Math.round(sorted[sorted.length - 1] ?? 0),
    samples: sorted.length,
    lost,
    reconnects,
    direct: isDirect(),
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
