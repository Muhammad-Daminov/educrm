import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { CrudDeps } from '../common/crud/crud.deps';
import { StudentsController } from './students.controller';
import { StudentsService } from './students.service';
import { StudentsImportController } from './import/students-import.controller';
import { StudentsImportService } from './import/students-import.service';

/** TZ M3. Imports AuthModule for PermissionsService/RequestUserService —
 * the contact-field visibility gate (TZ M11.2) needs the caller's
 * effective permissions, not just the route-level @RequirePermission. */
@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [StudentsController, StudentsImportController],
  providers: [CrudDeps, StudentsService, StudentsImportService],
})
export class StudentsModule {}
