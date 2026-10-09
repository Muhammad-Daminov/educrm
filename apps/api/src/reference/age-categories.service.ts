import { BadRequestException, Injectable } from '@nestjs/common';
import type { AgeCategory, Prisma } from '@prisma/client';
import { uuidv7 } from '@educrm/shared';
import { ArchivableCrudService, type Page, type Tx } from '../common/crud/archivable-crud.service';
import { CrudDeps } from '../common/crud/crud.deps';
import { activeFilter, nameKeyFilter, type ListQueryDto } from '../common/crud/list-query.dto';
import type { CreateAgeCategoryDto, UpdateAgeCategoryDto } from './dto/age-category.dto';

@Injectable()
export class AgeCategoriesService extends ArchivableCrudService<
  AgeCategory,
  CreateAgeCategoryDto,
  UpdateAgeCategoryDto
> {
  protected readonly entityType = 'age_category';

  constructor(deps: CrudDeps) {
    super(deps);
  }

  protected async findPage(query: ListQueryDto): Promise<Page<AgeCategory>> {
    const where: Prisma.AgeCategoryWhereInput = {
      ...activeFilter(query.is_active),
      ...nameKeyFilter(query.q),
    };
    const [rows, total] = await Promise.all([
      this.deps.tenantDb.ageCategory.findMany({
        where,
        // Age bands read as a ladder, so the natural order is by age and
        // only then by the manual sort order.
        orderBy: [{ sortOrder: 'asc' }, { minAge: 'asc' }, { nameKey: 'asc' }],
        take: query.limit,
        skip: query.offset,
      }),
      this.deps.tenantDb.ageCategory.count({ where }),
    ]);
    return { rows, total };
  }

  protected findOne(id: string): Promise<AgeCategory | null> {
    return this.deps.tenantDb.ageCategory.findUnique({ where: { id } });
  }

  protected findOneTx(tx: Tx, id: string): Promise<AgeCategory | null> {
    return tx.ageCategory.findUnique({ where: { id } });
  }

  protected insert(tx: Tx, dto: CreateAgeCategoryDto): Promise<AgeCategory> {
    return tx.ageCategory.create({
      data: {
        id: uuidv7(),
        tenantId: this.deps.tenantId,
        name: dto.name,
        minAge: dto.minAge,
        maxAge: dto.maxAge ?? null,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  protected async patch(
    tx: Tx,
    id: string,
    version: number,
    dto: UpdateAgeCategoryDto,
  ): Promise<number> {
    await this.assertBandValid(tx, id, dto);
    const { count } = await tx.ageCategory.updateMany({
      where: { id, version },
      data: {
        name: dto.name,
        minAge: dto.minAge,
        ...('maxAge' in dto ? { maxAge: dto.maxAge ?? null } : {}),
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
    const { count } = await tx.ageCategory.updateMany({
      where: { id, version },
      data: { isActive, version: { increment: 1 } },
    });
    return count;
  }

  /**
   * A PATCH that only moves one end of the band has to be checked against
   * the stored other end — `{ minAge: 12 }` on a 7..10 band is invalid, and
   * the DTO alone cannot see it. The database CHECK would refuse it too,
   * but as a 500-shaped constraint error rather than a field message.
   */
  private async assertBandValid(tx: Tx, id: string, dto: UpdateAgeCategoryDto): Promise<void> {
    if (dto.minAge === undefined && !('maxAge' in dto)) {
      return;
    }
    const current = await tx.ageCategory.findUnique({ where: { id } });
    if (current === null) {
      return;
    }
    const minAge = dto.minAge ?? current.minAge;
    const maxAge = 'maxAge' in dto ? (dto.maxAge ?? null) : current.maxAge;
    if (maxAge !== null && maxAge < minAge) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'maxAge must be greater than or equal to minAge',
        details: [{ field: 'maxAge', code: 'OUT_OF_RANGE', min_age: minAge, max_age: maxAge }],
      });
    }
  }
}
