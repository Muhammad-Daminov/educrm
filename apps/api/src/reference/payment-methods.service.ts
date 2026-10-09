import { Injectable } from '@nestjs/common';
import type { PaymentMethod, Prisma } from '@prisma/client';
import { uuidv7 } from '@educrm/shared';
import { ArchivableCrudService, type Page, type Tx } from '../common/crud/archivable-crud.service';
import { CrudDeps } from '../common/crud/crud.deps';
import { activeFilter, nameKeyFilter, type ListQueryDto } from '../common/crud/list-query.dto';
import type { CreatePaymentMethodDto, UpdatePaymentMethodDto } from './dto/payment-method.dto';

@Injectable()
export class PaymentMethodsService extends ArchivableCrudService<
  PaymentMethod,
  CreatePaymentMethodDto,
  UpdatePaymentMethodDto
> {
  protected readonly entityType = 'payment_method';

  constructor(deps: CrudDeps) {
    super(deps);
  }

  protected async findPage(query: ListQueryDto): Promise<Page<PaymentMethod>> {
    const where: Prisma.PaymentMethodWhereInput = {
      ...activeFilter(query.is_active),
      ...nameKeyFilter(query.q),
    };
    const [rows, total] = await Promise.all([
      this.deps.tenantDb.paymentMethod.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { nameKey: 'asc' }],
        take: query.limit,
        skip: query.offset,
      }),
      this.deps.tenantDb.paymentMethod.count({ where }),
    ]);
    return { rows, total };
  }

  protected findOne(id: string): Promise<PaymentMethod | null> {
    return this.deps.tenantDb.paymentMethod.findUnique({ where: { id } });
  }

  protected findOneTx(tx: Tx, id: string): Promise<PaymentMethod | null> {
    return tx.paymentMethod.findUnique({ where: { id } });
  }

  protected insert(tx: Tx, dto: CreatePaymentMethodDto): Promise<PaymentMethod> {
    return tx.paymentMethod.create({
      data: {
        id: uuidv7(),
        tenantId: this.deps.tenantId,
        name: dto.name,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  protected async patch(
    tx: Tx,
    id: string,
    version: number,
    dto: UpdatePaymentMethodDto,
  ): Promise<number> {
    const { count } = await tx.paymentMethod.updateMany({
      where: { id, version },
      data: { name: dto.name, sortOrder: dto.sortOrder, version: { increment: 1 } },
    });
    return count;
  }

  protected async setActive(
    tx: Tx,
    id: string,
    version: number,
    isActive: boolean,
  ): Promise<number> {
    const { count } = await tx.paymentMethod.updateMany({
      where: { id, version },
      data: { isActive, version: { increment: 1 } },
    });
    return count;
  }
}
