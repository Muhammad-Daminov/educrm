import { Injectable } from '@nestjs/common';
import type { Holiday, Prisma } from '@prisma/client';
import { uuidv7 } from '@educrm/shared';
import { ArchivableCrudService, type Page, type Tx } from '../common/crud/archivable-crud.service';
import { CrudDeps } from '../common/crud/crud.deps';
import { activeFilter, nameKeyFilter } from '../common/crud/list-query.dto';
import { unknownReference } from '../common/crud/crud.errors';
import {
  toCalendarDate,
  type CreateHolidayDto,
  type HolidayListQueryDto,
  type UpdateHolidayDto,
} from './dto/holiday.dto';

@Injectable()
export class HolidaysService extends ArchivableCrudService<
  Holiday,
  CreateHolidayDto,
  UpdateHolidayDto,
  HolidayListQueryDto
> {
  protected readonly entityType = 'holiday';
  /** The unique index is on (branch, date), so that is what collides. */
  protected override readonly duplicateField = 'date';

  constructor(deps: CrudDeps) {
    super(deps);
  }

  protected async findPage(query: HolidayListQueryDto): Promise<Page<Holiday>> {
    const where: Prisma.HolidayWhereInput = {
      ...activeFilter(query.is_active),
      ...nameKeyFilter(query.q),
      ...branchFilter(query.branch_id),
      ...dateRangeFilter(query.from, query.to),
    };
    const [rows, total] = await Promise.all([
      this.deps.tenantDb.holiday.findMany({
        where,
        orderBy: [{ date: 'asc' }, { nameKey: 'asc' }],
        take: query.limit,
        skip: query.offset,
      }),
      this.deps.tenantDb.holiday.count({ where }),
    ]);
    return { rows, total };
  }

  protected findOne(id: string): Promise<Holiday | null> {
    return this.deps.tenantDb.holiday.findUnique({ where: { id } });
  }

  protected findOneTx(tx: Tx, id: string): Promise<Holiday | null> {
    return tx.holiday.findUnique({ where: { id } });
  }

  protected override async validateReferences(
    dto: CreateHolidayDto | UpdateHolidayDto,
    tx: Tx,
  ): Promise<void> {
    if (typeof dto.branchId !== 'string') {
      return;
    }
    const branch = await tx.branch.findUnique({ where: { id: dto.branchId } });
    if (branch === null) {
      throw unknownReference('branchId', dto.branchId);
    }
  }

  protected insert(tx: Tx, dto: CreateHolidayDto): Promise<Holiday> {
    return tx.holiday.create({
      data: {
        id: uuidv7(),
        tenantId: this.deps.tenantId,
        name: dto.name,
        date: toCalendarDate(dto.date),
        branchId: dto.branchId ?? null,
      },
    });
  }

  protected async patch(
    tx: Tx,
    id: string,
    version: number,
    dto: UpdateHolidayDto,
  ): Promise<number> {
    const { count } = await tx.holiday.updateMany({
      where: { id, version },
      data: {
        name: dto.name,
        ...(dto.date === undefined ? {} : { date: toCalendarDate(dto.date) }),
        ...('branchId' in dto ? { branchId: dto.branchId ?? null } : {}),
        version: { increment: 1 },
      },
    });
    return count;
  }

  protected async setActive(
    tx: Tx,
    id: string,
    version: number,
    isActive: boolean,
  ): Promise<number> {
    const { count } = await tx.holiday.updateMany({
      where: { id, version },
      data: { isActive, version: { increment: 1 } },
    });
    return count;
  }
}

function branchFilter(branchId: HolidayListQueryDto['branch_id']): Prisma.HolidayWhereInput {
  if (branchId === undefined) {
    return {};
  }
  if (branchId === 'none') {
    return { branchId: null };
  }
  // A branch is closed on its own holidays *and* on the organization-wide
  // ones — which is exactly what the schedule generator needs to ask.
  return { OR: [{ branchId }, { branchId: null }] };
}

function dateRangeFilter(from?: string, to?: string): Prisma.HolidayWhereInput {
  if (from === undefined && to === undefined) {
    return {};
  }
  return {
    date: {
      ...(from === undefined ? {} : { gte: toCalendarDate(from) }),
      ...(to === undefined ? {} : { lte: toCalendarDate(to) }),
    },
  };
}
