import { describe, expect, it } from 'vitest';
import { OutboxHandlerRegistry } from '../src/outbox/outbox-handler.registry';
import type { OutboxHandler } from '../src/outbox/outbox.types';

const noop: OutboxHandler = () => Promise.resolve();

describe('OutboxHandlerRegistry', () => {
  it('returns no handlers for an unregistered event type', () => {
    expect(new OutboxHandlerRegistry().handlersFor('lesson.completed')).toEqual([]);
  });

  it('keeps every handler subscribed to one event type', () => {
    // TZ 7.3: lesson.completed feeds finance, messaging and payroll.
    const registry = new OutboxHandlerRegistry();
    const finance: OutboxHandler = () => Promise.resolve();
    const messaging: OutboxHandler = () => Promise.resolve();

    registry.register('lesson.completed', finance);
    registry.register('lesson.completed', messaging);

    expect(registry.handlersFor('lesson.completed')).toEqual([finance, messaging]);
  });

  it('lists registered event types in a stable order', () => {
    const registry = new OutboxHandlerRegistry();
    registry.register('payment.received', noop);
    registry.register('lesson.completed', noop);

    expect(registry.registeredEventTypes()).toEqual(['lesson.completed', 'payment.received']);
  });
});
