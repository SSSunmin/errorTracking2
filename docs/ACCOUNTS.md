# Demo / Test Accounts

## Seeded demo account

`npm run -w @mini-sentry/server db:seed` creates a ready-to-use login plus a
`Demo Project` (the seed also prints that project's DSN to stdout). The seed is
idempotent — re-running it keeps a single demo account.

| Account | Email | Password |
| --- | --- | --- |
| Demo (seeded) | `demo@mini-sentry.local` | `demo1234` |

Use this to log in to the dashboard.

## Throwaway verification accounts

End-to-end / live verification during development created disposable users in the
**dev** database (`mini_sentry`):

- Emails are random and timestamped, e.g. `e2e_*@ex.com`, `sdk_*@ex.com`,
  `dash_*@ex.com`, `v9_*@ex.com`.
- All use the password **`password123`** (one ad-hoc sanity user `x…@e.com` aside).
- Each owns its own project/issue data. They are safe to ignore or delete.

To reset the dev database to only the demo account:

```sh
npm run -w @mini-sentry/server db:reset   # drops, re-migrates, re-seeds the dev DB
```

## Test database

Automated tests run against a separate `mini_sentry_test` database that is
truncated between tests, so they never leave accounts behind.
