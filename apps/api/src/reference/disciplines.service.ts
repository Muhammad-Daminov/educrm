import { Injectable } from '@nestjs/common';
import type { Discipline, Prisma } from '@prisma/client';
import { uuidv7 } from '@educrm/shared';
import { ArchivableCrudService, type Page, type Tx } from '../common/crud/archivable-crud.service';
import { CrudDeps } from '../common/crud/crud.deps';
import { activeFilter, nameKeyFilter, type ListQueryDto } from '../common/crud/list-query.dto';
import type { CreateDisciplineDto, UpdateDisciplineDto } from './dto/discipline.dto';

@Injectable()
export class DisciplinesService extends ArchivableCrudService<
  Discipline,
  CreateDisciplineDto,
  UpdateDisciplineDto
> {
  protected readonly entityType = 'discipline';

  constructor(deps: CrudDeps) {
    super(deps);
  }

  protected async findPage(query: ListQueryDto): Promise<Page<Discipline>> {
    const where: Prisma.DisciplineWhereInput = {
      ...activeFilter(query.is_active),
      ...nameKeyFilter(query.q),
    };
    // Two reads, two transactions: `total` is a count for a header, not a
    // value anything is computed from, so it does not need to be consistent
    // with the page to the row.
    const [rows, total] = await Promise.all([
      this.deps.tenantDb.discipline.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { nameKey: 'asc' }],
        take: query.limit,
        skip: query.offset,
      }),
      this.deps.tenantDb.discipline.count({ where }),
    ]);
    return { rows, total };
  }

  protected findOne(id: string): Promise<Discipline | null> {
    return this.deps.tenantDb.discipline.findUnique({ where: { id } });
  }

  protected findOneTx(tx: Tx, id: string): Promise<Discipline | null> {
    return tx.discipline.findUnique({ where: { id } });
  }

  protected insert(tx: Tx, dto: CreateDisciplineDto): Promise<Discipline> {
    return tx.discipline.create({
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
    dto: UpdateDisciplineDto,
  ): Promise<number> {
    const { count } = await tx.discipline.updateMany({
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
    const { count } = await tx.discipline.updateMany({
      where: { id, version },
      data: { isActive, version: { increment: 1 } },
    });
    return count;
  }
}
