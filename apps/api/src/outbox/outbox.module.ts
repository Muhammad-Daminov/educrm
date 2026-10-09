import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { OutboxService } from './outbox.service';
import { OutboxRepository } from './outbox.repository';
import { OutboxProcessor } from './outbox.processor';
import { OutboxHandlerRegistry } from './outbox-handler.registry';
import { OutboxDispatcher } from './outbox-dispatcher.service';
import { OutboxWorkerService } from './outbox-worker.service';

/**
 * Global for the same reason AuditModule is: publishing a domain event is
 * something nearly every feature module does, and the whole point of the
 * outbox is that nobody is tempted to call a side effect directly instead.
 *
 * `OutboxDispatcher` and `OutboxWorkerService` are registered in both
 * process roles but each returns immediately from `onModuleInit` unless
 * APP_ROLE=worker, so the API process opens no queue connections.
 */
@Global()
@Module({
  imports: [DatabaseModule],
  providers: [
    OutboxService,
    OutboxRepository,
    OutboxProcessor,
    OutboxHandlerRegistry,
    OutboxDispatcher,
    OutboxWorkerService,
  ],
  exports: [OutboxService, OutboxHandlerRegistry, OutboxProcessor, OutboxRepository],
})
export class OutboxModule {}
