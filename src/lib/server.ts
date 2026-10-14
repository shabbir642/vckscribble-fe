/**
 * Where the backend lives.
 *
 * - `$VITE_SERVER_URL`, if set at build time: the backend is on another host.
 * - Production default: the page's own origin. The deployment puts a reverse
 *   proxy in front of both, routing `/api` and `/socket.io` to the backend, so
 *   one origin serves everything — no CORS, no URL baked into the build.
 * - Dev default: port 3001 on the host the page was served from (not a literal
 *   `localhost`), so a phone elsewhere on the wifi reaches the dev machine.
 */
const configured = import.meta.env['VITE_SERVER_URL'] as string | undefined;

export const SERVER_URL =
  configured ||
  (import.meta.env.PROD ? window.location.origin : `http://${window.location.hostname}:3001`);
