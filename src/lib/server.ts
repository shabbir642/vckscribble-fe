/**
 * Where the backend lives.
 *
 * - `$VITE_SERVER_URL`, if set at build time: the backend is on another host.
 * - Otherwise the page's own origin, in dev and production alike. Something in
 *   front routes `/api` and `/socket.io` to the backend — Vite's proxy locally
 *   (see vite.config.ts), Caddy in production — so the same build works on
 *   localhost, over the wifi, or through a public tunnel.
 */
const configured = import.meta.env['VITE_SERVER_URL'] as string | undefined;

export const SERVER_URL = configured || window.location.origin;
