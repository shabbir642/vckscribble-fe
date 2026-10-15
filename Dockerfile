# syntax=docker/dockerfile:1
# Static bundle served by Caddy, which also reverse-proxies /api and /socket.io
# to the backend — see vckscribble-be/deploy. The Caddyfile is mounted there.

FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
# Production: browsers connect to the game server directly on this host and
# port (see src/lib/socket.ts). Empty means always go through this origin.
ARG VITE_DIRECT_SOCKET_HOST=""
ARG VITE_DIRECT_SOCKET_PORT=8443
ENV VITE_DIRECT_SOCKET_HOST=$VITE_DIRECT_SOCKET_HOST VITE_DIRECT_SOCKET_PORT=$VITE_DIRECT_SOCKET_PORT
# The vendored contract is committed and CI guards drift, so the image build
# skips `contract:check` (the backend source is not in this build context).
RUN pnpm exec tsc -b && pnpm exec vite build

FROM caddy:2.8-alpine
COPY --from=build /app/dist /srv
