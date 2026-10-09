import type { Prisma } from '@prisma/client';

/**
 * A domain event as published by a feature module (TZ 7.3 pattern 2:
 * `lesson.completed` -> finance, messaging, payroll).
 */
export interface OutboxEventInput {
  /** `aggregate.past_tense`, e.g. `lesson.completed`, `payment.received`. */
  eventType: string;
  payload: Prisma.InputJsonValue;
  /**
   * The outbox event this one was produced in reaction to. Carries the
   * causation chain so TZ M2's depth limit can cut a loop; set it whenever
   * a handler publishes a follow-up event.
   */
  causationId?: string | null;
  causationDepth?: number;
}

/** What a dispatcher hands to the queue, and a handler receives. */
export interface OutboxJobData {
  eventId: string;
  tenantId: string;
  eventType: string;
  /**
   * Attempt count *before* this run, mirrored from the row. Only used to
   * build a unique BullMQ job id per attempt; the row remains the source
   * of truth.
   */
  attempts: number;
}

export interface OutboxHandlerContext {
  eventId: string;
  tenantId: string;
  eventType: string;
  causationId: string | null;
  causationDepth: number;
  /** 1 on the first run. */
  attempt: number;
}

/**
 * Handlers must be idempotent (TZ 7.3 pattern 2: "Har handler mustaqil va
 * idempotent"). Delivery is at-least-once: a worker that dies after the
 * side effect but before marking the row done will run the handler again.
 */
export type OutboxHandler = (
  payload: Prisma.JsonValue,
  context: OutboxHandlerContext,
) => Promise<void>;
