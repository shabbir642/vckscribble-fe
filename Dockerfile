# syntax=docker/dockerfile:1
# Static bundle served by Caddy, which also reverse-proxies /api and /socket.io
# to the backend — see vckscribble-be/deploy. The Caddyfile is mounted there.

FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
# The vendored contract is committed and CI guards drift, so the image build
# skips `contract:check` (the backend source is not in this build context).
RUN pnpm exec tsc -b && pnpm exec vite build

FROM caddy:2.8-alpine
COPY --from=build /app/dist /srv
