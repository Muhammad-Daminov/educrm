import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { Branch } from '@prisma/client';
import { uuidv7 } from '@educrm/shared';
import { TENANT_PRISMA, type TenantPrismaClient } from '../database/tenant-prisma.provider';
import { TenantContextService } from '../tenant/tenant-context.service';
import type { CreateBranchDto } from './dto/create-branch.dto';

@Injectable()
export class BranchesService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly prisma: TenantPrismaClient,
    private readonly tenantContext: TenantContextService,
  ) {}

  findAll(): Promise<Branch[]> {
    return this.prisma.branch.findMany({ orderBy: { createdAt: 'asc' } });
  }

  create(dto: CreateBranchDto): Promise<Branch> {
    const tenantId = this.tenantContext.currentTenantId;
    if (!tenantId) {
      throw new BadRequestException({
        code: 'TENANT_REQUIRED',
        message: 'No tenant context on this request',
        details: null,
      });
    }

    return this.prisma.branch.create({
      data: {
        id: uuidv7(),
        tenantId,
        name: dto.name,
        code: dto.code,
        address: dto.address,
        phone: dto.phone,
        timezone: dto.timezone ?? 'Asia/Tashkent',
        isActive: dto.isActive ?? true,
      },
    });
  }
}
