import type { NetRoute } from '../generated/contract';

/**
 * Whether a fast route to the game server is worth keeping. It can connect
 * and still be unusable: on some networks it loses most of its packets
 * (measured on a mobile network: 8 ms when a reply came back, but most never
 * did), while the same player reaches the proxied route through Cloudflare
 * reliably.
 *
 * `results` are round trips in ms, null for a ping that got no reply in time.
 * Bad when more than `maxLost` got no reply, or the median is over `slowMs`.
 */
export function routeVerdict(
  results: readonly (number | null)[],
  slowMs: number,
  maxLost: number,
): 'ok' | 'bad' {
  const lost = results.filter((r) => r === null).length;
  if (lost > maxLost) return 'bad';
  const rtts = results.filter((r): r is number => r !== null).sort((a, b) => a - b);
  const median = rtts.length ? rtts[Math.floor((rtts.length - 1) / 2)]! : Infinity;
  return median > slowMs ? 'bad' : 'ok';
}

/** How one route's first request went, and when it finished (ms, any clock). */
export interface ProbeResult {
  ok: boolean;
  at: number;
}

/**
 * The two fast routes reach the same machine, both over new connections: if
 * 443 answered, the game port answers within moments too, or not at all.
 */
export const SAME_SERVER_GRACE_MS = 250;
/**
 * The proxied route usually answers first — its connection is already open,
 * from loading the page — while a fast route still has to open one (two or
 * three round trips on a slow phone network). This long, from the start, a
 * fast route gets to answer before the proxied one is taken.
 */
export const FAST_ROUTE_WAIT_MS = 2000;

export type RouteChoice = { route: NetRoute } | { wait: number | null };

/**
 * Which route to connect on, from what the first requests have found so far.
 * `candidates` are fastest first and `results` holds the ones that have
 * finished. Either a route, or wait: until that time (then ask again), or
 * (null) until another request finishes.
 *
 * The fastest route that answers wins; a faster one still pending gets a
 * little longer (above), and is passed over after that. When every request
 * failed — the server restarting, the device offline — it is `fallback`.
 */
export function pickRoute(
  candidates: readonly NetRoute[],
  results: Partial<Record<NetRoute, ProbeResult>>,
  startedAt: number,
  now: number,
  fallback: NetRoute = candidates[0] ?? 'proxied',
): RouteChoice {
  for (let i = 0; i < candidates.length; i++) {
    const result = results[candidates[i]!];
    if (result?.ok) return { route: candidates[i]! };
    if (result) continue; // failed: on to the next
    // Still pending: worth waiting for, until a slower route has answered
    // and this one has had its chance.
    const slower = candidates.slice(i + 1).find((c) => results[c]?.ok);
    if (!slower) return { wait: null };
    const deadline =
      slower === 'proxied' ? startedAt + FAST_ROUTE_WAIT_MS : results[slower]!.at + SAME_SERVER_GRACE_MS;
    if (now < deadline) return { wait: deadline };
  }
  return { route: fallback };
}
