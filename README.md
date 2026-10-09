# EduCRM

CRM/ERP platform for education centers. No auth or business modules yet — this
covers the monorepo skeleton (step 0.1) and the multi-tenant data layer with
PostgreSQL Row-Level Security (step 0.2).

## Stack

- pnpm workspaces + Turborepo
- `apps/api` — NestJS 11, TypeScript strict, Prisma + PostgreSQL RLS, PgBouncer
- `apps/web` — Next.js 15 (App Router), Tailwind, shadcn/ui
- `packages/shared` — shared TS types/utils (uuidv7 id generator)
- `packages/config` — shared tsconfig / eslint / prettier configs
- Local infra: PostgreSQL 16, PgBouncer, Redis 7 (via Docker Compose)

## Run locally

```bash
cp apps/api/.env.example apps/api/.env && cp apps/web/.env.example apps/web/.env.local
docker compose up -d
pnpm install
pnpm --filter api prisma migrate deploy
pnpm dev
```

- API: http://localhost:4000/api/v1/health/ready
- Web: http://localhost:3100

### Ports

Postgres and Redis are published on non-default host ports to avoid clashing with any
natively installed Postgres/Redis on the host. The web dev server listens on
**3100**, not Next's default 3000, which belongs to another project on the
development machine — it is set in `apps/web/package.json` (`dev` and `start`)
and is not expected to change.

| Service | Container port | Host port |
| --- | --- | --- |
| Postgres | 5432 | 5433 |
| PgBouncer | 5432 | 6433 |
| Redis | 6379 | 6380 |
| Web (dev server) | — | 3100 |
| API | — | 4000 |

## Database: roles, migrations, RLS

Every tenant-scoped table enforces isolation at the database level with
PostgreSQL Row-Level Security — the application is not trusted to always
remember a `WHERE tenant_id = ...` clause. Two roles make this hold even
against the app's own bugs:

| Role | Used by | Connects to | Privileges |
| --- | --- | --- | --- |
| `migrator` | `prisma migrate` only | Postgres directly, port 5433 | Owns the schema/tables; the only role that can run DDL |
| `app_user` | the running API | PgBouncer, port 6433 | `SELECT`/`INSERT`/`UPDATE`/`DELETE` only, **not** the table owner, **not** `BYPASSRLS` |

Both roles and the default grant (every table `migrator` creates is
automatically readable/writable by `app_user` — see
`docker/postgres/init.sql`) are set up by the Postgres container's init
script, so a fresh `docker compose up -d` always has them.

Run migrations (as `migrator`, direct to Postgres — never through PgBouncer):

```bash
pnpm --filter api prisma migrate deploy
```

The Prisma schema's `directUrl` (→ `DATABASE_MIGRATION_URL`, migrator) is what
`prisma migrate` uses; the generated client at runtime uses `url` (→
`DATABASE_URL`, app_user through PgBouncer in transaction-pool mode, with
`pgbouncer=true` in the connection string).

**The RLS pattern**, reusable for every future tenant-scoped table (see
`apps/api/prisma/migrations/*/migration.sql`):

```sql
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE branches FORCE ROW LEVEL SECURITY; -- applies even to the table owner
CREATE POLICY tenant_isolation ON branches
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
```

The `NULLIF(..., '')` guards a real failure mode found under PgBouncer: once
a pooled backend connection has had this placeholder GUC set at least once,
it resets to `''` (not `NULL`) after that transaction ends, and `''::uuid`
throws instead of comparing false. Normalizing both "never set" and "reset
after a prior transaction" to `NULL` keeps this a clean zero-rows deny in
both cases — proven in `apps/api/test/integration/pgbouncer.spec.ts`.

`tenants` itself has no RLS (it's the root of the tenant tree), but
`app_user` only has `SELECT` on it — tenant provisioning isn't exposed
through the API yet.

**How the app sets `app.current_tenant`:** a Prisma Client extension
(`apps/api/src/database/tenant-prisma.provider.ts`) wraps every *single*
query in a transaction that starts with
`SELECT set_config('app.current_tenant', $1, true)`. If no tenant is on the
request context, the query never reaches the database. `is_local = true`
makes the setting transaction-scoped, so it's safe under PgBouncer's
transaction-mode pooling — proven in `apps/api/test/integration/rls.spec.ts`
and `apps/api/test/integration/pgbouncer.spec.ts`. For workers/scripts
outside an HTTP request, use `runInTenant(tenantId, fn)` from
`apps/api/src/tenant/run-in-tenant.ts`.

**Multi-statement writes** (see `CLAUDE.md`) must use `tenantDb.transaction(async (tx) => { ... })`
instead — same client, but it sets `app.current_tenant` exactly once and
hands the callback the plain transaction client, so several statements
share one atomic transaction instead of each opening its own. Proven in
`apps/api/test/integration/tenant-transaction.spec.ts`.

**Tenant resolution today is a placeholder** (`apps/api/src/tenant/tenant-header.resolver.ts`):
the `X-Tenant-Id` header, accepted only outside `production`. It's marked
`TODO(0.3)` — real auth will replace it with tenant resolution from the
authenticated session.

## Scripts

| Command | Description |
| --- | --- |
| `pnpm dev` | Run api (:4000) + web (:3100) in watch mode |
| `pnpm build` | Build all apps/packages |
| `pnpm lint` | Lint all apps/packages |
| `pnpm typecheck` | Type-check all apps/packages |
| `pnpm test` | Run unit + integration tests (Vitest; integration tests need Docker — they spin up a real Postgres via Testcontainers) |

## Project layout

```
apps/
  api/      NestJS modular monolith
    prisma/             schema.prisma, migrations/ (raw SQL incl. RLS)
    src/database/        PrismaService, tenant-scoped Prisma Client extension
    src/tenant/           TenantContextService (nestjs-cls), X-Tenant-Id resolver, runInTenant
    src/branches/         GET/POST /api/v1/branches (zod-validated)
    test/integration/     Testcontainers-backed RLS proofs
  web/      Next.js App Router placeholder UI
packages/
  shared/   Shared TS types/utils — uuidv7() id generator
  config/   Shared tsconfig/eslint/prettier
docker/
  postgres/init.sql   Extensions (btree_gist, pg_trgm) + migrator/app_user roles
docker-compose.yml    Postgres 16, PgBouncer, Redis 7
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
- IDs are UUIDv7, generated in application code (`packages/shared`'s `uuidv7()`) — not a
  database default — so they stay sortable by creation time without leaking a
  sequential counter.
