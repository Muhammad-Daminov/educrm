import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Client as PgClient } from 'pg';
import { uuidv7 } from '@educrm/shared';
import {
  createTenantScopedClient,
  type TenantContextLike,
} from '../../src/database/tenant-prisma.provider';
import { OutboxService } from '../../src/outbox/outbox.service';
import { OutboxRepository } from '../../src/outbox/outbox.repository';
import { OutboxProcessor } from '../../src/outbox/outbox.processor';
import { OutboxHandlerRegistry } from '../../src/outbox/outbox-handler.registry';
import { backoffMs, MAX_ATTEMPTS } from '../../src/outbox/outbox.constants';
import type { TenantContextService } from '../../src/tenant/tenant-context.service';
import type { OutboxHandler } from '../../src/outbox/outbox.types';
import { startTestDatabase, type TestDatabase } from './setup';

let db: TestDatabase;
let appUserClient: PrismaClient;
let tenantA: string;
let tenantB: string;

function tenantScoped(tenantId: string | undefined) {
  const ctx: TenantContextLike = { currentTenantId: tenantId };
  return createTenantScopedClient(appUserClient, ctx);
}

function outboxServiceFor(tenantId: string | undefined): OutboxService {
  return new OutboxService(tenantScoped(tenantId), {
    currentTenantId: tenantId,
  } as unknown as TenantContextService);
}

function repositoryFor(tenantId: string): OutboxRepository {
  return new OutboxRepository(tenantScoped(tenantId));
}

async function seedTenant(migratorPg: PgClient, name: string): Promise<string> {
  const id = uuidv7();
  await migratorPg.query('INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3)', [
    id,
    name,
    `${name.toLowerCase().replace(/\s+/g, '-')}-${id}`,
  ]);
  return id;
}

beforeAll(async () => {
  db = await startTestDatabase();

  const migratorPg = new PgClient({ connectionString: db.migratorUrl });
  await migratorPg.connect();
  tenantA = await seedTenant(migratorPg, 'Outbox Tenant A');
  tenantB = await seedTenant(migratorPg, 'Outbox Tenant B');
  await migratorPg.end();

  appUserClient = new PrismaClient({ datasources: { db: { url: db.appUserUrl } } });
}, 60_000);

afterAll(async () => {
  await appUserClient.$disconnect();
  await db.stop();
}, 60_000);

describe('Row-Level Security — outbox_events', () => {
  it('tenant A cannot SELECT tenant B events', async () => {
    const idA = await outboxServiceFor(tenantA).publish({
      eventType: 'lesson.completed',
      payload: { lessonId: uuidv7() },
    });
    const idB = await outboxServiceFor(tenantB).publish({
      eventType: 'lesson.completed',
      payload: { lessonId: uuidv7() },
    });

    const seenByA = (await tenantScoped(tenantA).outboxEvent.findMany()).map((row) => row.id);
    const seenByB = (await tenantScoped(tenantB).outboxEvent.findMany()).map((row) => row.id);

    expect(seenByA).toContain(idA);
    expect(seenByA).not.toContain(idB);
    expect(seenByB).toContain(idB);
    expect(seenByB).not.toContain(idA);
  });

  it('INSERT with a foreign tenant_id fails WITH CHECK', async () => {
    const pg = new PgClient({ connectionString: db.appUserUrl });
    await pg.connect();
    try {
      await pg.query('BEGIN');
      await pg.query("SELECT set_config('app.current_tenant', $1, true)", [tenantA]);
      await expect(
        pg.query(
          `INSERT INTO outbox_events (id, tenant_id, event_type, payload)
           VALUES ($1, $2, $3, '{}'::jsonb)`,
          [uuidv7(), tenantB, 'lesson.completed'],
        ),
      ).rejects.toThrow(/row-level security/i);
    } finally {
      await pg.query('ROLLBACK').catch(() => undefined);
      await pg.end();
    }
  });

  it('a raw query as app_user with no tenant context returns 0 rows', async () => {
    const pg = new PgClient({ connectionString: db.appUserUrl });
    await pg.connect();
    try {
      expect((await pg.query('SELECT * FROM outbox_events')).rows).toHaveLength(0);
    } finally {
      await pg.end();
    }
  });
});

