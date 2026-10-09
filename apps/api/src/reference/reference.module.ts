import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { CrudDeps } from '../common/crud/crud.deps';
import { DisciplinesController } from './disciplines.controller';
import { DisciplinesService } from './disciplines.service';
import { LevelsController } from './levels.controller';
import { LevelsService } from './levels.service';
import { AgeCategoriesController } from './age-categories.controller';
import { AgeCategoriesService } from './age-categories.service';
import { PaymentMethodsController } from './payment-methods.controller';
import { PaymentMethodsService } from './payment-methods.service';
import { HolidaysController } from './holidays.controller';
import { HolidaysService } from './holidays.service';

/**
 * TZ M1.3 "Maʼlumotnomalar" — the tenant-scoped reference lists every other
 * module picks from. One module rather than five: they share the same
 * policy (archive, never delete), the same permissions and the same shape,
 * and splitting them would only multiply wiring.
 *
 * R0 covers the five the roadmap names. The rest of TZ M1.3 (guruh turi,
 * reklama manbasi, oʻqish maqsadi, lead statuslari, churn reason, xarajat
 * toifasi) belongs to the R2 CRM and finance modules that read them.
 *
 * `AuditService` comes from the global AuditModule, which is what lets
 * CrudDeps be a plain provider here.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [
    DisciplinesController,
    LevelsController,
    AgeCategoriesController,
    PaymentMethodsController,
    HolidaysController,
  ],
  providers: [
    CrudDeps,
    DisciplinesService,
    LevelsService,
    AgeCategoriesService,
    PaymentMethodsService,
    HolidaysService,
  ],
  exports: [DisciplinesService, LevelsService],
})
export class ReferenceModule {}
