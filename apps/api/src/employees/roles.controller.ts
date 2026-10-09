import { Controller, Get } from '@nestjs/common';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { RolesService, type RoleView } from './roles.service';

/**
 * The role list the employee form's picker needs. Read-only in R0: roles
 * are seeded per tenant from the TZ 3.1 templates, and editing a role's
 * permission matrix is the `role.manage` screen R1 adds.
 *
 * Gated on `employee.view` rather than `role.manage`: you need to see which
 * roles exist to make sense of the employee list, and a role's name and
 * permission codes are not sensitive. *Assigning* one still needs
 * `role.manage` — see EmployeesController.
 */
@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @RequirePermission('employee.view')
  @Get()
  list(): Promise<RoleView[]> {
    return this.roles.list();
  }
}
