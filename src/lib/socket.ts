import { io, type Socket } from 'socket.io-client';
import {
  shardOf,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '../generated/contract';
import { SERVER_URL } from './server';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * Where the one game connection goes. Two independent choices:
 *
 * - Direct or proxied. The fast path is straight to the game server on its
 *   own port, which serves HTTPS itself (VITE_DIRECT_SOCKET_HOST/PORT, set by
 *   the production build), so drawing frames skip the web server in front of
 *   the site. Some networks — offices especially — allow nothing but port 443,
 *   so the first attempt gets a short timeout, and on failure the connection
 *   goes through the page's own origin (proxied to the same server) for the
 *   rest of the visit. A browser where the direct port never worked skips it
 *   for a day.
 *
 * - Which game-server process. The server runs one per CPU core and each owns
 *   the rooms whose code hashes to it (shardOf). The connection goes to the
 *   process that owns the room being joined; process N is on direct port
 *   DIRECT+N, or behind the proxy at /s/N/socket.io.
 */
/**
 * The names the game server answers on directly (comma-separated; the first
 * is the default). A page uses the one for its own site: the same name, or a
 * subdomain of it — the site itself can sit behind a CDN while the game
 * connects to an unproxied name like play.<site>. Either way a player on one
 * of our sites never depends on another.
 */
const directHosts = ((import.meta.env['VITE_DIRECT_SOCKET_HOST'] as string | undefined) ?? '')
  .split(',')
  .map((h) => h.trim())
  .filter(Boolean);
const pageHost = window.location.hostname.replace(/^www\./, '');
const directHost =
  directHosts.find((h) => h === pageHost) ??
  directHosts.find((h) => h.endsWith(`.${pageHost}`)) ??
  directHosts[0];
const directBase = Number((import.meta.env['VITE_DIRECT_SOCKET_PORT'] as string | undefined) || 8443);
const directAvailable =
  Boolean(directHost) && window.location.protocol === 'https:' && SERVER_URL === window.location.origin;

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

let direct = directAvailable && !directBlocked();
let shards = 1;
let shard = 0;

const target = () =>
  direct
    ? { uri: `https://${directHost}:${directBase + shard}`, path: '/socket.io' }
    : { uri: SERVER_URL, path: shards > 1 ? `/s/${shard}/socket.io` : '/socket.io' };

/**
 * Single connection for the app. WebSocket first: starting on HTTP long-polling
 * and upgrading costs extra round trips per connect, and polling requests from
 * one client must all reach the same server process. Polling stays as a
 * fallback for networks that block WebSockets.
 */
export const socket: GameSocket = io(target().uri, {
  autoConnect: false,
  path: target().path,
  transports: direct ? ['websocket'] : ['websocket', 'polling'],
  // A firewall that silently drops the direct port would otherwise hold the
  // first connect for the default 20 s before falling back.
  timeout: direct ? 5000 : 20000,
});

/*
 * The manager opens every (re)connection to its `uri` and `opts.path`, read
 * afresh each time; `uri` is a plain field, typed private. Changing them is how
 * routing redirects the reconnects the manager makes anyway (socket.io-client 4.8).
 */
const manager = socket.io as unknown as { uri: string; opts: { path?: string } };
function aim(): void {
  const t = target();
  manager.uri = t.uri;
  manager.opts.path = t.path;
}

/** Whether this page is connected straight to the game server right now. */
export const isDirect = () => direct && socket.connected;

/* ------------------------------------------------------------ processes */

/** How many game-server processes there are; asked once, and again if wrong. */
async function fetchShards(): Promise<void> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 4000);
    const r = await fetch(`${SERVER_URL}/api/shards`, { signal: ctl.signal });
    clearTimeout(t);
    const body = (await r.json()) as { shards?: number };
    shards = Number.isInteger(body.shards) && body.shards! >= 1 ? body.shards! : 1;
  } catch {
    shards = 1; // an older server, or none reachable: one process
  }
}
let ready = fetchShards();

/** The process that owns this room. */
export const shardFor = (roomCode: string) => shardOf(roomCode, shards);

/** Wait for a (re)connection, or give up waiting after a while. */
const connected = () =>
  new Promise<void>((resolve) => {
    if (socket.connected) return resolve();
    const t = setTimeout(done, 10_000);
    function done() {
      clearTimeout(t);
      socket.off('connect', done);
      resolve();
    }
    socket.once('connect', done);
  });

/**
 * First connection of the page: to the process of the room the page is about
 * (a seat to resume, an invite), else a random one, which is how new rooms
 * spread across processes.
 */
let started = false;
export async function connectFor(roomCode: string | null): Promise<void> {
  // Once per page. (React runs effects twice in development: a second random
  // pick would leave `shard` naming a process the socket is not connected to.)
  if (started) return;
  started = true;
  await ready;
  shard = roomCode ? shardFor(roomCode) : Math.floor(Math.random() * shards);
  aim();
  socket.connect();
}

/**
 * Make sure the connection is on the process that owns `roomCode`, moving it
 * if not (a join, an invite preview). `recheck` re-asks the process count
 * first: the server said WRONG_SHARD, so ours is out of date.
 */
export async function routeTo(roomCode: string, recheck = false): Promise<void> {
  if (recheck) ready = fetchShards();
  await ready;
  const want = shardFor(roomCode);
  // After WRONG_SHARD, reconnect even if the target looks unchanged: the
  // connection evidently is not where we thought.
  if (!recheck && want === shard && (socket.connected || socket.active)) return connected();
  shard = want;
  aim();
  socket.disconnect();
  socket.connect();
  return connected();
}

/** Whether the current connection is to the process that owns `roomCode`. */
export const onShardOf = (roomCode: string) => shardFor(roomCode) === shard;

/* ----------------------------------------------------------- reconnects */

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

if (direct) {
  let directWorked = false;
  socket.on('connect', () => {
    if (direct) directWorked = true;
  });
  socket.on('connect_error', () => {
    if (!direct) return;
    // The manager reconnects on its own; the next attempt goes through the origin.
    direct = false;
    aim();
    socket.io.opts.transports = ['websocket', 'polling'];
    socket.io.timeout(20000);
    if (!directWorked) rememberBlocked();
  });
}
