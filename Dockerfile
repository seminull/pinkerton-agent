# syntax=docker/dockerfile:1

# One file, two shippable targets (`api` and `web`), so both images are cut from
# the same lockfile install and can't drift apart. docker-compose.prod.yml picks
# the target per service.

# Pinned to .nvmrc. Bump the two together — a container on a different Node
# than the one the code was developed against is a class of bug with no upside.
FROM node:24.16.0-alpine AS base
# pnpm comes from corepack at the version package.json's `packageManager` names,
# so the image can't silently install with a different pnpm than the lockfile
# was written by.
RUN corepack enable
WORKDIR /app

# Manifests only, before any source: this layer (the slow one) is reused until
# a dependency actually changes, not on every code edit.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

FROM deps AS web-build
COPY apps/web apps/web
RUN pnpm build:web

# --- web: static bundle + the /api reverse proxy ---------------------------
# The unprivileged variant runs as a non-root user and listens on 8080, so
# nothing in the stack needs root inside a container.
FROM nginxinc/nginx-unprivileged:1.29-alpine AS web
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /app/apps/web/dist /usr/share/nginx/html

# --- api: the Hono server, also used one-shot for migrations ---------------
# Dev dependencies stay installed on purpose: the server is TypeScript executed
# by tsx (nothing is compiled — see tsconfig.json), and sequelize-cli applies
# migrations from this same image. Both are devDependencies.
#
# Its own install, filtered to the root package: the shared `deps` stage also
# holds the client's toolchain (Vite, Mantine, ESLint), which the server never
# loads and which adds roughly half again to the size of this image.
FROM base AS api
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter pinkertonagent-app
COPY .sequelizerc tsconfig.json ./
COPY server server
ENV NODE_ENV=production \
    PORT=3040
USER node
EXPOSE 3040
# `node --import tsx` rather than the tsx binary: one process instead of a
# wrapper plus a child, so the container's stop signal reaches the server.
CMD ["node", "--import", "tsx", "server/index.ts"]
