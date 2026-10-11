import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { CrudDeps } from '../common/crud/crud.deps';
import { ScheduleAvailabilityService } from './schedule-availability.service';
import { ScheduleRulesService } from './schedule-rules.service';
import { ScheduleHorizonService } from './schedule-horizon.service';
import { LessonsService } from './lessons.service';
import { ScheduleAvailabilityController, ScheduleRulesController } from './schedule.controller';
import { LessonsController } from './lessons.controller';

/** TZ M4.3–M4.7 — schedule rules, materialized lessons, conflict control (T08). */
@Module({
  imports: [DatabaseModule],
  controllers: [ScheduleRulesController, ScheduleAvailabilityController, LessonsController],
  providers: [
    CrudDeps,
    ScheduleAvailabilityService,
    ScheduleRulesService,
    LessonsService,
    // Worker-only (it checks APP_ROLE itself), but registered here so the
    // single AppModule builds in both processes — same arrangement as
    // AuditPartitionService and OutboxDispatcher.
    ScheduleHorizonService,
  ],
  exports: [ScheduleRulesService],
})
export class ScheduleModule {}
