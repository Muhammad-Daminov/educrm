import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { RequestMetaService } from '../common/request-meta';
import { RequestUserService } from '../auth/request-user.service';
import { AuditService } from './audit.service';

/**
 * Global: practically every feature module will need to write audit rows
 * (TZ M11.3 lists finance, roles, contacts, attendance, payroll, bulk
 * actions, exports and merges), and making each of them import this module
 * just means the one that forgets quietly stops auditing.
 */
@Global()
@Module({
  imports: [DatabaseModule],
  providers: [AuditService, RequestMetaService, RequestUserService],
  exports: [AuditService, RequestMetaService],
})
export class AuditModule {}
