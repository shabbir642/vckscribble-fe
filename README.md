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

Deployed together with the backend as one Docker Compose stack on a VPS — see
`deploy/` and "Deploy (VPS)" in the backend README. This repo's `Dockerfile`
builds the static bundle into a Caddy image, which also reverse-proxies `/api`
and `/socket.io` to the backend.

A production build talks to **its own origin** by default, so no backend URL is
baked in. Set `VITE_SERVER_URL` at build time only if the backend is on a
different host (then the backend's `CLIENT_ORIGIN` must name this origin).

The image build uses the committed `src/generated/contract.ts`; CI's
`contract:check` is what guarantees it matches the backend.
