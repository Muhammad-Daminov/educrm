import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { TenantContextLike } from '../database/tenant-prisma.provider';
import { TENANT_ID_KEY } from './tenant-context.constants';

@Injectable()
export class TenantContextService implements TenantContextLike {
  constructor(private readonly cls: ClsService) {}

  get currentTenantId(): string | undefined {
    return this.cls.get<string>(TENANT_ID_KEY);
  }

  setTenantId(tenantId: string): void {
    this.cls.set(TENANT_ID_KEY, tenantId);
  }
}
