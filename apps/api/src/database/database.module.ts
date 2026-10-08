import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { createTenantScopedClient, TENANT_PRISMA } from './tenant-prisma.provider';
import { TenantContextService } from '../tenant/tenant-context.service';

@Module({
  providers: [
    PrismaService,
    TenantContextService,
    {
      provide: TENANT_PRISMA,
      useFactory: (prisma: PrismaService, tenantContext: TenantContextService) =>
        createTenantScopedClient(prisma, tenantContext),
      inject: [PrismaService, TenantContextService],
    },
  ],
  exports: [PrismaService, TenantContextService, TENANT_PRISMA],
})
export class DatabaseModule {}
