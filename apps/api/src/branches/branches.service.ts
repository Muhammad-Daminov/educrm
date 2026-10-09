import { Injectable } from '@nestjs/common';
import type { Branch, Prisma } from '@prisma/client';
import { uuidv7 } from '@educrm/shared';
import { ArchivableCrudService, type Page, type Tx } from '../common/crud/archivable-crud.service';
import { CrudDeps } from '../common/crud/crud.deps';
import { activeFilter, nameKeyFilter, type ListQueryDto } from '../common/crud/list-query.dto';
import { duplicateName } from '../common/crud/crud.errors';
import type { CreateBranchDto, UpdateBranchDto } from './dto/create-branch.dto';

const DEFAULT_TIMEZONE = 'Asia/Tashkent';

@Injectable()
export class BranchesService extends ArchivableCrudService<
  Branch,
  CreateBranchDto,
  UpdateBranchDto
> {
  protected readonly entityType = 'branch';

  constructor(deps: CrudDeps) {
    super(deps);
  }

  protected async findPage(query: ListQueryDto): Promise<Page<Branch>> {
    const where: Prisma.BranchWhereInput = {
      ...activeFilter(query.is_active),
      ...nameKeyFilter(query.q),
    };
    const [rows, total] = await Promise.all([
      this.deps.tenantDb.branch.findMany({
        where,
        orderBy: [{ nameKey: 'asc' }],
        take: query.limit,
        skip: query.offset,
      }),
      this.deps.tenantDb.branch.count({ where }),
    ]);
    return { rows, total };
  }

  protected findOne(id: string): Promise<Branch | null> {
    return this.deps.tenantDb.branch.findUnique({ where: { id } });
  }

  protected findOneTx(tx: Tx, id: string): Promise<Branch | null> {
    return tx.branch.findUnique({ where: { id } });
  }

  /**
   * `code` has its own unique index (tenant_id, code) and its own
   * field-level error: a collision there is a different fix for the user
   * than a name collision, and both can happen in one form submission.
   */
  protected override async validateReferences(
    dto: CreateBranchDto | UpdateBranchDto,
    tx: Tx,
    id?: string,
  ): Promise<void> {
    if (dto.code === undefined) {
      return;
    }
    const existing = await tx.branch.findFirst({ where: { code: dto.code } });
    // A PATCH that re-sends the branch's own code must not collide with
    // itself, which is why the hook is told which row is being updated.
    if (existing !== null && existing.id !== id) {
      throw duplicateName('branch', 'code', dto.code);
    }
  }

  protected insert(tx: Tx, dto: CreateBranchDto): Promise<Branch> {
    return tx.branch.create({
      data: {
        id: uuidv7(),
        tenantId: this.deps.tenantId,
        name: dto.name,
        code: dto.code,
        address: dto.address ?? null,
        phone: dto.phone ?? null,
        timezone: dto.timezone ?? DEFAULT_TIMEZONE,
      },
    });
  }

  protected async patch(
    tx: Tx,
    id: string,
    version: number,
    dto: UpdateBranchDto,
  ): Promise<number> {
    const { count } = await tx.branch.updateMany({
      where: { id, version },
      data: {
        name: dto.name,
        code: dto.code,
        ...('address' in dto ? { address: dto.address ?? null } : {}),
        ...('phone' in dto ? { phone: dto.phone ?? null } : {}),
        timezone: dto.timezone,
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
    const { count } = await tx.branch.updateMany({
      where: { id, version },
      data: { isActive, version: { increment: 1 } },
    });
    return count;
  }
}
