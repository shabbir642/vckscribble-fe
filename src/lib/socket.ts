import { io, type Socket } from 'socket.io-client';
import {
  shardOf,
  type ClientToServerEvents,
  type NetRoute,
  type RouteTrouble,
  type ServerToClientEvents,
} from '../generated/contract';
import { pickRoute, routeVerdict, type ProbeResult } from './route';
import { SERVER_URL } from './server';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * Where the one game connection goes. Two independent choices:
 *
 * - The route, fastest first (NetRoute in the contract):
 *   1. `direct`: straight to the game server on its own port, which serves
 *      HTTPS itself (VITE_DIRECT_SOCKET_HOST/PORT, set by the production
 *      build), so drawing frames skip the web server in front of the site.
 *   2. `direct443`: the same machine and name on port 443, through its web
 *      server, for networks (offices especially) that allow nothing else.
 *   3. `proxied`: through the page's own origin, i.e. the CDN in front of
 *      the site. Always works, but from India Cloudflare may answer from
 *      Singapore: 220-310 ms a round trip, against 10-40 ms straight.
 *   When the page opens, every route gets one tiny request at once (which
 *   also says how many game-server processes there are), and the fastest
 *   that answers wins (pickRoute). A route this browser's network blocks is
 *   skipped for a day, once a second look confirms it; one that connects but
 *   loses or delays replies, for three hours.
 *
 * - Which game-server process. The server runs one per CPU core and each owns
 *   the rooms whose code hashes to it (shardOf). The connection goes to the
 *   process that owns the room being joined; process N is on direct port
 *   DIRECT+N, or behind the web server at /s/N/socket.io.
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
/** On the page's own name, port 443 is the proxied route itself. */
const direct443Available = directAvailable && directHost !== window.location.hostname;

/* --------------------------------------------------------------- memory */

type FastRoute = Exclude<NetRoute, 'proxied'>;
const FAST_ROUTES: readonly FastRoute[] = ['direct', 'direct443'];

/** The fast routes this browser skips: until when (epoch ms), and why. */
const SKIP_KEY = 'vck:route-skip';
/** Before direct443 there was one route to skip, kept as a bare time. */
const OLD_SKIP_KEY = 'vck:direct-blocked-until';
/** A route this network blocks (an office firewall). */
const BLOCKED_FOR_MS = 24 * 3600_000;
/** One that connected but lost or delayed replies: routes recover. */
const LOSSY_FOR_MS = 3 * 3600_000;

type Skips = Partial<Record<FastRoute, { until: number; why: RouteTrouble }>>;

function saveSkips(s: Skips): void {
  try {
    localStorage.setItem(SKIP_KEY, JSON.stringify(s));
  } catch {
    /* only costs a slower start next time */
  }
}

function loadSkips(): Skips {
  const skips: Skips = {};
  try {
    const saved = JSON.parse(localStorage.getItem(SKIP_KEY) ?? '{}') as Record<string, unknown>;
    for (const r of FAST_ROUTES) {
      const s = saved[r] as { until?: unknown; why?: unknown } | undefined;
      if (s && typeof s.until === 'number' && (s.why === 'blocked' || s.why === 'lossy')) {
        skips[r] = { until: s.until, why: s.why };
      }
    }
    const old = localStorage.getItem(OLD_SKIP_KEY);
    if (old !== null) {
      const until = Number(old);
      if (until > Date.now() && !skips.direct) {
        skips.direct = { until, why: until - Date.now() > LOSSY_FOR_MS ? 'blocked' : 'lossy' };
      }
      saveSkips(skips);
      localStorage.removeItem(OLD_SKIP_KEY);
    }
  } catch {
    /* storage off: every visit starts afresh */
  }
  return skips;
}
let skips = loadSkips();
const skipping = (r: NetRoute) => r !== 'proxied' && (skips[r]?.until ?? 0) > Date.now();

function skip(r: FastRoute, why: RouteTrouble): void {
  skips = { ...skips, [r]: { until: Date.now() + (why === 'blocked' ? BLOCKED_FOR_MS : LOSSY_FOR_MS), why } };
  saveSkips(skips);
}

/** The fast routes this browser passes over right now, and why (for netReport). */
export function skippedRoutes(): Partial<Record<FastRoute, RouteTrouble>> {
  const out: Partial<Record<FastRoute, RouteTrouble>> = {};
  for (const r of FAST_ROUTES) if (skipping(r)) out[r] = skips[r]!.why;
  return out;
}

