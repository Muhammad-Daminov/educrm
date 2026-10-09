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
import type { Discipline } from '@prisma/client';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { listQuerySchema, type ListQueryDto } from '../common/crud/list-query.dto';
import { parseIfMatch } from '../common/crud/optimistic-lock';
import type { Enveloped } from '../common/http/response-envelope';
import { DisciplinesService } from './disciplines.service';
import {
  createDisciplineSchema,
  updateDisciplineSchema,
  type CreateDisciplineDto,
  type UpdateDisciplineDto,
} from './dto/discipline.dto';

/**
 * TZ M1.3 reference data. Reads need `reference.view` (every operational
 * screen picks a discipline); writes need `settings.manage`. There is no
 * DELETE — TZ M1.3 KERAK: archived, never deleted, or the link from old
 * groups and payments breaks.
 */
@Controller('disciplines')
export class DisciplinesController {
  constructor(private readonly service: DisciplinesService) {}

  @RequirePermission('reference.view')
  @Get()
  list(
    @Query(new ZodValidationPipe(listQuerySchema)) query: ListQueryDto,
  ): Promise<Enveloped<Discipline[]>> {
    return this.service.list(query);
  }

  @RequirePermission('reference.view')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<Discipline> {
    return this.service.get(id);
  }

  @RequirePermission('settings.manage')
  @Post()
  create(
    @Body(new ZodValidationPipe(createDisciplineSchema)) dto: CreateDisciplineDto,
  ): Promise<Discipline> {
    return this.service.create(dto);
  }

  @RequirePermission('settings.manage')
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateDisciplineSchema)) dto: UpdateDisciplineDto,
    @Headers('if-match') ifMatch?: string,
  ): Promise<Discipline> {
    return this.service.update(id, parseIfMatch(ifMatch), dto);
  }

  @RequirePermission('settings.manage')
  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  archive(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('if-match') ifMatch?: string,
  ): Promise<Discipline> {
    return this.service.archive(id, parseIfMatch(ifMatch));
  }

  @RequirePermission('settings.manage')
  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  restore(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('if-match') ifMatch?: string,
  ): Promise<Discipline> {
    return this.service.restore(id, parseIfMatch(ifMatch));
  }
}
