import {
  Body,
  Controller,
  Delete,
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
import { PermissionsService } from '../auth/permissions.service';
import { RequestUserService } from '../auth/request-user.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { parseIfMatch } from '../common/crud/optimistic-lock';
import type { Enveloped } from '../common/http/response-envelope';
import { StudentsService, type ContactPersonView, type StudentView } from './students.service';
import {
  checkPhoneQuerySchema,
  createContactPersonSchema,
  createStudentSchema,
  setPhonesSchema,
  studentListQuerySchema,
  updateContactPersonSchema,
  updateStudentSchema,
  type CheckPhoneQueryDto,
  type CreateContactPersonDto,
  type CreateStudentDto,
  type SetPhonesDto,
  type StudentListQueryDto,
  type UpdateContactPersonDto,
  type UpdateStudentDto,
} from './dto/student.dto';

/**
 * TZ M3. Contact fields (`phones`, `contactPersons`) are hidden from the
 * response for a caller without `student.view_contacts` (TZ M11.2) rather
 * than checked per field in the controller — `StudentsService` decides, and
 * every handler here just forwards whatever `PermissionsService` says about
 * the current caller.
 */
@Controller('students')
export class StudentsController {
  constructor(
    private readonly service: StudentsService,
    private readonly permissions: PermissionsService,
    private readonly requestUser: RequestUserService,
  ) {}

  @RequirePermission('student.view')
  @Get()
  async list(
    @Query(new ZodValidationPipe(studentListQuerySchema)) query: StudentListQueryDto,
  ): Promise<Enveloped<StudentView[]>> {
    return this.service.list(query, await this.canViewContacts());
  }

  @RequirePermission('student.view')
  @Get('check-phone')
  async checkPhone(
    @Query(new ZodValidationPipe(checkPhoneQuerySchema)) query: CheckPhoneQueryDto,
  ): Promise<{ clientId: string; studentId: string | null; fullName: string } | null> {
    return this.service.checkPhone(query.phone);
  }

  @RequirePermission('student.view')
  @Get(':id')
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<StudentView> {
    return this.service.get(id, await this.canViewContacts());
  }

  @RequirePermission('student.create')
  @Post()
  async create(
    @Body(new ZodValidationPipe(createStudentSchema)) dto: CreateStudentDto,
  ): Promise<StudentView> {
    return this.service.create(dto, await this.canViewContacts());
  }

  @RequirePermission('student.update')
  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateStudentSchema)) dto: UpdateStudentDto,
    @Headers('if-match') ifMatch?: string,
  ): Promise<StudentView> {
    return this.service.update(id, parseIfMatch(ifMatch), dto, await this.canViewContacts());
  }

  @RequirePermission('student.update')
  @Put(':id/phones')
  async setPhones(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(setPhonesSchema)) dto: SetPhonesDto,
  ): Promise<StudentView> {
    return this.service.setPhones(id, dto, await this.canViewContacts());
  }

  @RequirePermission('student.archive')
  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  async archive(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('if-match') ifMatch?: string,
  ): Promise<StudentView> {
    return this.service.archive(id, parseIfMatch(ifMatch), await this.canViewContacts());
  }

  @RequirePermission('student.archive')
  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  async restore(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('if-match') ifMatch?: string,
  ): Promise<StudentView> {
    return this.service.restore(id, parseIfMatch(ifMatch), await this.canViewContacts());
  }

  @RequirePermission('student.update')
  @Post(':id/contact-persons')
  createContactPerson(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(createContactPersonSchema)) dto: CreateContactPersonDto,
  ): Promise<ContactPersonView> {
    return this.service.createContactPerson(id, dto);
  }

  @RequirePermission('student.update')
  @Patch(':id/contact-persons/:contactId')
  updateContactPerson(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @Body(new ZodValidationPipe(updateContactPersonSchema)) dto: UpdateContactPersonDto,
    @Headers('if-match') ifMatch?: string,
  ): Promise<ContactPersonView> {
    return this.service.updateContactPerson(id, contactId, parseIfMatch(ifMatch), dto);
  }

  /**
   * 200 with a body, not 204: the TZ 6.2 envelope wraps every success
   * response, and a 204 is defined to carry none — `fetch()` in the browser
   * rejects a body on that status code outright.
   */
  @RequirePermission('student.update')
  @Delete(':id/contact-persons/:contactId')
  @HttpCode(HttpStatus.OK)
  async deleteContactPerson(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('contactId', ParseUUIDPipe) contactId: string,
  ): Promise<{ deleted: true }> {
    await this.service.deleteContactPerson(id, contactId);
    return { deleted: true };
  }

  private async canViewContacts(): Promise<boolean> {
    const actor = this.requestUser.current;
    if (actor === undefined) {
      return false;
    }
    const effective = await this.permissions.getEffectivePermissions(actor.tenantId, actor.userId);
    return this.permissions.hasPermission(effective, 'student.view_contacts');
  }
}
