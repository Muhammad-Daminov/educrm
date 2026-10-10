import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { CrudDeps } from '../common/crud/crud.deps';
import { StudyUnitsController } from './study-units.controller';
import { StudyUnitsService } from './study-units.service';

/** TZ M4.1/M4.2 — study_units + enrollments (T07). */
@Module({
  imports: [DatabaseModule],
  controllers: [StudyUnitsController],
  providers: [CrudDeps, StudyUnitsService],
})
export class UnitsModule {}
