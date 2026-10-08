# EduCRM

## Non-negotiable

- **Multi-statement writes must use `tenantDb.transaction`.**
  `tenantDb` (the `TENANT_PRISMA`-injected client, see
  `apps/api/src/database/tenant-prisma.provider.ts`) wraps every *individual*
  query in its own `SELECT set_config('app.current_tenant', ...)` + query
  transaction. That's correct for one-off reads/writes, but calling it
  multiple times for what should be one atomic operation gives you multiple
  separate transactions — no atomicity, and nothing rolls back together.

  For any operation that writes more than one row, or reads-then-writes and
  needs the result to be atomic, use:

  ```ts
  await tenantDb.transaction(async (tx) => {
    await tx.branch.create({ ... });
    await tx.enrollment.update({ ... });
    // tx is the plain Prisma transaction client — use tx here, not tenantDb.
    // Calling back into tenantDb from inside would try to open a second,
    // nested interactive transaction, which Prisma does not support.
  });
  ```

  `tenantDb.transaction` sets the tenant exactly once, at the start of one
  real interactive transaction, and hands the callback the plain
  (unextended) `tx` client. See
  `apps/api/test/integration/tenant-transaction.spec.ts` for the behavior
  this guarantees (atomic rollback, tenant visibility inside the
  transaction, no nested-transaction capability).

- **Every tenant-scoped table gets the exact same RLS policy pattern.** Copy
  it verbatim — do not reword the expression or drop `FORCE`:

  ```sql
  ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
  ALTER TABLE <table> FORCE ROW LEVEL SECURITY;

  CREATE POLICY tenant_isolation ON <table>
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
  ```

  `FORCE` is required or the policy is silently skipped for the table owner
  (`migrator`). `NULLIF(..., '')` is required, not optional polish: a
  PgBouncer-pooled connection that has run a transaction before resets this
  GUC to `''`, not `NULL` — without the guard, `''::uuid` throws instead of
  safely excluding rows. See `apps/api/prisma/migrations/*/migration.sql`
  (branches) for the reference copy, and
  `apps/api/test/integration/pgbouncer.spec.ts` for why the guard exists.

  **Every new tenant table must ship an RLS integration test** covering, at
  minimum, cross-tenant `SELECT` and cross-tenant `INSERT` both being
  blocked — see `apps/api/test/integration/rls.spec.ts` (branches) as the
  template to copy per table.

# Project context and rules (EduCRM)

Spec: docs/TZ_EduCRM_v2_0.pdf (what), docs/UX_Spec_EduCRM_v2_0.pdf (how). Read relevant sections before each task.
Task queue: docs/ROADMAP.md — take the first unchecked task, do ONLY that task, check it off when done.

## More non-negotiables
- Money: BIGINT tiyin, `Money` value object, never `number` arithmetic. ledger_entries append-only (trigger RAISE EXCEPTION). Charges via lesson_charges projection (TZ M6.6).
- Every endpoint: @RequirePermission or @Public. Permission check in backend only.
- Schedule conflicts: DB exclusion constraints (TZ M4.4).
- Ports: postgres 5433, redis 6380, pgbouncer 6433. Never 5432/6379.

## Workflow per task
1. Plan briefly, then implement backend + frontend + tests for the task.
2. Run: pnpm lint && pnpm typecheck && pnpm test. All must pass. Never skip or delete a failing test to make it pass.
3. Commit with conventional commit message on the current branch.
4. Append a 3-line summary to docs/PROGRESS.md (done / decisions / open questions).
5. If a requirement is ambiguous or contradicts the spec: write it to docs/QUESTIONS.md and pick the safest option. Never invent business rules for money.

## Style
TypeScript strict, no `any`. Error format TZ 6.2. UI texts via i18n keys (uz default).

# Project context and rules (EduCRM)

Spec: docs/TZ_EduCRM_v2_0.pdf (what), docs/UX_Spec_EduCRM_v2_0.pdf (how). Read relevant sections before each task.
Task queue: docs/ROADMAP.md — take the first unchecked task, do ONLY that task, check it off when done.

## More non-negotiables
- Money: BIGINT tiyin, `Money` value object, never `number` arithmetic. ledger_entries append-only (trigger RAISE EXCEPTION). Charges via lesson_charges projection (TZ M6.6).
- Every endpoint: @RequirePermission or @Public. Permission check in backend only.
- Schedule conflicts: DB exclusion constraints (TZ M4.4).
- Ports: postgres 5433, redis 6380, pgbouncer 6433. Never 5432/6379.

## Workflow per task
1. Plan briefly, then implement backend + frontend + tests for the task.
2. Run: pnpm lint && pnpm typecheck && pnpm test. All must pass. Never skip or delete a failing test to make it pass.
3. Commit with conventional commit message on the current branch.
4. Append a 3-line summary to docs/PROGRESS.md (done / decisions / open questions).
5. If a requirement is ambiguous or contradicts the spec: write it to docs/QUESTIONS.md and pick the safest option. Never invent business rules for money.

## Style
TypeScript strict, no `any`. Error format TZ 6.2. UI texts via i18n keys (uz default).