/** The routes worth trying from here, fastest first; `proxied` always. */
const usable = (): NetRoute[] => [
  ...(directAvailable && !skipping('direct') ? (['direct'] as const) : []),
  ...(direct443Available && !skipping('direct443') ? (['direct443'] as const) : []),
  'proxied',
];

/* ---------------------------------------------------------------- state */

let route: NetRoute = usable()[0]!;
let shards = 1;
let shard = 0;

const shardPath = () => (shards > 1 ? `/s/${shard}/socket.io` : '/socket.io');
const target = () =>
  route === 'direct'
    ? { uri: `https://${directHost}:${directBase + shard}`, path: '/socket.io' }
    : route === 'direct443'
      ? { uri: `https://${directHost}`, path: shardPath() }
      : { uri: SERVER_URL, path: shardPath() };

/**
 * Single connection for the app. WebSocket first: starting on HTTP long-polling
 * and upgrading costs extra round trips per connect, and polling requests from
 * one client must all reach the same server process. On the proxied route,
 * polling is the fallback for networks that block WebSockets.
 */
export const socket: GameSocket = io(target().uri, {
  autoConnect: false,
  path: target().path,
  transports: ['websocket'],
});

/*
 * The manager opens every (re)connection to its `uri` and `opts.path`, read
 * afresh each time; `uri` is a plain field, typed private. Changing them is how
 * routing redirects the reconnects the manager makes anyway (socket.io-client 4.8).
 */
const manager = socket.io as unknown as {
  uri: string;
  opts: { path?: string; tryAllTransports?: boolean };
};
function aim(): void {
  const t = target();
  manager.uri = t.uri;
  manager.opts.path = t.path;
  const fast = route !== 'proxied';
  socket.io.opts.transports = fast ? ['websocket'] : ['websocket', 'polling'];
  // Without it engine.io gives up when the first transport fails.
  manager.opts.tryAllTransports = !fast;
  // A firewall that silently drops a fast route would otherwise hold a
  // connect for the default 20 s; a healthy one takes well under a second.
  socket.io.timeout(fast ? 3000 : 20000);
}
aim();

/**
 * The route of the manager's latest connection or attempt, read from its
 * address: `route` may have moved on since that attempt was opened.
 */
function attemptRoute(): NetRoute {
  const e = socket.io.engine as unknown as { hostname?: string; port?: string } | undefined;
  if (!e?.hostname || !directAvailable || e.hostname !== directHost) return 'proxied';
  if (String(e.port) !== '443') return 'direct';
  return direct443Available ? 'direct443' : 'proxied';
}

/** The route this page's connection takes (or is about to). */
export const currentRoute = (): NetRoute => (socket.connected ? attemptRoute() : route);

/* -------------------------------------------------------- choosing one */

/** The tiny request each route gets: how many game-server processes there are. */
const shardsUrl = (r: NetRoute) =>
  r === 'direct'
    ? `https://${directHost}:${directBase}/api/shards`
    : r === 'direct443'
      ? `https://${directHost}/api/shards`
      : `${SERVER_URL}/api/shards`;

/**
 * How a route's request went: answered (with the number of processes);
 * reached, with an error from our side (a 502 while the server restarts — the
 * path itself works); or nothing came back at all.
 */
type Asked = { reach: 'answer'; shards: number } | { reach: 'reached' | 'none' };

async function askShards(r: NetRoute): Promise<Asked> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), r === 'proxied' ? 4000 : 3000);
  try {
    const res = await fetch(shardsUrl(r), { signal: ctl.signal, cache: 'no-store' });
    if (!res.ok) return { reach: 'reached' };
    const n = ((await res.json()) as { shards?: unknown }).shards;
    // An older server says nothing: one process.
    return { reach: 'answer', shards: typeof n === 'number' && Number.isInteger(n) && n >= 1 ? n : 1 };
  } catch {
    return { reach: 'none' };
  } finally {
    clearTimeout(t);
  }
}

/** One round of first requests: every candidate route asked at once. */
interface Round {
  candidates: NetRoute[];
  startedAt: number;
  results: Partial<Record<NetRoute, ProbeResult>>;
  asked: Partial<Record<NetRoute, Asked>>;
  /** Woken whenever a request finishes. */
  wake: () => void;
  /** Every request finished. */
  done: Promise<void>;
}

