/**
 * Whether the direct route to the game server is worth keeping. It can
 * connect and still be unusable: on some networks it loses most of its
 * packets (measured on a mobile network: 8 ms when a reply came back, but
 * most never did), while the same player reaches the proxied route through
 * Cloudflare reliably.
 *
 * `results` are round trips in ms, null for a ping that got no reply in time.
 * Bad when more than `maxLost` got no reply, or the median is over `slowMs`.
 */
export function directVerdict(
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
