import { ClsServiceManager } from 'nestjs-cls';
import { TENANT_ID_KEY } from './tenant-context.constants';

/**
 * Entry point for workers/scripts that run outside an HTTP request (so
 * there's no ClsMiddleware to open the context for them). Opens its own CLS
 * context and seeds the tenant id, so any tenant-scoped Prisma client used
 * inside `fn` behaves exactly as it would inside a request handler.
 */
export async function runInTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  const cls = ClsServiceManager.getClsService();
  return cls.run(async () => {
    cls.set(TENANT_ID_KEY, tenantId);
    return fn();
  });
}
