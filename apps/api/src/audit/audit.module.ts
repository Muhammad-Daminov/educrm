import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { RequestMetaService } from '../common/request-meta';
import { RequestUserService } from '../auth/request-user.service';
import { AuditService } from './audit.service';
import { AuditPartitionService } from './audit-partition.service';

/**
 * Global: practically every feature module will need to write audit rows
 * (TZ M11.3 lists finance, roles, contacts, attendance, payroll, bulk
 * actions, exports and merges), and making each of them import this module
 * just means the one that forgets quietly stops auditing.
 *
 * `AuditPartitionService` is registered in both process roles but returns
 * immediately from `onModuleInit` unless APP_ROLE=worker, so the API
 * process starts no partition-maintenance timer.
 */
@Global()
@Module({
  imports: [DatabaseModule],
  providers: [AuditService, AuditPartitionService, RequestMetaService, RequestUserService],
  exports: [AuditService, RequestMetaService],
})
export class AuditModule {}
