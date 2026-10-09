import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { TENANT_PRISMA, type TenantPrismaClient } from '../database/tenant-prisma.provider';

/** One claimed row, as the worker needs it. */
export interface ClaimedOutboxEvent {
  id: string;
  tenantId: string;
  eventType: string;
  attempts: number;
}

export interface ProcessableOutboxEvent {
  id: string;
  tenantId: string;
  eventType: string;
  payload: Prisma.JsonValue;
  status: 'pending' | 'dispatched' | 'done' | 'dead';
  attempts: number;
  causationId: string | null;
  causationDepth: number;
}

interface ClaimedRow {
  id: string;
  tenant_id: string;
  event_type: string;
  attempts: number;
}

/**
 * Every query here runs inside whichever tenant the ambient context names
 * (see `runInTenant`), so RLS applies normally — the worker gets no special
 * database privileges.
 */
@Injectable()
export class OutboxRepository {
  constructor(@Inject(TENANT_PRISMA) private readonly tenantDb: TenantPrismaClient) {}

  /**
   * Atomically takes up to `limit` due events for this worker.
   *
   * `FOR UPDATE SKIP LOCKED` is what makes it safe to run several workers:
   * rows another transaction has already locked are passed over instead of
   * blocking, so two dispatchers claim disjoint sets rather than waiting on
   * each other. The status flip to `dispatched` commits with the claim, so
   * a crash after this point leaves a visibly stuck row (recovered by
   * `requeueStale`) rather than a silently lost event.
   */
  async claimBatch(limit: number): Promise<ClaimedOutboxEvent[]> {
    const rows = await this.tenantDb.transaction(async (tx) => {
      return tx.$queryRaw<ClaimedRow[]>`
        UPDATE "outbox_events"
           SET status = 'dispatched', dispatched_at = now()
         WHERE id IN (
           SELECT id
             FROM "outbox_events"
            WHERE status = 'pending'
              AND next_retry_at <= now()
            ORDER BY next_retry_at ASC, created_at ASC
            FOR UPDATE SKIP LOCKED
            LIMIT ${limit}
         )
        RETURNING id, tenant_id, event_type, attempts
      `;
    });

    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      eventType: row.event_type,
      attempts: row.attempts,
    }));
  }

  async findForProcessing(eventId: string): Promise<ProcessableOutboxEvent | null> {
    const row = await this.tenantDb.outboxEvent.findUnique({ where: { id: eventId } });
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      tenantId: row.tenantId,
      eventType: row.eventType,
      payload: row.payload,
      status: row.status,
      attempts: row.attempts,
      causationId: row.causationId,
      causationDepth: row.causationDepth,
    };
  }

  async markDone(eventId: string, attempts: number): Promise<void> {
    await this.tenantDb.outboxEvent.update({
      where: { id: eventId },
      data: { status: 'done', attempts, processedAt: new Date(), lastError: null },
    });
  }

  /** Back to `pending` with a later `next_retry_at` — the dispatcher re-claims it. */
  async markForRetry(
    eventId: string,
    attempts: number,
    nextRetryAt: Date,
    lastError: string,
  ): Promise<void> {
    await this.tenantDb.outboxEvent.update({
      where: { id: eventId },
      data: { status: 'pending', attempts, nextRetryAt, lastError },
    });
  }

  /** TZ M2: "keyin dead-letter + alert". Terminal; needs a human. */
  async markDead(eventId: string, attempts: number, lastError: string): Promise<void> {
    await this.tenantDb.outboxEvent.update({
      where: { id: eventId },
      data: { status: 'dead', attempts, processedAt: new Date(), lastError },
    });
  }

  /**
   * Rescues claims that never made it onto the queue — the dispatcher
   * crashed, or Redis was unreachable, between the claiming UPDATE and the
   * enqueue. Without this those rows would sit in `dispatched` forever,
   * which is the one way a transactional outbox can still lose an event.
   */
  async requeueStaleClaims(staleBefore: Date): Promise<number> {
    const result = await this.tenantDb.outboxEvent.updateMany({
      where: { status: 'dispatched', dispatchedAt: { lt: staleBefore } },
      data: { status: 'pending' },
    });
    return result.count;
  }
}