function startRound(candidates: NetRoute[]): Round {
  const round: Round = {
    candidates,
    startedAt: performance.now(),
    results: {},
    asked: {},
    wake: () => {},
    done: Promise.resolve(),
  };
  round.done = Promise.all(
    candidates.map((r) =>
      askShards(r).then((a) => {
        round.asked[r] = a;
        round.results[r] = { ok: a.reach === 'answer', at: performance.now() };
        round.wake();
      }),
    ),
  ).then(() => undefined);
  return round;
}

/** The fastest route that answers, by pickRoute's rules (`fallback` when none does). */
async function decide(round: Round, fallback?: NetRoute): Promise<NetRoute> {
  for (;;) {
    const c = pickRoute(round.candidates, round.results, round.startedAt, performance.now(), fallback);
    if ('route' in c) return c.route;
    await new Promise<void>((resume) => {
      round.wake = resume;
      if (c.wait !== null) setTimeout(resume, Math.max(0, c.wait - performance.now()));
    });
  }
}

const answered = (round: Round) =>
  Object.values(round.asked).some((a) => a?.reach === 'answer');

/** Wait this long before a second look at a route that seemed blocked. */
const CONFIRM_AFTER_MS = 15_000;
const suspects = new Set<FastRoute>();

/**
 * A fast route got nothing back while the server answered another way: this
 * network may block it, or the server may have been coming back from a
 * restart just then (the requests reach it moments apart). A second look,
 * a little later, tells the two apart; only then is it skipped for a day.
 * The proxied route vouches that the server is up: it passes through every
 * part of the server the fast ones do.
 */
function suspect(r: FastRoute): void {
  if (suspects.has(r) || skipping(r)) return;
  suspects.add(r);
  setTimeout(() => {
    void Promise.all([askShards(r), askShards('proxied')]).then(([mine, witness]) => {
      suspects.delete(r);
      if (mine.reach === 'none' && witness.reach === 'answer') skip(r, 'blocked');
    });
  }, CONFIRM_AFTER_MS);
}

/** After a round: any fast route that got nothing back while another answered is a suspect. */
function learnFrom(round: Round): void {
  void round.done.then(() => {
    if (!answered(round)) return; // the server or the device, not the network
    for (const r of FAST_ROUTES) if (round.asked[r]?.reach === 'none') suspect(r);
  });
}

/** The page's first round: picks the route and learns the number of processes. */
async function firstChoice(): Promise<void> {
  const round = startRound(usable());
  route = await decide(round);
  const a = round.asked[route];
  const any = Object.values(round.asked).find((x) => x?.reach === 'answer');
  const n = a?.reach === 'answer' ? a.shards : any?.reach === 'answer' ? any.shards : null;
  if (n !== null) shards = n;
  aim();
  learnFrom(round);
}

let ready = firstChoice();

/* ------------------------------------------------------------ processes */

/** The process that owns this room. */
export const shardFor = (roomCode: string) => shardOf(roomCode, shards);

/** Asks again how many processes there are, after WRONG_SHARD. */
async function refreshShards(): Promise<void> {
  const a = await askShards(route);
  if (a.reach === 'answer') {
    shards = a.shards;
    return;
  }
  const round = startRound(usable());
  await round.done;
  const any = Object.values(round.asked).find((x) => x?.reach === 'answer');
  if (any?.reach === 'answer') shards = any.shards;
}

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
  if (recheck) ready = refreshShards();
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

/* -------------------------------------------------------- route quality */

/*
 * A fast route can connect and still be unusable (see routeVerdict), so it
 * is tested as soon as it connects, watched while it stays up, and given up
 * for the next route as soon as it proves lossy or slow.
 */

/** Two quick pings on connecting (the server allows three in a burst). */
const PROBES = 2;
const PROBE_GAP_MS = 400;
const PROBE_TIMEOUT_MS = 1500;
/** The proxied route is 150 to 400 ms from India; a fast one should beat it easily. */
const PROBE_SLOW_MS = 600;
/** While playing: the last few of netReport's pings (one every 10 s). */
const WATCH = 4;
const WATCH_SLOW_MS = 800;

let watched: (number | null)[] = [];

/** The next route to try after `from`: the fastest usable one other than it. */
const nextAfter = (from: NetRoute): NetRoute => usable().find((r) => r !== from) ?? 'proxied';

