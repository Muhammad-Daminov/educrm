import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import { PrismaService } from '../database/prisma.service';
import { runInTenant } from '../tenant/run-in-tenant';
import type { Env } from '../config/env.validation';
import { OutboxRepository } from './outbox.repository';
import { OUTBOX_QUEUE } from './outbox.constants';
import type { OutboxJobData } from './outbox.types';

/** How long a `dispatched` row may sit before being treated as abandoned. */
const STALE_CLAIM_MS = 5 * 60_000;

/**
 * The relay half of the outbox pattern, running only in the worker process
 * (APP_ROLE=worker — TZ 7.1 "KERAK — worker ajratish": same code base,
 * separate process, so a heavy job never shows up in API latency).
 *
 * Polling per tenant, rather than one global `SELECT ... FROM
 * outbox_events`, is a consequence of taking RLS seriously: `outbox_events`
 * has FORCE row level security like every other tenant table, so there is
 * no connection — not even the table owner's — that can see all tenants'
 * rows at once. The alternatives were a BYPASSRLS role or a second
 * SECURITY DEFINER escape hatch; enumerating `tenants` (the one table with
 * no tenant_id and no RLS) and claiming inside each tenant's own context
 * costs one small query per tenant per tick and keeps the isolation
 * guarantee absolute.
 *
 * That cost is linear in tenant count: fine for R0's single pilot tenant,
 * and worth revisiting (LISTEN/NOTIFY, or a tenant-agnostic "has pending
 * work" signal) well before this runs for hundreds of tenants.
 */
@Injectable()
export class OutboxDispatcher implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxDispatcher.name);
  private connection: Redis | undefined;
  private queue: Queue<OutboxJobData> | undefined;
  private timer: NodeJS.Timeout | undefined;
  /** Guards against a slow tick overlapping the next one. */
  private ticking = false;

  constructor(
    private readonly configService: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
    private readonly repository: OutboxRepository,
  ) {}

  onModuleInit(): void {
    if (this.configService.get('APP_ROLE', { infer: true }) !== 'worker') {
      return;
    }

    this.connection = new IORedis(this.configService.get('REDIS_URL', { infer: true }), {
      // Required by BullMQ: it manages its own retry semantics and an
      // ioredis-level request cap would surface as spurious job failures.
      maxRetriesPerRequest: null,
    });
    this.queue = new Queue<OutboxJobData>(OUTBOX_QUEUE, { connection: this.connection });

    const interval = this.configService.get('OUTBOX_POLL_INTERVAL_MS', { infer: true });
    this.timer = setInterval(() => {
      void this.tick();
    }, interval);
    // Don't hold the process open on this timer alone.
    this.timer.unref();

    this.logger.log(`Outbox dispatcher polling every ${interval}ms`);
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    await this.queue?.close();
    this.connection?.disconnect();
  }

  /**
   * One polling pass: recover abandoned claims, then claim and enqueue due
   * events for every tenant. Exposed for tests, which drive it directly
   * instead of waiting on the interval.
   */
  async tick(): Promise<number> {
    if (this.ticking) {
      return 0;
    }
    this.ticking = true;
    try {
      const tenants = await this.prisma.tenant.findMany({ select: { id: true } });
      const staleBefore = new Date(Date.now() - STALE_CLAIM_MS);
      const batchSize = this.configService.get('OUTBOX_BATCH_SIZE', { infer: true });

      let dispatched = 0;
      for (const tenant of tenants) {
        dispatched += await runInTenant(tenant.id, async () => {
          const requeued = await this.repository.requeueStaleClaims(staleBefore);
          if (requeued > 0) {
            this.logger.warn(`Requeued ${requeued} abandoned outbox claim(s)`);
          }
          return this.dispatchBatch(batchSize);
        });
      }
      return dispatched;
    } catch (error) {
      // A failed tick must not kill the interval — the next one retries.
      this.logger.error(
        `Outbox dispatch tick failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 0;
    } finally {
      this.ticking = false;
    }
  }

  private async dispatchBatch(batchSize: number): Promise<number> {
    const queue = this.queue;
    if (!queue) {
      return 0;
    }

    const claimed = await this.repository.claimBatch(batchSize);
    for (const event of claimed) {
      await queue.add(
        event.eventType,
        {
          eventId: event.id,
          tenantId: event.tenantId,
          eventType: event.eventType,
          attempts: event.attempts,
        },
        {
          // Idempotency by event id: one job per (event, attempt). The
          // attempt suffix is needed because BullMQ remembers completed job
          // ids for a while and would silently drop a retry that reused
          // the bare event id. `:` is rejected by BullMQ (it separates its
          // own key namespaces), hence the wordy separator.
          jobId: `${event.id}-attempt-${event.attempts}`,
          // Retries are driven by the outbox row (next_retry_at), not by
          // BullMQ, so there is exactly one place that decides when an
          // event is tried again.
          attempts: 1,
          removeOnComplete: { count: 1_000 },
          removeOnFail: { count: 1_000 },
        },
      );
    }
    return claimed.length;
  }
}
