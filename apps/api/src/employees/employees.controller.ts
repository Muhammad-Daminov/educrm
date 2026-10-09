import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { parseIfMatch } from '../common/crud/optimistic-lock';
import type { Enveloped } from '../common/http/response-envelope';
import { EmployeesService, type EmployeeView } from './employees.service';
import {
  createEmployeeSchema,
  employeeListQuerySchema,
  setBranchesSchema,
  setRolesSchema,
  setTeacherProfileSchema,
  updateEmployeeSchema,
  type CreateEmployeeDto,
  type EmployeeListQueryDto,
  type SetBranchesDto,
  type SetRolesDto,
  type SetTeacherProfileDto,
  type UpdateEmployeeDto,
} from './dto/employee.dto';

/**
 * TZ M1.4. Role and branch assignment are PUT sub-resources rather than
 * fields on the employee body: they are the two changes that alter what
 * someone can see and do, so they get their own endpoints, their own audit
 * actions, and (for roles) `employee.update` rather than being reachable
 * through a generic form save.
 *
 * No DELETE — TZ M1.4 SHART: deactivation only, which also revokes every
 * session.
 */
@Controller('employees')
export class EmployeesController {
  constructor(private readonly service: EmployeesService) {}

  @RequirePermission('employee.view')
  @Get()
  list(
    @Query(new ZodValidationPipe(employeeListQuerySchema)) query: EmployeeListQueryDto,
  ): Promise<Enveloped<EmployeeView[]>> {
    return this.service.list(query);
  }

  @RequirePermission('employee.view')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<EmployeeView> {
    return this.service.get(id);
  }

  @RequirePermission('employee.create')
  @Post()
  create(
    @Body(new ZodValidationPipe(createEmployeeSchema)) dto: CreateEmployeeDto,
  ): Promise<EmployeeView> {
    return this.service.create(dto);
  }

  @RequirePermission('employee.update')
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateEmployeeSchema)) dto: UpdateEmployeeDto,
    @Headers('if-match') ifMatch?: string,
  ): Promise<EmployeeView> {
    return this.service.update(id, parseIfMatch(ifMatch), dto);
  }

  /**
   * `role.manage` rather than `employee.update`: TZ 3.2 keeps role
   * management as its own permission, and the whole point of that
   * separation is that handing out permissions is not an ordinary edit.
   */
  @RequirePermission('role.manage')
  @Put(':id/roles')
  setRoles(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(setRolesSchema)) dto: SetRolesDto,
  ): Promise<EmployeeView> {
    return this.service.setRoles(id, dto);
  }

  @RequirePermission('employee.update')
  @Put(':id/branches')
  setBranches(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(setBranchesSchema)) dto: SetBranchesDto,
  ): Promise<EmployeeView> {
    return this.service.setBranches(id, dto);
  }

  @RequirePermission('employee.update')
  @Put(':id/teacher-profile')
  setTeacherProfile(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(setTeacherProfileSchema)) dto: SetTeacherProfileDto,
  ): Promise<EmployeeView> {
    return this.service.setTeacherProfile(id, dto);
  }

  @RequirePermission('employee.deactivate')
  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('if-match') ifMatch?: string,
  ): Promise<EmployeeView> {
    return this.service.deactivate(id, parseIfMatch(ifMatch));
  }

  @RequirePermission('employee.deactivate')
  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  activate(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('if-match') ifMatch?: string,
  ): Promise<EmployeeView> {
    return this.service.activate(id, parseIfMatch(ifMatch));
  }
}
