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
import type { Holiday } from '@prisma/client';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { holidayListQuerySchema, type HolidayListQueryDto } from './dto/holiday.dto';
import { parseIfMatch } from '../common/crud/optimistic-lock';
import type { Enveloped } from '../common/http/response-envelope';
import { HolidaysService } from './holidays.service';
import {
  createHolidaySchema,
  updateHolidaySchema,
  type CreateHolidayDto,
  type UpdateHolidayDto,
} from './dto/holiday.dto';

/**
 * TZ M1.3 "bayramlar" (holidays). Lesson materialization skips these
 * dates (T08 / TZ M4.3), so this list is a scheduling input.
 *
 * Reads need `reference.view` — every operational screen picks one of
 * these. Writes need `settings.manage`. There is no DELETE: TZ M1.3 KERAK
 * says a reference row is archived, never deleted, or the link from old
 * groups and payments breaks.
 */
@Controller('holidays')
export class HolidaysController {
  constructor(private readonly service: HolidaysService) {}

  @RequirePermission('reference.view')
  @Get()
  list(
    @Query(new ZodValidationPipe(holidayListQuerySchema)) query: HolidayListQueryDto,
  ): Promise<Enveloped<Holiday[]>> {
    return this.service.list(query);
  }

  @RequirePermission('reference.view')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<Holiday> {
    return this.service.get(id);
  }

  @RequirePermission('settings.manage')
  @Post()
  create(
    @Body(new ZodValidationPipe(createHolidaySchema)) dto: CreateHolidayDto,
  ): Promise<Holiday> {
    return this.service.create(dto);
  }

  @RequirePermission('settings.manage')
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateHolidaySchema)) dto: UpdateHolidayDto,
    @Headers('if-match') ifMatch?: string,
  ): Promise<Holiday> {
    return this.service.update(id, parseIfMatch(ifMatch), dto);
  }

  @RequirePermission('settings.manage')
  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  archive(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('if-match') ifMatch?: string,
  ): Promise<Holiday> {
    return this.service.archive(id, parseIfMatch(ifMatch));
  }

  @RequirePermission('settings.manage')
  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  restore(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('if-match') ifMatch?: string,
  ): Promise<Holiday> {
    return this.service.restore(id, parseIfMatch(ifMatch));
  }
}
