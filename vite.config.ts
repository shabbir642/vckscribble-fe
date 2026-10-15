import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The backend sits behind the same origin as the page, in dev as in
 * production: /api and the Socket.IO connection are proxied to it. So one URL
 * works everywhere — localhost, a phone on the wifi, or a public tunnel —
 * without a second port the outside world can't reach.
 */
const backend: Record<string, object> = {
  '/api': { target: 'http://localhost:3001', changeOrigin: true },
  '/socket.io': { target: 'http://localhost:3001', changeOrigin: true, ws: true },
};
/**
 * Several game-server processes (SHARDS=N on the backend): process N listens
 * on 3001 + N and is reached at /s/N/socket.io, as behind Caddy in production.
 */
for (let n = 0; n < 8; n++) {
  backend[`/s/${n}/socket.io`] = {
    target: `http://localhost:${3001 + n}`,
    changeOrigin: true,
    ws: true,
    rewrite: (path: string) => path.replace(`/s/${n}`, ''),
  };
}

/**
 * Vite refuses requests for hostnames it doesn't know (DNS-rebinding
 * protection). Allow the ones we actually serve under: Cloudflare quick
 * tunnels and the production domain.
 */
const allowedHosts = ['.trycloudflare.com', '.vmock.fun'];

export default defineConfig({
  plugins: [react()],
  server: {
    // Listen on every interface so others on the wifi can reach the dev server.
    host: true,
    port: 5173,
    proxy: backend,
    allowedHosts,
  },
  // `pnpm preview`: the production build, served the same way — what a
  // tunnel for testers should point at.
  preview: {
    host: true,
    port: 4173,
    proxy: backend,
    allowedHosts,
  },
  build: { outDir: 'dist', sourcemap: true },
});
