import { Injectable, Logger } from '@nestjs/common';
import { OutboxRepository } from './outbox.repository';
import { OutboxHandlerRegistry } from './outbox-handler.registry';
import { backoffMs, MAX_ATTEMPTS } from './outbox.constants';

export type ProcessOutcome = 'done' | 'skipped' | 'retry' | 'dead';

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

/**
 * Runs one outbox event's handlers and moves the row to its next state.
 *
 * Deliberately free of BullMQ: the queue decides *when* an event runs, this
 * decides *what happens* to it, which keeps the retry/dead-letter state
 * machine testable against a real database without a Redis in the loop.
 *
 * The caller must have the event's tenant in the ambient context.
 */
@Injectable()
export class OutboxProcessor {
  private readonly logger = new Logger(OutboxProcessor.name);

  constructor(
    private readonly repository: OutboxRepository,
    private readonly registry: OutboxHandlerRegistry,
  ) {}

  async process(eventId: string): Promise<ProcessOutcome> {
    const event = await this.repository.findForProcessing(eventId);

    if (!event) {
      // The row is gone (or invisible in this tenant context). Nothing to
      // do, and nothing to retry — retrying could not make it appear.
      this.logger.warn(`Outbox event ${eventId} not found; skipping`);
      return 'skipped';
    }

    // Idempotency by event id (TZ M2). Delivery is at-least-once: a worker
    // that died after its side effects but before the status update leaves
    // a job that will be delivered again, and a retry that lands while the
    // original attempt is still finishing is possible too. A terminal
    // status is the authoritative "already handled".
    if (event.status === 'done' || event.status === 'dead') {
      return 'skipped';
    }

    const attempt = event.attempts + 1;
    const handlers = this.registry.handlersFor(event.eventType);

    try {
      if (handlers.length === 0) {
        // Not treated as success: silently dropping a domain event is how
        // a charge never gets posted. Let it retry and then dead-letter,
        // loudly, so the missing handler is visible.
        throw new Error(`No outbox handler registered for event type "${event.eventType}"`);
      }

      for (const handler of handlers) {
        await handler(event.payload, {
          eventId: event.id,
          tenantId: event.tenantId,
          eventType: event.eventType,
          causationId: event.causationId,
          causationDepth: event.causationDepth,
          attempt,
        });
      }

      await this.repository.markDone(event.id, attempt);
      return 'done';
    } catch (error) {
      const message = errorMessage(error);

      if (attempt >= MAX_ATTEMPTS) {
        await this.repository.markDead(event.id, attempt, message);
        this.logger.error(
          `Outbox event ${event.id} (${event.eventType}) dead-lettered after ${attempt} attempts: ${message}`,
        );
        return 'dead';
      }

      const delay = backoffMs(attempt);
      await this.repository.markForRetry(
        event.id,
        attempt,
        new Date(Date.now() + delay),
        message,
      );
      this.logger.warn(
        `Outbox event ${event.id} (${event.eventType}) attempt ${attempt}/${MAX_ATTEMPTS} failed, retrying in ${delay}ms: ${message}`,
      );
      return 'retry';
    }
  }
}
