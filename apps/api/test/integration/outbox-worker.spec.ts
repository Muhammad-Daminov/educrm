import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client as PgClient } from 'pg';
import { uuidv7 } from '@educrm/shared';
import { startWorkerTestApp, type WorkerTestApp } from './worker-setup';
import { OutboxService } from '../../src/outbox/outbox.service';
import { OutboxDispatcher } from '../../src/outbox/outbox-dispatcher.service';
import { OutboxHandlerRegistry } from '../../src/outbox/outbox-handler.registry';
import { TENANT_PRISMA, type TenantPrismaClient } from '../../src/database/tenant-prisma.provider';
import { runInTenant } from '../../src/tenant/run-in-tenant';
import type { OutboxStatus } from '@prisma/client';

let harness: WorkerTestApp;
let tenantId: string;
let outbox: OutboxService;
let dispatcher: OutboxDispatcher;
let registry: OutboxHandlerRegistry;
let tenantDb: TenantPrismaClient;

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  description: string,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for: ${description}`);
}

function statusOf(eventId: string): Promise<OutboxStatus | undefined> {
  return runInTenant(tenantId, async () => {
    const row = await tenantDb.outboxEvent.findUnique({ where: { id: eventId } });
    return row?.status;
  });
}

beforeAll(async () => {
  harness = await startWorkerTestApp();

  const migratorPg = new PgClient({ connectionString: harness.migratorUrl });
  await migratorPg.connect();
  tenantId = uuidv7();
  await migratorPg.query('INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3)', [
    tenantId,
    'Worker Tenant',
    `worker-tenant-${tenantId}`,
  ]);
  await migratorPg.end();

  outbox = harness.app.get(OutboxService);
  dispatcher = harness.app.get(OutboxDispatcher);
  registry = harness.app.get(OutboxHandlerRegistry);
  tenantDb = harness.app.get<TenantPrismaClient>(TENANT_PRISMA);
}, 180_000);

afterAll(async () => {
  await harness.stop();
}, 60_000);

describe('outbox worker process (APP_ROLE=worker)', () => {
  it('carries an event from publish through the queue to its handler', async () => {
    const handled: { payload: unknown; tenantId: string }[] = [];
    registry.register('lesson.completed', (payload, context) => {
      handled.push({ payload, tenantId: context.tenantId });
      return Promise.resolve();
    });

    const lessonId = uuidv7();
    const eventId = await runInTenant(tenantId, () =>
      outbox.publish({ eventType: 'lesson.completed', payload: { lessonId } }),
    );

    // One polling pass: claim the row, enqueue it. The BullMQ worker that
    // started with the app picks it up from there.
    expect(await dispatcher.tick()).toBe(1);

    await waitFor(() => handled.length === 1, 'the handler to run');
    expect(handled[0]).toEqual({ payload: { lessonId }, tenantId });

    await waitFor(async () => (await statusOf(eventId)) === 'done', 'the row to be marked done');
  }, 60_000);

  it('a failing handler leaves the event pending for a later retry', async () => {
    let calls = 0;
    registry.register('payment.received', () => {
      calls += 1;
      return Promise.reject(new Error('provider unreachable'));
    });

    const eventId = await runInTenant(tenantId, () =>
      outbox.publish({ eventType: 'payment.received', payload: {} }),
    );

    expect(await dispatcher.tick()).toBe(1);
    await waitFor(() => calls === 1, 'the handler to fail once');
    // Back to pending with a future next_retry_at — not failed in BullMQ,
    // because the outbox row owns the retry decision.
    await waitFor(async () => (await statusOf(eventId)) === 'pending', 'the row to go back to pending');

    const row = await runInTenant(tenantId, () =>
      tenantDb.outboxEvent.findUnique({ where: { id: eventId } }),
    );
    expect(row?.attempts).toBe(1);
    expect(row?.lastError).toContain('provider unreachable');
    expect(row?.nextRetryAt.getTime()).toBeGreaterThan(Date.now());

    // And it isn't claimed again until that time passes.
    expect(await dispatcher.tick()).toBe(0);
  }, 60_000);

  it('dispatches nothing when there is nothing due', async () => {
    expect(await dispatcher.tick()).toBe(0);
  }, 60_000);
});
