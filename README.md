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

Resolution order: `$CONTRACT_SOURCE` → sibling `../be` checkout → the BE repo's
raw GitHub URL. So it works whether or not you have both repos cloned.
