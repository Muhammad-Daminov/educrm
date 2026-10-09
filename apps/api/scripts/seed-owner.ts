/**
 * `pnpm --filter api seed:owner --tenant <slug> --name <full name> --phone <phone>
 *   --password <password>`
 *
 * Idempotent bootstrap for a brand-new tenant (step 0.3 requirement H): see
 * src/auth/seed-owner.ts for what this actually does — that module is
 * shared with the auth integration tests, which need the same bootstrap to
 * seed their fixtures.
 *
 * Deliberately NOT a Nest provider/CLI command: this runs standalone (via
 * tsx) before any tenant exists, so there's no access token yet to
 * establish tenant context through the normal request path.
 */
import { PrismaClient } from '@prisma/client';
import { normalizePhone } from '../src/auth/phone.util';
import { findOrCreateTenant, seedOwnerUser } from '../src/auth/seed-owner';
import { MIN_PASSWORD_LENGTH } from '../src/auth/auth.constants';

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

  const migrationUrl = process.env.DATABASE_MIGRATION_URL;
  if (!migrationUrl) {
    throw new Error('DATABASE_MIGRATION_URL is not set');
  }

  const { id: tenantId, created } = await findOrCreateTenant(migrationUrl, args.tenant);
  console.log(
    created
      ? `Created tenant "${args.tenant}" (${tenantId}).`
      : `Using existing tenant "${args.tenant}" (${tenantId}).`,
  );

  const prisma = new PrismaClient();
  try {
    const result = await seedOwnerUser(prisma, tenantId, {
      fullName: args.name,
      phone: normalizedPhone,
      password: args.password,
    });
    console.log(`Owner user ready: id=${result.userId} role=owner phone=${normalizedPhone}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
