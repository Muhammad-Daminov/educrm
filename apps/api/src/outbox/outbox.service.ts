import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { uuidv7 } from '@educrm/shared';
import { TENANT_PRISMA, type TenantPrismaClient } from '../database/tenant-prisma.provider';
import { TenantContextService } from '../tenant/tenant-context.service';
import { MAX_CAUSATION_DEPTH } from './outbox.constants';
import type { OutboxEventInput } from './outbox.types';

/**
 * Publishes domain events through the transactional outbox.
 *
 * **Always pass the `tx` of the transaction that made the business change.**
 * That is the entire point of the pattern (TZ 7.3 pattern 1): the event and
 * the change it announces either both commit or both vanish. Publishing
 * outside the transaction reintroduces exactly the failure the outbox
 * exists to remove — an SMS about a payment that was rolled back, or a
 * committed payment nobody is ever notified of.
 *
 * ```ts
 * await tenantDb.transaction(async (tx) => {
 *   await tx.lesson.update({ where: { id }, data: { status: 'completed' } });
 *   await outbox.publish({ eventType: 'lesson.completed', payload: { lessonId: id } }, tx);
 * });
 * ```
 */
@Injectable()
export class OutboxService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly tenantDb: TenantPrismaClient,
    private readonly tenantContext: TenantContextService,
  ) {}

  async publish(event: OutboxEventInput, tx?: Prisma.TransactionClient): Promise<string> {
    const tenantId = this.tenantContext.currentTenantId;
    if (!tenantId) {
      throw new ForbiddenException({
        code: 'TENANT_CONTEXT_MISSING',
        message: 'No tenant in request context; refusing to publish an event.',
        details: null,
      });
    }

    const causationDepth = event.causationDepth ?? 0;
    if (causationDepth > MAX_CAUSATION_DEPTH) {
      // TZ M2 cycle protection. Refusing to publish is what breaks the
      // loop: A changes a status, B reacts by reverting it, A reacts
      // again... Without this the chain never terminates.
      throw new BadRequestException({
        code: 'CAUSATION_DEPTH_EXCEEDED',
        message: `Event chain deeper than ${MAX_CAUSATION_DEPTH} was cut (event_type=${event.eventType})`,
        details: { eventType: event.eventType, causationDepth },
      });
    }

    const data: Prisma.OutboxEventCreateInput = {
      id: uuidv7(),
      tenantId,
      eventType: event.eventType,
      payload: event.payload,
      causationId: event.causationId ?? null,
      causationDepth,
    };

    if (tx) {
      const created = await tx.outboxEvent.create({ data });
      return created.id;
    }
    const created = await this.tenantDb.outboxEvent.create({ data });
    return created.id;
  }
}
