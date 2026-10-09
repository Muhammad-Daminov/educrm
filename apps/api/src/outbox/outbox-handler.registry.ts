import { Injectable, Logger } from '@nestjs/common';
import type { OutboxHandler } from './outbox.types';

/**
 * Where feature modules register what to do with a domain event, keeping
 * the publisher ignorant of its consumers (TZ 7.1 "SHART — modul
 * chegaralari": a module reaches another only through a public service
 * interface or a domain event).
 *
 * Several handlers may subscribe to one event type — `lesson.completed`
 * feeds finance, messaging and payroll. They run sequentially; if one
 * throws, the whole event is retried, which is why TZ 7.3 requires each
 * handler to be idempotent.
 */
@Injectable()
export class OutboxHandlerRegistry {
  private readonly logger = new Logger(OutboxHandlerRegistry.name);
  private readonly handlers = new Map<string, OutboxHandler[]>();

  register(eventType: string, handler: OutboxHandler): void {
    const existing = this.handlers.get(eventType);
    if (existing) {
      existing.push(handler);
      return;
    }
    this.handlers.set(eventType, [handler]);
  }

  handlersFor(eventType: string): OutboxHandler[] {
    return this.handlers.get(eventType) ?? [];
  }

  registeredEventTypes(): string[] {
    return [...this.handlers.keys()].sort();
  }

  logRegistered(): void {
    const types = this.registeredEventTypes();
    this.logger.log(
      types.length === 0
        ? 'No outbox handlers registered'
        : `Outbox handlers registered for: ${types.join(', ')}`,
    );
  }
}
