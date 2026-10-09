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
import type { Classroom } from '@prisma/client';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { parseIfMatch } from '../common/crud/optimistic-lock';
import type { Enveloped } from '../common/http/response-envelope';
import { ClassroomsService } from './classrooms.service';
import {
  classroomListQuerySchema,
  createClassroomSchema,
  updateClassroomSchema,
  type ClassroomListQueryDto,
  type CreateClassroomDto,
  type UpdateClassroomDto,
} from './dto/classroom.dto';

/**
 * TZ M1.2. The catalog has one write permission for rooms
 * (`classroom.manage`), so create/update/archive all use it; reads use
 * `reference.view`, because picking a room is part of scheduling and not a
 * settings activity.
 *
 * No DELETE: a room archived (is_active=false) keeps every past lesson's
 * location intact. TZ M1.2 lists is_active for exactly that reason.
 */
@Controller('classrooms')
export class ClassroomsController {
  constructor(private readonly service: ClassroomsService) {}

  @RequirePermission('reference.view')
  @Get()
  list(
    @Query(new ZodValidationPipe(classroomListQuerySchema)) query: ClassroomListQueryDto,
  ): Promise<Enveloped<Classroom[]>> {
    return this.service.list(query);
  }

  @RequirePermission('reference.view')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<Classroom> {
    return this.service.get(id);
  }

  @RequirePermission('classroom.manage')
  @Post()
  create(
    @Body(new ZodValidationPipe(createClassroomSchema)) dto: CreateClassroomDto,
  ): Promise<Classroom> {
    return this.service.create(dto);
  }

  @RequirePermission('classroom.manage')
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateClassroomSchema)) dto: UpdateClassroomDto,
    @Headers('if-match') ifMatch?: string,
  ): Promise<Classroom> {
    return this.service.update(id, parseIfMatch(ifMatch), dto);
  }

  @RequirePermission('classroom.manage')
  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  archive(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('if-match') ifMatch?: string,
  ): Promise<Classroom> {
    return this.service.archive(id, parseIfMatch(ifMatch));
  }

  @RequirePermission('classroom.manage')
  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  restore(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('if-match') ifMatch?: string,
  ): Promise<Classroom> {
    return this.service.restore(id, parseIfMatch(ifMatch));
  }
}
