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
import type { Level } from '@prisma/client';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { levelListQuerySchema, type LevelListQueryDto } from './dto/level.dto';
import { parseIfMatch } from '../common/crud/optimistic-lock';
import type { Enveloped } from '../common/http/response-envelope';
import { LevelsService } from './levels.service';
import {
  createLevelSchema,
  updateLevelSchema,
  type CreateLevelDto,
  type UpdateLevelDto,
} from './dto/level.dto';

/**
 * TZ M1.3 "daraja" (level). A level with no discipline applies to all
 * of them — see dto/level.dto.ts.
 *
 * Reads need `reference.view` — every operational screen picks one of
 * these. Writes need `settings.manage`. There is no DELETE: TZ M1.3 KERAK
 * says a reference row is archived, never deleted, or the link from old
 * groups and payments breaks.
 */
@Controller('levels')
export class LevelsController {
  constructor(private readonly service: LevelsService) {}

  @RequirePermission('reference.view')
  @Get()
  list(
    @Query(new ZodValidationPipe(levelListQuerySchema)) query: LevelListQueryDto,
  ): Promise<Enveloped<Level[]>> {
    return this.service.list(query);
  }

  @RequirePermission('reference.view')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<Level> {
    return this.service.get(id);
  }

  @RequirePermission('settings.manage')
  @Post()
  create(@Body(new ZodValidationPipe(createLevelSchema)) dto: CreateLevelDto): Promise<Level> {
    return this.service.create(dto);
  }

  @RequirePermission('settings.manage')
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateLevelSchema)) dto: UpdateLevelDto,
    @Headers('if-match') ifMatch?: string,
  ): Promise<Level> {
    return this.service.update(id, parseIfMatch(ifMatch), dto);
  }

  @RequirePermission('settings.manage')
  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  archive(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('if-match') ifMatch?: string,
  ): Promise<Level> {
    return this.service.archive(id, parseIfMatch(ifMatch));
  }

  @RequirePermission('settings.manage')
  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  restore(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('if-match') ifMatch?: string,
  ): Promise<Level> {
    return this.service.restore(id, parseIfMatch(ifMatch));
  }
}
