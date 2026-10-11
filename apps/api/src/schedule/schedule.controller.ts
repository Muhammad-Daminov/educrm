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
  Query,
} from '@nestjs/common';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { parseIfMatch } from '../common/crud/optimistic-lock';
import {
  ScheduleRulesService,
  type SchedulePreview,
  type ScheduleRuleView,
} from './schedule-rules.service';
import { LessonsService, type AvailabilityView } from './lessons.service';
import {
  availabilityQuerySchema,
  createScheduleRuleSchema,
  previewScheduleRuleSchema,
  scheduleRuleListQuerySchema,
  updateScheduleRuleSchema,
  type AvailabilityQueryDto,
  type CreateScheduleRuleDto,
  type PreviewScheduleRuleDto,
  type ScheduleRuleListQueryDto,
  type UpdateScheduleRuleDto,
} from './dto/schedule.dto';

/** TZ M4.3 — schedule rules and the generation they drive. */
@Controller('schedule-rules')
export class ScheduleRulesController {
  constructor(private readonly service: ScheduleRulesService) {}

  @RequirePermission('schedule.view')
  @Get()
  async list(
    @Query(new ZodValidationPipe(scheduleRuleListQuerySchema)) query: ScheduleRuleListQueryDto,
  ): Promise<ScheduleRuleView[]> {
    return this.service.list(query);
  }

  @RequirePermission('schedule.view')
  @Get(':id')
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<ScheduleRuleView> {
    return this.service.get(id);
  }

  /**
   * TZ M4.3 (SHART): "saqlashdan oldin natija va konfliktlar roʻyxati".
   *
   * Also exposed without an `:id` below, because UX 4.3's group wizard
   * previews a rule that has not been created yet — which is the case the
   * requirement is actually about.
   *
   * `schedule.create` rather than `schedule.view`: it answers "what would
   * happen if I saved this", which is part of creating, and it reveals
   * other groups' room/teacher bookings.
   */
  @RequirePermission('schedule.create')
  @Post('preview')
  @HttpCode(HttpStatus.OK)
  async previewNew(
    @Body(new ZodValidationPipe(previewScheduleRuleSchema)) dto: PreviewScheduleRuleDto,
  ): Promise<SchedulePreview> {
    return this.service.preview(dto);
  }

  @RequirePermission('schedule.create')
  @Post(':id/preview')
  @HttpCode(HttpStatus.OK)
  async preview(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(previewScheduleRuleSchema)) dto: PreviewScheduleRuleDto,
  ): Promise<SchedulePreview> {
    return this.service.preview(dto, id);
  }

  @RequirePermission('schedule.create')
  @Post()
  async create(
    @Body(new ZodValidationPipe(createScheduleRuleSchema)) dto: CreateScheduleRuleDto,
  ): Promise<ScheduleRuleView> {
    return this.service.create(dto);
  }

  @RequirePermission('schedule.update')
  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateScheduleRuleSchema)) dto: UpdateScheduleRuleDto,
    @Headers('if-match') ifMatch?: string,
  ): Promise<ScheduleRuleView> {
    return this.service.update(id, parseIfMatch(ifMatch), dto);
  }

  /** Deactivates the rule and drops its future lessons; never deletes the row. */
  @RequirePermission('schedule.delete')
  @Delete(':id')
  async deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('if-match') ifMatch?: string,
  ): Promise<ScheduleRuleView> {
    return this.service.deactivate(id, parseIfMatch(ifMatch));
  }
}

/** UX 4.4 "Boʻsh resurslar" + the drag-and-drop conflict tooltip. */
@Controller('schedule')
export class ScheduleAvailabilityController {
  constructor(private readonly lessons: LessonsService) {}

  @RequirePermission('schedule.view')
  @Get('availability')
  async availability(
    @Query(new ZodValidationPipe(availabilityQuerySchema)) query: AvailabilityQueryDto,
  ): Promise<AvailabilityView> {
    return this.lessons.checkAvailability(query);
  }
}
