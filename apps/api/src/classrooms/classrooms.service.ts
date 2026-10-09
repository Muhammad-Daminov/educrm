import { Injectable } from '@nestjs/common';
import type { Classroom, Prisma } from '@prisma/client';
import { uuidv7 } from '@educrm/shared';
import { ArchivableCrudService, type Page, type Tx } from '../common/crud/archivable-crud.service';
import { CrudDeps } from '../common/crud/crud.deps';
import { activeFilter, nameKeyFilter } from '../common/crud/list-query.dto';
import { unknownReference } from '../common/crud/crud.errors';
import type {
  ClassroomListQueryDto,
  CreateClassroomDto,
  UpdateClassroomDto,
} from './dto/classroom.dto';

@Injectable()
export class ClassroomsService extends ArchivableCrudService<
  Classroom,
  CreateClassroomDto,
  UpdateClassroomDto,
  ClassroomListQueryDto
> {
  protected readonly entityType = 'classroom';

  constructor(deps: CrudDeps) {
    super(deps);
  }

  protected async findPage(query: ClassroomListQueryDto): Promise<Page<Classroom>> {
    const where: Prisma.ClassroomWhereInput = {
      ...activeFilter(query.is_active),
      ...nameKeyFilter(query.q),
      ...(query.branch_id === undefined ? {} : { branchId: query.branch_id }),
    };
    const [rows, total] = await Promise.all([
      this.deps.tenantDb.classroom.findMany({
        where,
        // Grouped by branch, then by the TZ 8.5 name key — which is what
        // makes "Xona 10" come after "Xona 9" rather than before it only
        // when someone remembered to pad the number.
        orderBy: [{ branchId: 'asc' }, { nameKey: 'asc' }],
        take: query.limit,
        skip: query.offset,
      }),
      this.deps.tenantDb.classroom.count({ where }),
    ]);
    return { rows, total };
  }

  protected findOne(id: string): Promise<Classroom | null> {
    return this.deps.tenantDb.classroom.findUnique({ where: { id } });
  }

  protected findOneTx(tx: Tx, id: string): Promise<Classroom | null> {
    return tx.classroom.findUnique({ where: { id } });
  }

  protected override async validateReferences(
    dto: CreateClassroomDto | UpdateClassroomDto,
    tx: Tx,
  ): Promise<void> {
    if (!('branchId' in dto)) {
      return;
    }
    const branch = await tx.branch.findUnique({ where: { id: dto.branchId } });
    if (branch === null) {
      throw unknownReference('branchId', dto.branchId);
    }
  }

  protected insert(tx: Tx, dto: CreateClassroomDto): Promise<Classroom> {
    return tx.classroom.create({
      data: {
        id: uuidv7(),
        tenantId: this.deps.tenantId,
        branchId: dto.branchId,
        name: dto.name,
        capacity: dto.capacity ?? null,
        equipment: dto.equipment ?? null,
      },
    });
  }

  protected async patch(
    tx: Tx,
    id: string,
    version: number,
    dto: UpdateClassroomDto,
  ): Promise<number> {
    const { count } = await tx.classroom.updateMany({
      where: { id, version },
      data: {
        name: dto.name,
        ...('capacity' in dto ? { capacity: dto.capacity ?? null } : {}),
        ...('equipment' in dto ? { equipment: dto.equipment ?? null } : {}),
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
    const { count } = await tx.classroom.updateMany({
      where: { id, version },
      data: { isActive, version: { increment: 1 } },
    });
    return count;
  }
}
