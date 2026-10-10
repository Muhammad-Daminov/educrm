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
  Query,
} from '@nestjs/common';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { parseIfMatch } from '../common/crud/optimistic-lock';
import type { Enveloped } from '../common/http/response-envelope';
import { StudyUnitsService, type EnrollmentView, type StudyUnitView } from './study-units.service';
import {
  cancelEnrollmentSchema,
  changeStudyUnitStatusSchema,
  createEnrollmentSchema,
  createStudyUnitSchema,
  finishEnrollmentSchema,
  studyUnitListQuerySchema,
  transferEnrollmentSchema,
  updateStudyUnitSchema,
  type CancelEnrollmentDto,
  type ChangeStudyUnitStatusDto,
  type CreateEnrollmentDto,
  type CreateStudyUnitDto,
  type FinishEnrollmentDto,
  type StudyUnitListQueryDto,
  type TransferEnrollmentDto,
  type UpdateStudyUnitDto,
} from './dto/study-unit.dto';

/** TZ M4.1/M4.2. UX 4.3 group list + group detail with members. */
@Controller('study-units')
export class StudyUnitsController {
  constructor(private readonly service: StudyUnitsService) {}

  @RequirePermission('study_unit.view')
  @Get()
  async list(
    @Query(new ZodValidationPipe(studyUnitListQuerySchema)) query: StudyUnitListQueryDto,
  ): Promise<Enveloped<StudyUnitView[]>> {
    return this.service.list(query);
  }

  @RequirePermission('study_unit.view')
  @Get(':id')
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<StudyUnitView> {
    return this.service.get(id);
  }

  @RequirePermission('study_unit.create')
  @Post()
  async create(
    @Body(new ZodValidationPipe(createStudyUnitSchema)) dto: CreateStudyUnitDto,
  ): Promise<StudyUnitView> {
    return this.service.create(dto);
  }

  @RequirePermission('study_unit.update')
  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateStudyUnitSchema)) dto: UpdateStudyUnitDto,
    @Headers('if-match') ifMatch?: string,
  ): Promise<StudyUnitView> {
    return this.service.update(id, parseIfMatch(ifMatch), dto);
  }

  @RequirePermission('study_unit.change_status')
  @Post(':id/status')
  @HttpCode(HttpStatus.OK)
  async changeStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(changeStudyUnitStatusSchema)) dto: ChangeStudyUnitStatusDto,
    @Headers('if-match') ifMatch?: string,
  ): Promise<StudyUnitView> {
    return this.service.changeStatus(id, parseIfMatch(ifMatch), dto);
  }

  @RequirePermission('study_unit.manage_members')
  @Post(':id/enrollments')
  async addEnrollment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(createEnrollmentSchema)) dto: CreateEnrollmentDto,
  ): Promise<EnrollmentView> {
    return this.service.addEnrollment(id, dto);
  }

  @RequirePermission('study_unit.manage_members')
  @Post(':id/enrollments/:enrollmentId/transfer')
  @HttpCode(HttpStatus.OK)
  async transfer(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('enrollmentId', ParseUUIDPipe) enrollmentId: string,
    @Body(new ZodValidationPipe(transferEnrollmentSchema)) dto: TransferEnrollmentDto,
    @Headers('if-match') ifMatch?: string,
  ): Promise<EnrollmentView> {
    return this.service.transferEnrollment(id, enrollmentId, parseIfMatch(ifMatch), dto);
  }

  /** BR-E3: "remove member" — cancels, never hard-deletes. */
  @RequirePermission('study_unit.manage_members')
  @Post(':id/enrollments/:enrollmentId/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('enrollmentId', ParseUUIDPipe) enrollmentId: string,
    @Body(new ZodValidationPipe(cancelEnrollmentSchema)) dto: CancelEnrollmentDto,
    @Headers('if-match') ifMatch?: string,
  ): Promise<EnrollmentView> {
    return this.service.cancelEnrollment(id, enrollmentId, parseIfMatch(ifMatch), dto);
  }

  @RequirePermission('study_unit.manage_members')
  @Post(':id/enrollments/:enrollmentId/finish')
  @HttpCode(HttpStatus.OK)
  async finish(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('enrollmentId', ParseUUIDPipe) enrollmentId: string,
    @Body(new ZodValidationPipe(finishEnrollmentSchema)) dto: FinishEnrollmentDto,
    @Headers('if-match') ifMatch?: string,
  ): Promise<EnrollmentView> {
    return this.service.finishEnrollment(id, enrollmentId, parseIfMatch(ifMatch), dto);
  }

  @RequirePermission('enrollment.freeze')
  @Post(':id/enrollments/:enrollmentId/freeze')
  @HttpCode(HttpStatus.OK)
  async freeze(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('enrollmentId', ParseUUIDPipe) enrollmentId: string,
    @Headers('if-match') ifMatch?: string,
  ): Promise<EnrollmentView> {
    return this.service.freezeEnrollment(id, enrollmentId, parseIfMatch(ifMatch));
  }

  @RequirePermission('enrollment.freeze')
  @Post(':id/enrollments/:enrollmentId/unfreeze')
  @HttpCode(HttpStatus.OK)
  async unfreeze(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('enrollmentId', ParseUUIDPipe) enrollmentId: string,
    @Headers('if-match') ifMatch?: string,
  ): Promise<EnrollmentView> {
    return this.service.unfreezeEnrollment(id, enrollmentId, parseIfMatch(ifMatch));
  }
}
