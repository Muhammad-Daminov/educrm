import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { parseIfMatch } from '../common/crud/optimistic-lock';
import { LessonsService, type LessonView } from './lessons.service';
import {
  cancelLessonSchema,
  createLessonSchema,
  lessonListQuerySchema,
  moveLessonSchema,
  substituteTeacherSchema,
  type CancelLessonDto,
  type CreateLessonDto,
  type LessonListQueryDto,
  type MoveLessonDto,
  type SubstituteTeacherDto,
} from './dto/schedule.dto';

/** TZ M4.5–M4.6 — the calendar and the per-lesson actions. */
@Controller('lessons')
export class LessonsController {
  constructor(private readonly service: LessonsService) {}

  @RequirePermission('schedule.view')
  @Get()
  async list(
    @Query(new ZodValidationPipe(lessonListQuerySchema)) query: LessonListQueryDto,
  ): Promise<LessonView[]> {
    return this.service.list(query);
  }

  @RequirePermission('schedule.view')
  @Get(':id')
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<LessonView> {
    return this.service.get(id);
  }

  /** TZ M4.5 "qoʻshimcha dars" / makeup. */
  @RequirePermission('schedule.create')
  @Post()
  async create(
    @Body(new ZodValidationPipe(createLessonSchema)) dto: CreateLessonDto,
  ): Promise<LessonView> {
    return this.service.create(dto);
  }

  /**
   * TZ M4.5 move. Returns the *new* lesson — the drag-and-drop grid needs
   * the row it should now draw, and the old one is history.
   */
  @RequirePermission('lesson.reschedule')
  @Post(':id/move')
  @HttpCode(HttpStatus.OK)
  async move(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(moveLessonSchema)) dto: MoveLessonDto,
    @Headers('if-match') ifMatch?: string,
  ): Promise<LessonView> {
    return this.service.move(id, parseIfMatch(ifMatch), dto);
  }

  @RequirePermission('lesson.cancel')
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(cancelLessonSchema)) dto: CancelLessonDto,
    @Headers('if-match') ifMatch?: string,
  ): Promise<LessonView> {
    return this.service.cancel(id, parseIfMatch(ifMatch), dto);
  }

  @RequirePermission('lesson.substitute_teacher')
  @Post(':id/substitute')
  @HttpCode(HttpStatus.OK)
  async substitute(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(substituteTeacherSchema)) dto: SubstituteTeacherDto,
    @Headers('if-match') ifMatch?: string,
  ): Promise<LessonView> {
    return this.service.substituteTeacher(id, parseIfMatch(ifMatch), dto);
  }
}