/**
 * Off this route for a while (`why` says how long), and on to the next one.
 * Not socket.disconnect() to move a live connection: the server takes that
 * for the Leave button, and a host would hand the room to someone else on the
 * spot instead of getting their seat back. Closing the transport is a drop,
 * like any other, and the manager's reconnect goes the new way.
 */
function leaveRoute(from: FastRoute, why: RouteTrouble): void {
  skip(from, why);
  route = nextAfter(from);
  watched = [];
  aim();
  if (socket.connected) socket.io.engine?.close();
}

const pingOnce = (timeoutMs: number) =>
  new Promise<number | null>((done) => {
    const t0 = performance.now();
    socket.timeout(timeoutMs).emit('net:ping', {}, (err: Error | null) =>
      done(err ? null : performance.now() - t0),
    );
  });

async function probeRoute(on: FastRoute): Promise<void> {
  const results: (number | null)[] = [];
  for (let i = 0; i < PROBES; i++) {
    if (!socket.connected || attemptRoute() !== on) return;
    results.push(await pingOnce(PROBE_TIMEOUT_MS));
    if (i < PROBES - 1) await new Promise((next) => setTimeout(next, PROBE_GAP_MS));
  }
  if (socket.connected && attemptRoute() === on && routeVerdict(results, PROBE_SLOW_MS, 0) === 'bad') {
    leaveRoute(on, 'lossy');
  }
}

/** netReport's pings while playing: a route that turns bad mid-game is left too. */
export function noteRoundTrip(rtt: number | null): void {
  if (!socket.connected) return;
  const on = attemptRoute();
  if (on === 'proxied') return;
  watched = [...watched, rtt].slice(-WATCH);
  if (watched.length === WATCH && routeVerdict(watched, WATCH_SLOW_MS, 1) === 'bad') {
    leaveRoute(on, 'lossy');
  }
}

/**
 * Trouble on one route, counted in a row and cleared when it connects. A
 * single failure proves little: during a deploy every route fails for a few
 * seconds, and as the server comes back its routes answer moments apart.
 * - `misses`: its own request got nothing back while another route answered.
 * - `wsFailures`: its request was answered, but the connection still failed —
 *   something lets requests through but not the game's WebSocket (a proxy).
 * Two in a row and the connection moves on.
 */
const misses = new Map<NetRoute, number>();
const wsFailures = new Map<NetRoute, number>();
const count = (m: Map<NetRoute, number>, r: NetRoute) => {
  const n = (m.get(r) ?? 0) + 1;
  m.set(r, n);
  return n;
};

socket.on('connect', () => {
  // Wherever this connection landed is the route now, even if a re-check was
  // about to move it.
  const on = attemptRoute();
  route = on;
  misses.delete(on);
  wsFailures.delete(on);
  watched = [];
  // Hidden tabs throttle timers; their pings would measure the throttle.
  if (on !== 'proxied' && !document.hidden) void probeRoute(on);
});

let rechecking = false;

/**
 * A connection on a fast route failed. Ask every route again (meanwhile the
 * manager keeps retrying this one, which is right after a mere restart) and
 * move only on evidence that this route itself is the trouble.
 */
async function afterFailure(on: FastRoute): Promise<void> {
  if (rechecking) return;
  rechecking = true;
  try {
    const round = startRound(usable());
    learnFrom(round);
    await round.done;
    if (socket.connected) return; // back already: it was a blip or a restart
    const mine = round.asked[on]?.reach;
    if (mine === 'answer') {
      if (count(wsFailures, on) < 2) return;
      skip(on, 'blocked');
      route = nextAfter(on);
    } else if (mine === 'none' && answered(round)) {
      if (count(misses, on) < 2) return;
      const best = pickRoute(round.candidates, round.results, round.startedAt, Infinity, on);
      route = 'route' in best && best.route !== on ? best.route : nextAfter(on);
    } else {
      return; // nothing answered anywhere: the server is restarting, or the device is offline
    }
    aim();
  } finally {
    rechecking = false;
  }
}

/** A connection that never got through, as opposed to the server turning it away (a limit). */
const transportFailure = (err: Error) =>
  (err as { type?: unknown }).type === 'TransportError' || err.message === 'timeout';

socket.on('connect_error', (err) => {
  const on = attemptRoute();
  if (on === 'proxied' || !transportFailure(err)) return; // the last resort retries on its own
  void afterFailure(on);
});
