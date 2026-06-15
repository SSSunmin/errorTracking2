# Mini-Sentry

Mini-Sentry is a production-oriented browser JavaScript error monitoring platform.
This repository currently contains only the Phase 1 monorepo and data-infra skeleton.

## Prerequisites

- Node.js 20 or newer
- npm 11 or newer
- Docker Desktop with Docker Compose

## Setup

```sh
npm install
```

Copy `.env.example` to `.env` if you need to recreate local environment defaults.
A working local `.env` is included for Phase 1.

## Data Infrastructure

Start PostgreSQL and Redis:

```sh
npm run infra:up
```

Stop them:

```sh
npm run infra:down
```

## Verification

```sh
npm run typecheck
npm test
npm run lint
docker compose config
```

## Planned Architecture

The intended flow is:

```text
Browser SDK -> Ingest API -> Redis queue -> Worker -> PostgreSQL
React dashboard -> JWT auth API
```

Later phases will add the browser SDK, Fastify API, BullMQ worker, Prisma models,
authentication, alerting integrations, and the React dashboard.
