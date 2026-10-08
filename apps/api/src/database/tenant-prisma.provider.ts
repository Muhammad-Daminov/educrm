import { ForbiddenException } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * Minimal shape `createTenantScopedClient` needs from whatever holds the
 * current request's tenant id. `TenantContextService` implements this; it's
 * kept as a separate interface so tests can supply a plain object instead
 * of a full Nest-wired `TenantContextService` (which needs a `ClsService`).
 */
export interface TenantContextLike {
  readonly currentTenantId: string | undefined;
}

/**
 * Wraps every query in a transaction that starts with
 * `SELECT set_config('app.current_tenant', $1, true)`, matching TZ 5.3.
 *
 * Why a transaction and not a plain two-statement sequence: `set_config`
 * with `is_local = true` is transaction-scoped. Outside a transaction (or
 * across a PgBouncer transaction-mode pool boundary) it would either leak
 * to whichever client gets the connection next, or vanish before the real
 * query runs. Bundling both statements into one Prisma `$transaction` makes
 * Postgres execute them on the same server connection inside one
 * transaction, so the setting is guaranteed visible to the query and is
 * discarded at COMMIT — safe to reuse the pooled connection immediately
 * after for a different tenant.
 *
 * If no tenant is set on the request context, the query never reaches the
 * database at all.
 */
export function createTenantScopedClient<T extends PrismaClient>(
  prisma: T,
  tenantContext: TenantContextLike,
) {
  function requireTenantId(): string {
    const tenantId = tenantContext.currentTenantId;
    if (!tenantId) {
      throw new ForbiddenException({
        code: 'TENANT_CONTEXT_MISSING',
        message: 'No tenant in request context; refusing to run query.',
        details: null,
      });
    }
    return tenantId;
  }

  return prisma.$extends({
    name: 'tenant-scoping',
    client: {
      /**
       * For multi-statement writes (CLAUDE.md "Non-negotiable": multi-statement
       * writes must use tenantDb.transaction). Runs `set_config` exactly once
       * at the start of one real interactive transaction, then hands the
       * callback the plain, unextended `tx` client. Statements inside MUST
       * use `tx` — calling back into this tenant-scoped client from within
       * would try to open a second, nested interactive transaction (Prisma
       * doesn't support that, and it would defeat the "set once" guarantee).
       */
      async transaction<R>(fn: (tx: Prisma.TransactionClient) => Promise<R>): Promise<R> {
        const tenantId = requireTenantId();
        return prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, true)`;
          return fn(tx);
        });
      },
    },
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          const tenantId = requireTenantId();

          const [, result] = await prisma.$transaction([
            prisma.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, true)`,
            query(args),
          ]);
          return result;
        },
      },
    },
  });
}

export type TenantPrismaClient = ReturnType<typeof createTenantScopedClient>;

export const TENANT_PRISMA = Symbol('TENANT_PRISMA');
