# vckscribble-fe

Frontend for **vckscribble** — a corporate-slang drawing-and-guessing game.
React + Vite + TypeScript. Web only; desktop-first.

Backend: [`vckscribble-be`](https://github.com/shabbir642/vckscribble-be).
Plan: [`vckscribble`](https://github.com/shabbir642/vckscribble).

## Run

```bash
pnpm install
pnpm contract:sync   # pulls the socket contract from the BE repo
pnpm dev             # :5173, proxies /api to :3001
```

## The vendored contract

`src/generated/contract.ts` is **generated — do not edit it.** The source of
truth is `src/contract/index.ts` in the backend repo.

Splitting FE and BE into separate repos removed the shared workspace package
that previously made client/server protocol drift impossible. This is the
replacement:

```bash
pnpm contract:sync    # regenerate (commit the result)
pnpm contract:check   # fail if drifted — runs in CI and in `pnpm build`
```

Resolution order: `$CONTRACT_SOURCE` → sibling `../be` checkout → the GitHub
contents API. So it works whether or not you have both repos cloned.

**CI needs a secret.** `vckscribble-be` is private, so CI checks it out as a
sibling using `secrets.BE_REPO_TOKEN` — a PAT with read access to that repo.
Without it, `contract:check` fails with a 404. (A `$CONTRACT_TOKEN` env var is
honored as an alternative for the API path.)

## Deploy

A static bundle — any static host works (Cloudflare Pages, Netlify, Vercel).

```bash
VITE_SERVER_URL=https://vckscribble.fly.dev pnpm build   # -> dist/
```

Two things must line up or the socket will fail at runtime:

1. `VITE_SERVER_URL` is baked in **at build time**, not read at runtime.
   Changing the backend URL means rebuilding.
2. The backend's `CLIENT_ORIGIN` must name this deployment's origin exactly,
   or CORS blocks both the health check and the socket handshake.

The build needs the contract, so CI (and any build host) needs either
`BE_REPO_TOKEN` / `CONTRACT_TOKEN`, or the committed `src/generated/contract.ts`
to be current — it is committed, so a plain `vite build` works offline; only
`contract:check` needs access.