describe('OutboxService.publish', () => {
  it('rolls back with the business change (the whole point of the pattern)', async () => {
    const code = `OBX-${uuidv7()}`;
    let eventId = '';

    await expect(
      tenantScoped(tenantA).transaction(async (tx) => {
        await tx.branch.create({
          data: { id: uuidv7(), tenantId: tenantA, name: 'Rolled back', code },
        });
        eventId = await outboxServiceFor(tenantA).publish(
          { eventType: 'branch.created', payload: { code } },
          tx,
        );
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(await tenantScoped(tenantA).branch.findMany({ where: { code } })).toHaveLength(0);
    expect(await tenantScoped(tenantA).outboxEvent.findUnique({ where: { id: eventId } })).toBeNull();
  });

  it('commits with the business change', async () => {
    const code = `OBX-${uuidv7()}`;

    const eventId = await tenantScoped(tenantA).transaction(async (tx) => {
      await tx.branch.create({ data: { id: uuidv7(), tenantId: tenantA, name: 'Kept', code } });
      return outboxServiceFor(tenantA).publish(
        { eventType: 'branch.created', payload: { code } },
        tx,
      );
    });

    const row = await tenantScoped(tenantA).outboxEvent.findUnique({ where: { id: eventId } });
    expect(row).toMatchObject({
      tenantId: tenantA,
      eventType: 'branch.created',
      status: 'pending',
      attempts: 0,
      causationDepth: 0,
      causationId: null,
      payload: { code },
    });
  });

  it('refuses an event with no tenant context', async () => {
    await expect(
      outboxServiceFor(undefined).publish({ eventType: 'lesson.completed', payload: {} }),
    ).rejects.toThrow(/No tenant in request context/);
  });

  it('cuts a causation chain deeper than 3 (TZ M2 cycle protection)', async () => {
    const service = outboxServiceFor(tenantA);

    // Depth 3 is still allowed...
    await expect(
      service.publish({ eventType: 'lead.status_changed', payload: {}, causationDepth: 3 }),
    ).resolves.toBeTruthy();

    // ...depth 4 is where the loop would start paying for itself.
    await expect(
      service.publish({ eventType: 'lead.status_changed', payload: {}, causationDepth: 4 }),
    ).rejects.toThrow(/deeper than 3/);
  });

  it('the depth limit is also a database constraint, not only application code', async () => {
    const pg = new PgClient({ connectionString: db.appUserUrl });
    await pg.connect();
    try {
      await pg.query('BEGIN');
      await pg.query("SELECT set_config('app.current_tenant', $1, true)", [tenantA]);
      await expect(
        pg.query(
          `INSERT INTO outbox_events (id, tenant_id, event_type, payload, causation_depth)
           VALUES ($1, $2, $3, '{}'::jsonb, 4)`,
          [uuidv7(), tenantA, 'lead.status_changed'],
        ),
      ).rejects.toThrow(/causation_depth/);
    } finally {
      await pg.query('ROLLBACK').catch(() => undefined);
      await pg.end();
    }
  });
});

describe('OutboxRepository.claimBatch', () => {
  it('hands each event to exactly one claimer under concurrency', async () => {
    const repository = repositoryFor(tenantA);
    await tenantScoped(tenantA).outboxEvent.deleteMany({});

    const published = await Promise.all(
      Array.from({ length: 12 }, () =>
        outboxServiceFor(tenantA).publish({ eventType: 'lesson.completed', payload: {} }),
      ),
    );

    // Four dispatchers racing for the same rows. SKIP LOCKED is what makes
    // this produce disjoint sets instead of duplicates or deadlocks.
    const batches = await Promise.all([
      repository.claimBatch(5),
      repository.claimBatch(5),
      repository.claimBatch(5),
      repository.claimBatch(5),
    ]);

    const claimedIds = batches.flat().map((event) => event.id);
    expect(claimedIds).toHaveLength(published.length);
    expect(new Set(claimedIds).size).toBe(published.length);
    expect([...claimedIds].sort()).toEqual([...published].sort());
  });

  it('respects the batch limit and leaves the rest pending', async () => {
    await tenantScoped(tenantA).outboxEvent.deleteMany({});
    for (let i = 0; i < 5; i += 1) {
      await outboxServiceFor(tenantA).publish({ eventType: 'lesson.completed', payload: {} });
    }

    expect(await repositoryFor(tenantA).claimBatch(2)).toHaveLength(2);
    expect(
      await tenantScoped(tenantA).outboxEvent.count({ where: { status: 'pending' } }),
    ).toBe(3);
  });

  it('does not claim an event whose retry is still in the future', async () => {
    await tenantScoped(tenantA).outboxEvent.deleteMany({});
    const eventId = await outboxServiceFor(tenantA).publish({
      eventType: 'lesson.completed',
      payload: {},
    });
    await tenantScoped(tenantA).outboxEvent.update({
      where: { id: eventId },
      data: { nextRetryAt: new Date(Date.now() + 60_000) },
    });

    expect(await repositoryFor(tenantA).claimBatch(10)).toHaveLength(0);
  });

  it('never claims another tenant\'s events', async () => {
    await tenantScoped(tenantA).outboxEvent.deleteMany({});
    await tenantScoped(tenantB).outboxEvent.deleteMany({});
    await outboxServiceFor(tenantB).publish({ eventType: 'lesson.completed', payload: {} });

    expect(await repositoryFor(tenantA).claimBatch(10)).toHaveLength(0);
    expect(await repositoryFor(tenantB).claimBatch(10)).toHaveLength(1);
  });

  it('requeues a claim abandoned mid-dispatch', async () => {
    // The gap the outbox could otherwise lose an event in: the row is
    // claimed, then the dispatcher dies before the enqueue.
    await tenantScoped(tenantA).outboxEvent.deleteMany({});
    const eventId = await outboxServiceFor(tenantA).publish({
      eventType: 'lesson.completed',
      payload: {},
    });
    await repositoryFor(tenantA).claimBatch(10);
    await tenantScoped(tenantA).outboxEvent.update({
      where: { id: eventId },
      data: { dispatchedAt: new Date(Date.now() - 10 * 60_000) },
    });

    expect(await repositoryFor(tenantA).requeueStaleClaims(new Date(Date.now() - 60_000))).toBe(1);
    expect(await repositoryFor(tenantA).claimBatch(10)).toHaveLength(1);
  });

  it('leaves a fresh claim alone', async () => {
    await tenantScoped(tenantA).outboxEvent.deleteMany({});
    await outboxServiceFor(tenantA).publish({ eventType: 'lesson.completed', payload: {} });
    await repositoryFor(tenantA).claimBatch(10);

    expect(await repositoryFor(tenantA).requeueStaleClaims(new Date(Date.now() - 60_000))).toBe(0);
  });
});

describe('OutboxProcessor', () => {
  function processorFor(tenantId: string, registry: OutboxHandlerRegistry): OutboxProcessor {
    return new OutboxProcessor(repositoryFor(tenantId), registry);
  }

  it('runs every handler for the event type and marks the row done', async () => {
    const registry = new OutboxHandlerRegistry();
    const seen: string[] = [];
    registry.register('lesson.completed', (payload, context) => {
      seen.push(`finance:${JSON.stringify(payload)}:${context.attempt}:${context.tenantId}`);
      return Promise.resolve();
    });
    registry.register('lesson.completed', () => {
      seen.push('messaging');
      return Promise.resolve();
    });

    const eventId = await outboxServiceFor(tenantA).publish({
      eventType: 'lesson.completed',
      payload: { lessonId: 'L1' },
    });

    expect(await processorFor(tenantA, registry).process(eventId)).toBe('done');
    expect(seen).toEqual([`finance:{"lessonId":"L1"}:1:${tenantA}`, 'messaging']);

    const row = await tenantScoped(tenantA).outboxEvent.findUnique({ where: { id: eventId } });
    expect(row?.status).toBe('done');
    expect(row?.attempts).toBe(1);
    expect(row?.processedAt).not.toBeNull();
    expect(row?.lastError).toBeNull();
  });

  it('is idempotent by event id: a redelivered done event does not run again', async () => {
    // Delivery is at-least-once, so this is the normal case after a worker
    // dies between the side effect and the status update.
    const registry = new OutboxHandlerRegistry();
    let calls = 0;
    registry.register('payment.received', () => {
      calls += 1;
      return Promise.resolve();
    });

    const eventId = await outboxServiceFor(tenantA).publish({
      eventType: 'payment.received',
      payload: {},
    });
    const processor = processorFor(tenantA, registry);

    expect(await processor.process(eventId)).toBe('done');
    expect(await processor.process(eventId)).toBe('skipped');
    expect(await processor.process(eventId)).toBe('skipped');
    expect(calls).toBe(1);
  });

  it('schedules a retry with exponential backoff and records the error', async () => {
    const registry = new OutboxHandlerRegistry();
    registry.register('payment.received', () =>
      Promise.reject(new Error('provider timeout')),
    );

    const eventId = await outboxServiceFor(tenantA).publish({
      eventType: 'payment.received',
      payload: {},
    });
    const before = Date.now();

    expect(await processorFor(tenantA, registry).process(eventId)).toBe('retry');

    const row = await tenantScoped(tenantA).outboxEvent.findUnique({ where: { id: eventId } });
    expect(row?.status).toBe('pending');
    expect(row?.attempts).toBe(1);
    expect(row?.lastError).toBe('Error: provider timeout');
    // Due roughly backoffMs(1) from now, and definitely not immediately.
    const dueIn = (row?.nextRetryAt.getTime() ?? 0) - before;
    expect(dueIn).toBeGreaterThan(backoffMs(1) - 5_000);
    expect(dueIn).toBeLessThan(backoffMs(1) + 5_000);
  });

  it('dead-letters on the fifth failure, not before (TZ M2)', async () => {
    const registry = new OutboxHandlerRegistry();
    let calls = 0;
    registry.register('payment.received', () => {
      calls += 1;
      return Promise.reject(new Error('still broken'));
    });

    const eventId = await outboxServiceFor(tenantA).publish({
      eventType: 'payment.received',
      payload: {},
    });
    const processor = processorFor(tenantA, registry);
    const outcomes: string[] = [];

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      outcomes.push(await processor.process(eventId));
      // The retry delay is the dispatcher's concern; drive it forward here.
      await tenantScoped(tenantA).outboxEvent.updateMany({
        where: { id: eventId, status: 'pending' },
        data: { nextRetryAt: new Date() },
      });
    }

    expect(outcomes).toEqual(['retry', 'retry', 'retry', 'retry', 'dead']);
    expect(calls).toBe(MAX_ATTEMPTS);

    const row = await tenantScoped(tenantA).outboxEvent.findUnique({ where: { id: eventId } });
    expect(row?.status).toBe('dead');
    expect(row?.attempts).toBe(MAX_ATTEMPTS);
    expect(row?.lastError).toBe('Error: still broken');

    // A dead event is terminal: it is never claimed or run again.
    expect(await processor.process(eventId)).toBe('skipped');
    expect(calls).toBe(MAX_ATTEMPTS);
  });

  it('retries, then dead-letters, an event with no registered handler', async () => {
    // Marking it done would silently drop a domain event — the failure mode
    // where a charge never gets posted and nothing anywhere says so.
    const registry = new OutboxHandlerRegistry();
    const eventId = await outboxServiceFor(tenantA).publish({
      eventType: 'nobody.listens',
      payload: {},
    });

    expect(await processorFor(tenantA, registry).process(eventId)).toBe('retry');
    const row = await tenantScoped(tenantA).outboxEvent.findUnique({ where: { id: eventId } });
    expect(row?.lastError).toMatch(/No outbox handler registered for event type "nobody.listens"/);
  });

  it('skips an event it cannot see', async () => {
    const registry = new OutboxHandlerRegistry();
    const foreign = await outboxServiceFor(tenantB).publish({
      eventType: 'lesson.completed',
      payload: {},
    });

    expect(await processorFor(tenantA, registry).process(foreign)).toBe('skipped');
  });

  it('passes the causation chain to the handler', async () => {
    const registry = new OutboxHandlerRegistry();
    const causationId = uuidv7();
    let depth = -1;
    let causedBy: string | null = null;
    const handler: OutboxHandler = (_payload, context) => {
      depth = context.causationDepth;
      causedBy = context.causationId;
      return Promise.resolve();
    };
    registry.register('lead.status_changed', handler);

    const eventId = await outboxServiceFor(tenantA).publish({
      eventType: 'lead.status_changed',
      payload: {},
      causationId,
      causationDepth: 2,
    });

    expect(await processorFor(tenantA, registry).process(eventId)).toBe('done');
    expect(depth).toBe(2);
    expect(causedBy).toBe(causationId);
  });
});
