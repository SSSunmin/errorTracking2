# Mini-Sentry

A production-oriented, browser-JavaScript **error monitoring platform** — a small Sentry.
Capture errors in the browser, ship them to an ingest API, group them into issues, and
view/triage/alert on them from a dashboard.

```text
Browser app ── @mini-sentry/sdk ──▶ Ingest API ──▶ Redis queue (BullMQ)
                                                          │
                                                     Worker ── fingerprint grouping ──▶ PostgreSQL
                                                          └── alert rules ──▶ Email / Slack
Dashboard (React) ◀── JWT auth API ◀── PostgreSQL
```

## Packages

| Package | Description |
| --- | --- |
| `packages/sdk` (`@mini-sentry/sdk`) | Browser SDK: global handlers, breadcrumbs, stack parsing, transport |
| `packages/server` (`@mini-sentry/server`) | Fastify API + BullMQ worker + Prisma data layer |
| `packages/dashboard` (`@mini-sentry/dashboard`) | React + Vite dashboard |
| `examples/demo-app` | Vite page that uses the SDK to trigger demo errors |

## Features

- **Auth** — register/login, argon2id passwords, HS256 access JWT (alg-pinned, `jti`),
  DB-backed rotating refresh tokens (reuse → family revocation), httpOnly `SameSite=Strict` cookie.
- **Projects & DSNs** — per-project public keys, ownership-scoped API.
- **Ingestion** — public `POST /api/:projectId/store`, DSN-key auth, per-route permissive CORS,
  IP rate-limit, 256 KB body limit, depth/size-capped payloads.
- **Grouping** — fingerprint (sha256) → issue upsert with counters; resolved issues reopen on new events.
- **Issues** — list/search/sort, detail with stacktrace/breadcrumbs/tags/user, time-bucketed stats, resolve/ignore.
- **Alerts** — `new_issue` / `regression` / `event_threshold` rules → Email (Nodemailer) or Slack webhook,
  with advisory-locked dedup and SSRF-guarded delivery.

## Prerequisites

- Node.js 20+ (developed on 24), npm 11+
- Docker Desktop with Docker Compose

## Setup

```sh
npm install
cp .env.example .env   # adjust ports if 5432/6379/4000/5173 are taken locally
npm run infra:up       # start PostgreSQL + Redis
npm run -w @mini-sentry/server db:deploy   # apply migrations
npm run -w @mini-sentry/server db:seed     # optional demo data (prints a DSN)
```

> The committed local `.env` on the dev machine uses non-default host ports
> (Postgres `5433`, Redis `6380`, API `4100`) to avoid collisions; `.env.example`
> ships the conventional defaults.

New here? Start with the [Usage Guide](docs/GUIDE.md) — end-to-end walkthrough (account → DSN → SDK wiring → alerts) with sample code.

Demo and test account credentials are documented in [docs/ACCOUNTS.md](docs/ACCOUNTS.md).

## Run

```sh
npm run -w @mini-sentry/server dev          # API (default :4000)
npm run -w @mini-sentry/server worker:dev   # queue worker
npm run -w @mini-sentry/dashboard dev       # dashboard (:5173, proxies /api → API)
npm run -w @mini-sentry/demo-app dev        # SDK demo page
```

Open the dashboard, sign up, create a project, copy its DSN, and point an app at it:

```ts
import { init, captureException } from "@mini-sentry/sdk";

init({ dsn: "http://<publicKey>@localhost:4000/<projectId>", release: "1.0.0" });

try {
  doRiskyThing();
} catch (error) {
  captureException(error);
}
```

## Verification

```sh
npm run typecheck     # tsc -b across all packages
npm test              # vitest (server integration + sdk unit tests)
npm run lint          # eslint (strict, type-checked)
npm run build         # build all packages
```

Tests run against a dedicated `mini_sentry_test` database (auto-created/migrated by the
Vitest global setup) and never touch the dev database.

## Notes / out of scope

Learning/demo project. Not implemented: email verification / password reset / 2FA,
source-map symbolication, multi-org/teams, time-series sharding. Run a security review
before any real deployment.
