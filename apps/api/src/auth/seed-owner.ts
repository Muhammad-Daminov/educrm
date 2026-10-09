/**
 * Shared by `scripts/seed-owner.ts` (the `seed:owner` CLI) and the auth
 * integration tests, which need the exact same tenant/owner-user bootstrap
 * to seed their fixtures — see step 0.3 requirement H.
 */
import { PrismaClient } from '@prisma/client';
import { Client as PgClient } from 'pg';
import * as argon2 from 'argon2';
import { uuidv7 } from '@educrm/shared';
import { createTenantScopedClient } from '../database/tenant-prisma.provider';
import { ROLE_TEMPLATES, type RoleTemplate } from './role-templates';

export interface SeedOwnerInput {
  tenantSlug: string;
  fullName: string;
  phone: string;
  password: string;
}

export interface SeedOwnerResult {
  tenantId: string;
  tenantCreated: boolean;
  userId: string;
  roleId: string;
}

/**
 * Finding/creating the tenant row needs the `migrator` role: per the step
 * 0.2 grants, `app_user` has SELECT-only on `tenants` (see
 * prisma/migrations/20261008121645_init/migration.sql) so the running API
 * can never create or rename a tenant — only a migration/ops task can.
 */
export async function findOrCreateTenant(
  migrationUrl: string,
  slug: string,
): Promise<{ id: string; created: boolean }> {
  const pg = new PgClient({ connectionString: migrationUrl });
  await pg.connect();
  try {
    const existing = await pg.query<{ id: string }>('SELECT id FROM tenants WHERE slug = $1', [slug]);
    if (existing.rows[0]) {
      return { id: existing.rows[0].id, created: false };
    }

    const id = uuidv7();
    await pg.query('INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3)', [id, slug, slug]);
    return { id, created: true };
  } finally {
    await pg.end();
  }
}

/**
 * Clones the `owner` role template into tenant-scoped `roles`/
 * `role_permissions` rows (if the tenant has no `owner` role yet) and
 * upserts a user with that role — all inside one `tenantDb.transaction`.
 * Idempotent on `(tenantId, phone)`.
 */
export async function seedOwnerUser(
  prisma: PrismaClient,
  tenantId: string,
  input: Omit<SeedOwnerInput, 'tenantSlug'>,
): Promise<SeedOwnerResult> {
  const tenantDb = createTenantScopedClient(prisma, { currentTenantId: tenantId });
  const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });

  const ownerTemplate: RoleTemplate | undefined = ROLE_TEMPLATES.find(
    (template) => template.code === 'owner',
  );
  if (!ownerTemplate) {
    throw new Error('No "owner" role template found in role-templates.ts');
  }

  return tenantDb.transaction(async (tx) => {
    let role = await tx.role.findUnique({
      where: { tenantId_code: { tenantId, code: 'owner' } },
    });

    if (!role) {
      role = await tx.role.create({
        data: {
          id: uuidv7(),
          tenantId,
          code: ownerTemplate.code,
          name: ownerTemplate.name,
          isSystem: true,
        },
      });
      await tx.rolePermission.createMany({
        data: ownerTemplate.permissions.map((permission) => ({
          id: uuidv7(),
          tenantId,
          roleId: role!.id,
          permissionCode: permission.code,
          scope: permission.scope,
        })),
      });
    }

    const user = await tx.user.upsert({
      where: { tenantId_phone: { tenantId, phone: input.phone } },
      create: {
        id: uuidv7(),
        tenantId,
        fullName: input.fullName,
        phone: input.phone,
        passwordHash,
        isActive: true,
      },
      update: {
        fullName: input.fullName,
        passwordHash,
        isActive: true,
      },
    });

    await tx.userRole.upsert({
      where: { tenantId_userId_roleId: { tenantId, userId: user.id, roleId: role.id } },
      create: { id: uuidv7(), tenantId, userId: user.id, roleId: role.id },
      update: {},
    });

    return { tenantId, tenantCreated: false, userId: user.id, roleId: role.id };
  });
}
