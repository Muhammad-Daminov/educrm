import { Injectable } from '@nestjs/common';
import type { Level, Prisma } from '@prisma/client';
import { uuidv7 } from '@educrm/shared';
import { ArchivableCrudService, type Page, type Tx } from '../common/crud/archivable-crud.service';
import { CrudDeps } from '../common/crud/crud.deps';
import { activeFilter, nameKeyFilter } from '../common/crud/list-query.dto';
import { unknownReference } from '../common/crud/crud.errors';
import type { CreateLevelDto, LevelListQueryDto, UpdateLevelDto } from './dto/level.dto';

@Injectable()
export class LevelsService extends ArchivableCrudService<
  Level,
  CreateLevelDto,
  UpdateLevelDto,
  LevelListQueryDto
> {
  protected readonly entityType = 'level';

  constructor(deps: CrudDeps) {
    super(deps);
  }

  protected async findPage(query: LevelListQueryDto): Promise<Page<Level>> {
    const where: Prisma.LevelWhereInput = {
      ...activeFilter(query.is_active),
      ...nameKeyFilter(query.q),
      ...disciplineFilter(query.discipline_id),
    };
    const [rows, total] = await Promise.all([
      this.deps.tenantDb.level.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { nameKey: 'asc' }],
        take: query.limit,
        skip: query.offset,
      }),
      this.deps.tenantDb.level.count({ where }),
    ]);
    return { rows, total };
  }

  protected findOne(id: string): Promise<Level | null> {
    return this.deps.tenantDb.level.findUnique({ where: { id } });
  }

  protected findOneTx(tx: Tx, id: string): Promise<Level | null> {
    return tx.level.findUnique({ where: { id } });
  }

  /**
   * The composite (tenant_id, discipline_id) FK already makes a
   * cross-tenant parent impossible, so this check exists for the *message*:
   * a 404 naming the field is what UX P6 puts next to the input, where a
   * raw FK violation would surface as a 500.
   */
  protected override async validateReferences(
    dto: CreateLevelDto | UpdateLevelDto,
    tx: Tx,
  ): Promise<void> {
    if (typeof dto.disciplineId !== 'string') {
      return;
    }
    const discipline = await tx.discipline.findUnique({ where: { id: dto.disciplineId } });
    if (discipline === null) {
      throw unknownReference('disciplineId', dto.disciplineId);
    }
  }

  protected insert(tx: Tx, dto: CreateLevelDto): Promise<Level> {
    return tx.level.create({
      data: {
        id: uuidv7(),
        tenantId: this.deps.tenantId,
        name: dto.name,
        disciplineId: dto.disciplineId ?? null,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  protected async patch(tx: Tx, id: string, version: number, dto: UpdateLevelDto): Promise<number> {
    const { count } = await tx.level.updateMany({
      where: { id, version },
      data: {
        name: dto.name,
        // `undefined` leaves it alone, `null` detaches it from its
        // discipline — both are meaningful, so the key is only included
        // when the client sent it.
        ...('disciplineId' in dto ? { disciplineId: dto.disciplineId ?? null } : {}),
        sortOrder: dto.sortOrder,
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
    const { count } = await tx.level.updateMany({
      where: { id, version },
      data: { isActive, version: { increment: 1 } },
    });
    return count;
  }
}

function disciplineFilter(
  disciplineId: LevelListQueryDto['discipline_id'],
): Prisma.LevelWhereInput {
  if (disciplineId === undefined) {
    return {};
  }
  // "Barcha fanlar uchun" levels, which carry no discipline at all.
  if (disciplineId === 'none') {
    return { disciplineId: null };
  }
  // A discipline's own levels *plus* the organization-wide ones: a group in
  // "Ingliz tili" can legitimately be graded A1..C2 from the shared ladder.
  return { OR: [{ disciplineId }, { disciplineId: null }] };
}
