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
import type { PaymentMethod } from '@prisma/client';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { listQuerySchema, type ListQueryDto } from '../common/crud/list-query.dto';
import { parseIfMatch } from '../common/crud/optimistic-lock';
import type { Enveloped } from '../common/http/response-envelope';
import { PaymentMethodsService } from './payment-methods.service';
import {
  createPaymentMethodSchema,
  updatePaymentMethodSchema,
  type CreatePaymentMethodDto,
  type UpdatePaymentMethodDto,
} from './dto/payment-method.dto';

/**
 * TZ M1.3 "toʻlov usuli" (payment method).
 *
 * Reads need `reference.view` — every operational screen picks one of
 * these. Writes need `settings.manage`. There is no DELETE: TZ M1.3 KERAK
 * says a reference row is archived, never deleted, or the link from old
 * groups and payments breaks.
 */
@Controller('payment-methods')
export class PaymentMethodsController {
  constructor(private readonly service: PaymentMethodsService) {}

  @RequirePermission('reference.view')
  @Get()
  list(
    @Query(new ZodValidationPipe(listQuerySchema)) query: ListQueryDto,
  ): Promise<Enveloped<PaymentMethod[]>> {
    return this.service.list(query);
  }

  @RequirePermission('reference.view')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<PaymentMethod> {
    return this.service.get(id);
  }

  @RequirePermission('settings.manage')
  @Post()
  create(
    @Body(new ZodValidationPipe(createPaymentMethodSchema)) dto: CreatePaymentMethodDto,
  ): Promise<PaymentMethod> {
    return this.service.create(dto);
  }

  @RequirePermission('settings.manage')
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updatePaymentMethodSchema)) dto: UpdatePaymentMethodDto,
    @Headers('if-match') ifMatch?: string,
  ): Promise<PaymentMethod> {
    return this.service.update(id, parseIfMatch(ifMatch), dto);
  }

  @RequirePermission('settings.manage')
  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  archive(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('if-match') ifMatch?: string,
  ): Promise<PaymentMethod> {
    return this.service.archive(id, parseIfMatch(ifMatch));
  }

  @RequirePermission('settings.manage')
  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  restore(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('if-match') ifMatch?: string,
  ): Promise<PaymentMethod> {
    return this.service.restore(id, parseIfMatch(ifMatch));
  }
}
