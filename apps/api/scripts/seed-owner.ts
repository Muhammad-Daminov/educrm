/**
 * `pnpm --filter api seed:owner --tenant <slug> --name <full name> --phone <phone>
 *   --password <password> [--email <email>]`
 *
 * Idempotent bootstrap for a brand-new tenant (step 0.3 requirement H):
 * creates the tenant if it doesn't exist, clones the `owner` role template
 * (role-templates.ts) into tenant-scoped `roles`/`role_permissions` rows if
 * the tenant has no `owner` role yet, and upserts a user with that role.
 *
 * Deliberately NOT a Nest provider/CLI command: this runs standalone (via
 * tsx) before any tenant exists, so there's no access token yet to
 * establish tenant context through the normal request path. It uses the
 * same `createTenantScopedClient` + `tenantDb.transaction` the running API
 * uses, with the tenant context supplied directly.
 *
 * Finding/creating the tenant row itself needs the `migrator` role: per
 * the step 0.2 grants, `app_user` has SELECT-only on `tenants` (see
 * prisma/migrations/20261008121645_init/migration.sql) so that the running
 * API can never create or rename a tenant — only a migration/ops task can.
 * Everything after that (role template clone, owner user) runs as
 * `app_user` through the normal tenant-scoped client, same as request code.
 */
import { PrismaClient } from '@prisma/client';
import { Client as PgClient } from 'pg';
import * as argon2 from 'argon2';
import { uuidv7 } from '@educrm/shared';
import { createTenantScopedClient } from '../src/database/tenant-prisma.provider';
import { normalizePhone } from '../src/auth/phone.util';
import { ROLE_TEMPLATES } from '../src/auth/role-templates';
import { MIN_PASSWORD_LENGTH } from '../src/auth/auth.constants';

async function findOrCreateTenant(slug: string): Promise<{ id: string; created: boolean }> {
  const migrationUrl = process.env.DATABASE_MIGRATION_URL;
  if (!migrationUrl) {
    throw new Error('DATABASE_MIGRATION_URL is not set');
  }

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

interface Args {
  tenant: string;
  name: string;
  phone: string;
  password: string;
}

function parseArgs(argv: string[]): Args {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token?.startsWith('--')) {
      continue;
    }
    const key = token.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`--${key} requires a value`);
    }
    flags.set(key, value);
    i += 1;
  }

  const tenant = flags.get('tenant');
  const name = flags.get('name');
  const password = flags.get('password');
  const phone = flags.get('phone');

  if (!tenant || !name || !password || !phone) {
    throw new Error('Usage: seed:owner --tenant <slug> --name <name> --phone <phone> --password <password>');
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`--password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }

  return { tenant, name, phone, password };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const normalizedPhone = normalizePhone(args.phone);
  if (!normalizedPhone) {
    throw new Error(`--phone "${args.phone}" is not a valid UZ phone number`);
  }

  const { id: tenantId, created } = await findOrCreateTenant(args.tenant);
  console.log(
    created
      ? `Created tenant "${args.tenant}" (${tenantId}).`
      : `Using existing tenant "${args.tenant}" (${tenantId}).`,
  );

  const prisma = new PrismaClient();

  try {
    const tenantDb = createTenantScopedClient(prisma, { currentTenantId: tenantId });

    const passwordHash = await argon2.hash(args.password, { type: argon2.argon2id });
    const ownerTemplate = ROLE_TEMPLATES.find((template) => template.code === 'owner');
    if (!ownerTemplate) {
      throw new Error('No "owner" role template found in role-templates.ts');
    }

    const result = await tenantDb.transaction(async (tx) => {
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
        where: {
          tenantId_phone: { tenantId, phone: normalizedPhone },
        },
        create: {
          id: uuidv7(),
          tenantId,
          fullName: args.name,
          phone: normalizedPhone,
          passwordHash,
          isActive: true,
        },
        update: {
          fullName: args.name,
          passwordHash,
          isActive: true,
        },
      });

      await tx.userRole.upsert({
        where: { tenantId_userId_roleId: { tenantId, userId: user.id, roleId: role.id } },
        create: { id: uuidv7(), tenantId, userId: user.id, roleId: role.id },
        update: {},
      });

      return { user, role };
    });

    console.log(
      `Owner user ready: id=${result.user.id} role=${result.role.code} phone=${normalizedPhone}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
