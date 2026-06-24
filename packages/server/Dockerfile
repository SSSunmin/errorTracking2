# Mini-Sentry server image (multi-stage, monorepo-aware).
# Build context = repo root (so workspace package.jsons + lockfile are visible).
#   docker build -f packages/server/Dockerfile -t mini-sentry-server .
# The same image runs the API (default CMD), the worker (command override in
# compose) and one-shot `prisma migrate deploy` (migrate service in compose).
# ponytail: SDK static serving (/sdk/) is existsSync-guarded in the server, so we
# don't build @mini-sentry/sdk here — the route stays a no-op in prod. Add the
# sdk dist to this image only if/when script-tag drop-in serving is needed.

# ── build stage ────────────────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app

# Copy only manifests first so `npm ci` is cached across source changes.
COPY package.json package-lock.json ./
COPY packages/server/package.json packages/server/
COPY packages/dashboard/package.json packages/dashboard/
COPY packages/sdk/package.json packages/sdk/
COPY examples/demo-app/package.json examples/demo-app/
RUN npm ci

# Source + Prisma client generation + server build.
COPY . .
RUN npx prisma generate --schema=packages/server/prisma/schema.prisma
RUN npm run build -w @mini-sentry/server

# ── runtime stage ──────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# We reuse the build stage's node_modules wholesale rather than reinstalling with
# --omit=dev. Reason: the generated @prisma/client AND the prisma CLI (needed by
# the one-shot migrate service for `migrate deploy`) both carry transitive deps
# that a partial copy would miss. For a Phase 1 image, a correct image beats a
# few-MB-smaller fragile one.
# ponytail: to trim later, run a prod install + selectively copy .prisma/@prisma
# AND the full prisma CLI dep tree (@prisma/engines, @prisma/config, ...).
COPY package.json package-lock.json ./
COPY --from=build /app/node_modules node_modules

# Built server + Prisma schema & migrations.
COPY --from=build /app/packages/server/dist packages/server/dist
COPY packages/server/prisma packages/server/prisma

# Drop root: run as the built-in non-root `node` user (API, worker, and the
# one-shot migrate all share this image). Own /app so prisma can read its schema.
RUN chown -R node:node /app
USER node

# Run from the server package so relative paths (prisma/schema.prisma) resolve.
WORKDIR /app/packages/server
EXPOSE 4000
CMD ["node", "dist/index.js"]
