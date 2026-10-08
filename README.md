# EduCRM

CRM/ERP platform for education centers. Monorepo skeleton (step 0.1) — no business
logic, auth, or DB models yet.

## Stack

- pnpm workspaces + Turborepo
- `apps/api` — NestJS 11, TypeScript strict
- `apps/web` — Next.js 15 (App Router), Tailwind, shadcn/ui
- `packages/shared` — shared TS types/utils
- `packages/config` — shared tsconfig / eslint / prettier configs
- Local infra: PostgreSQL 16, Redis 7 (via Docker Compose)

## Run locally

```bash
cp apps/api/.env.example apps/api/.env && cp apps/web/.env.example apps/web/.env.local
docker compose up -d
pnpm install
pnpm dev
```

- API: http://localhost:4000/api/v1/health/ready
- Web: http://localhost:3000

### Ports

Postgres and Redis are published on non-default host ports to avoid clashing with any
natively installed Postgres/Redis on the host.

| Service | Container port | Host port |
| --- | --- | --- |
| Postgres | 5432 | 5433 |
| Redis | 6379 | 6380 |

## Scripts

| Command | Description |
| --- | --- |
| `pnpm dev` | Run api (:4000) + web (:3000) in watch mode |
| `pnpm build` | Build all apps/packages |
| `pnpm lint` | Lint all apps/packages |
| `pnpm typecheck` | Type-check all apps/packages |
| `pnpm test` | Run unit tests (Vitest) |

## Project layout

```
apps/
  api/      NestJS modular monolith (config, health, common/middleware, common/filters)
  web/      Next.js App Router placeholder UI
packages/
  shared/   Shared TS types/utils (empty for now)
  config/   Shared tsconfig/eslint/prettier
docker/
  postgres/init.sql   Enables btree_gist + pg_trgm
docker-compose.yml    Postgres 16, Redis 7
```

## Notes

- Env vars are validated with `zod` at boot (`apps/api/src/config/env.validation.ts`); the
  process exits with a clear error if any required variable is missing or malformed.
- Every request gets an `X-Request-Id` (reused from the incoming header if present),
  echoed in the response and included in Pino logs.
- All uncaught errors are normalized to `{ "error": { "code", "message", "details", "request_id" } }`
  (see `apps/api/src/common/filters/all-exceptions.filter.ts`).
- `GET /api/v1/health/live` always returns `200`. `GET /api/v1/health/ready` checks
  Postgres + Redis and returns `503` with per-dependency status if either is down.
