import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { CrudDeps } from '../common/crud/crud.deps';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';

/**
 * TZ M1.4. Imports AuthModule for PasswordService, SessionService and
 * PermissionsService: creating an employee hashes a password, deactivating
 * one revokes its sessions, and both role and branch changes have to drop
 * the cached permissions.
 */
@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [EmployeesController, RolesController],
  providers: [CrudDeps, EmployeesService, RolesService],
})
export class EmployeesModule {}
