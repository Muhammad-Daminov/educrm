import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker, type Job } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import { runInTenant } from '../tenant/run-in-tenant';
import type { Env } from '../config/env.validation';
import { OutboxProcessor } from './outbox.processor';
import { OutboxHandlerRegistry } from './outbox-handler.registry';
import { OUTBOX_QUEUE } from './outbox.constants';
import type { OutboxJobData } from './outbox.types';

const CONCURRENCY = 5;

/**
 * The consuming half: a BullMQ worker, started only when APP_ROLE=worker.
 *
 * It is a thin shell on purpose. Everything that decides an event's fate
 * lives in `OutboxProcessor`, and failures are recorded on the outbox row
 * rather than left to BullMQ's retry machinery — so the job never fails
 * from BullMQ's point of view, and the row is the single source of truth
 * for "what happened to this event".
 */
@Injectable()
export class OutboxWorkerService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxWorkerService.name);
  private connection: Redis | undefined;
  private worker: Worker<OutboxJobData> | undefined;

  constructor(
    private readonly configService: ConfigService<Env, true>,
    private readonly processor: OutboxProcessor,
    private readonly registry: OutboxHandlerRegistry,
  ) {}

  onModuleInit(): void {
    if (this.configService.get('APP_ROLE', { infer: true }) !== 'worker') {
      return;
    }

    this.connection = new IORedis(this.configService.get('REDIS_URL', { infer: true }), {
      maxRetriesPerRequest: null,
    });

    this.worker = new Worker<OutboxJobData>(
      OUTBOX_QUEUE,
      (job) => this.handle(job),
      { connection: this.connection, concurrency: CONCURRENCY },
    );

    this.worker.on('failed', (job, error) => {
      // Only reachable if the processor itself (not a handler) threw — a
      // handler failure is caught and recorded on the row instead.
      this.logger.error(
        `Outbox job ${job?.id ?? 'unknown'} failed outside the processor: ${error.message}`,
      );
    });

    this.registry.logRegistered();
    this.logger.log(`Outbox worker listening on "${OUTBOX_QUEUE}" (concurrency ${CONCURRENCY})`);
  }

  async onApplicationShutdown(): Promise<void> {
    // Lets in-flight jobs finish rather than abandoning them in `dispatched`.
    await this.worker?.close();
    this.connection?.disconnect();
  }

  private async handle(job: Job<OutboxJobData>): Promise<void> {
    const { tenantId, eventId } = job.data;
    // Opens a CLS context for a non-HTTP caller, so the tenant-scoped
    // Prisma client behaves exactly as it does inside a request.
    await runInTenant(tenantId, () => this.processor.process(eventId));
  }
}
