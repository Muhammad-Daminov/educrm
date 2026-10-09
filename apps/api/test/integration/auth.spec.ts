import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { Client as PgClient } from 'pg';
import * as argon2 from 'argon2';
import { uuidv7 } from '@educrm/shared';
import { findOrCreateTenant, seedOwnerUser } from '../../src/auth/seed-owner';
import { startAuthTestApp, type AuthTestApp } from './auth-setup';

interface CookieJar {
  access_token?: string;
  refresh_token?: string;
  csrf_token?: string;
}

function mergeCookiesFrom(res: request.Response, jar: CookieJar): CookieJar {
  const header = res.headers['set-cookie'] as string[] | undefined;
  const next = { ...jar };
  for (const raw of header ?? []) {
    const [pair] = raw.split(';');
    const separator = pair?.indexOf('=') ?? -1;
    if (!pair || separator === -1) {
      continue;
    }
    const key = pair.slice(0, separator).trim();
    const value = decodeURIComponent(pair.slice(separator + 1).trim());
    if (key === 'access_token' || key === 'refresh_token' || key === 'csrf_token') {
      next[key] = value;
    }
  }
  return next;
}

function cookieHeader(jar: CookieJar): string {
  return Object.entries(jar)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
}

interface ErrorEnvelope {
  error: { code: string; message: string; details: unknown; request_id: string };
}

function errorBody(res: request.Response): ErrorEnvelope['error'] {
  return (res.body as ErrorEnvelope).error;
}

describe('Auth + RBAC (step 0.3)', () => {
  let testApp: AuthTestApp;
  let server: Server;
  let seedPrisma: PrismaClient;

  let tenantAId: string;
  let tenantBId: string;
  let tenantASlug: string;
  let tenantBSlug: string;

  const OWNER_A_PHONE = '+998901111111';
  const OWNER_B_PHONE = '+998902222222';
  const INACTIVE_PHONE = '+998903333333';
  const TEACHER_PHONE = '+998904444444';
  const PASSWORD = 'correct-password-1';

  beforeAll(async () => {
    testApp = await startAuthTestApp();
    server = testApp.app.getHttpServer() as Server;
    seedPrisma = new PrismaClient({ datasources: { db: { url: testApp.appUserUrl } } });

    tenantASlug = `tenant-a-${Date.now()}`;
    tenantBSlug = `tenant-b-${Date.now()}`;

    const tenantA = await findOrCreateTenant(testApp.migratorUrl, tenantASlug);
    const tenantB = await findOrCreateTenant(testApp.migratorUrl, tenantBSlug);
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;

    await seedOwnerUser(seedPrisma, tenantAId, {
      fullName: 'Owner A',
      phone: OWNER_A_PHONE,
      password: PASSWORD,
    });
    await seedOwnerUser(seedPrisma, tenantBId, {
      fullName: 'Owner B',
      phone: OWNER_B_PHONE,
      password: PASSWORD,
    });

    // Inactive user: seed as a normal owner, then flip is_active off directly.
    // `users` is ENABLE-but-not-FORCE RLS (the documented exception for
    // auth_find_user), so migrator can do this without setting tenant context.
    await seedOwnerUser(seedPrisma, tenantAId, {
      fullName: 'Inactive User',
      phone: INACTIVE_PHONE,
      password: PASSWORD,
    });
    const migratorPg = new PgClient({ connectionString: testApp.migratorUrl });
    await migratorPg.connect();
    await migratorPg.query('UPDATE users SET is_active = false WHERE phone = $1', [INACTIVE_PHONE]);
    await migratorPg.end();

    // Low-privilege user: 'teacher' role has no branch.* permissions, used
    // to prove @RequirePermission actually denies.
    const teacherTx = await seedPrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${tenantAId}, true)`;
      const teacherRoleTemplatePermissions = [
        { code: 'schedule.view', scope: 'own' as const },
        { code: 'attendance.view', scope: 'own' as const },
      ];
      const role = await tx.role.create({
        data: { id: uuidv7(), tenantId: tenantAId, code: 'teacher', name: 'Teacher', isSystem: true },
      });
      await tx.rolePermission.createMany({
        data: teacherRoleTemplatePermissions.map((p) => ({
          id: uuidv7(),
          tenantId: tenantAId,
          roleId: role.id,
          permissionCode: p.code,
          scope: p.scope,
        })),
      });
      const user = await tx.user.create({
        data: {
          id: uuidv7(),
          tenantId: tenantAId,
          fullName: 'Teacher User',
          phone: TEACHER_PHONE,
          passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
          isActive: true,
        },
      });
      await tx.userRole.create({
        data: { id: uuidv7(), tenantId: tenantAId, userId: user.id, roleId: role.id },
      });
      return user;
    });
    expect(teacherTx.phone).toBe(TEACHER_PHONE);
  }, 120_000);

  afterAll(async () => {
    await seedPrisma.$disconnect();
    await testApp.stop();
  }, 60_000);

  async function login(tenantSlug: string, loginId: string, password: string) {
    return request(server)
      .post('/api/v1/auth/login')
      .send({ tenant_slug: tenantSlug, login: loginId, password });
  }

  describe('login', () => {
    it('succeeds with the right tenant/login/password and sets auth cookies', async () => {
      const res = await login(tenantASlug, OWNER_A_PHONE, PASSWORD);
      expect(res.status).toBe(200);
      const jar = mergeCookiesFrom(res, {});
      expect(jar.access_token).toBeTruthy();
      expect(jar.refresh_token).toBeTruthy();
      expect(jar.csrf_token).toBeTruthy();
    });

    it('rejects a wrong password with a generic error', async () => {
      const res = await login(tenantASlug, OWNER_A_PHONE, 'totally-wrong-password');
      expect(res.status).toBe(401);
      expect(errorBody(res).code).toBe('INVALID_CREDENTIALS');
    });

    it('rejects an inactive user with the SAME generic error as a wrong password', async () => {
      const res = await login(tenantASlug, INACTIVE_PHONE, PASSWORD);
      expect(res.status).toBe(401);
      expect(errorBody(res).code).toBe('INVALID_CREDENTIALS');
      expect(errorBody(res).message).toBe('Invalid tenant, login, or password');
    });

    it('rejects an unknown tenant slug with the SAME generic error', async () => {
      const res = await login('no-such-tenant', OWNER_A_PHONE, PASSWORD);
      expect(res.status).toBe(401);
      expect(errorBody(res).code).toBe('INVALID_CREDENTIALS');
      expect(errorBody(res).message).toBe('Invalid tenant, login, or password');
    });
  });

  describe('refresh rotation and reuse detection', () => {
    it('rotates the refresh token, and reusing the old one revokes the whole family', async () => {
      const loginRes = await login(tenantASlug, OWNER_A_PHONE, PASSWORD);
      expect(loginRes.status).toBe(200);
      const jar1 = mergeCookiesFrom(loginRes, {});

      const refreshRes1 = await request(server)
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookieHeader(jar1))
        .set('x-csrf-token', jar1.csrf_token ?? '');
      expect(refreshRes1.status).toBe(200);
      const jar2 = mergeCookiesFrom(refreshRes1, jar1);
      expect(jar2.refresh_token).not.toBe(jar1.refresh_token);

      // Reusing the now-rotated-away-from token must fail and revoke the family.
      const reuseRes = await request(server)
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookieHeader(jar1))
        .set('x-csrf-token', jar1.csrf_token ?? '');
      expect(reuseRes.status).toBe(401);
      expect(errorBody(reuseRes).code).toBe('REFRESH_TOKEN_REUSED');

      // The legitimately-rotated token is now also dead, because the whole
      // family (including it) was revoked by the reuse above.
      const afterReuseRes = await request(server)
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookieHeader(jar2))
        .set('x-csrf-token', jar2.csrf_token ?? '');
      expect(afterReuseRes.status).toBe(401);
    });
  });

  describe('deactivated user', () => {
    it('cannot refresh once deactivated — sessions are revoked at the DB level', async () => {
      const phone = '+998905555555';
      await seedOwnerUser(seedPrisma, tenantAId, {
        fullName: 'Soon Deactivated',
        phone,
        password: PASSWORD,
      });

      const loginRes = await login(tenantASlug, phone, PASSWORD);
      expect(loginRes.status).toBe(200);
      const jar = mergeCookiesFrom(loginRes, {});

      const migratorPg = new PgClient({ connectionString: testApp.migratorUrl });
      await migratorPg.connect();
      await migratorPg.query('UPDATE users SET is_active = false WHERE phone = $1', [phone]);
      await migratorPg.end();

      const refreshRes = await request(server)
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookieHeader(jar))
        .set('x-csrf-token', jar.csrf_token ?? '');
      expect(refreshRes.status).toBe(401);
    });
  });

  describe('authorization', () => {
    it('rejects an unauthenticated request with 401', async () => {
      const res = await request(server).get('/api/v1/branches');
      expect(res.status).toBe(401);
      expect(errorBody(res).code).toBe('UNAUTHENTICATED');
    });

    it('rejects an authenticated user lacking the required permission with 403', async () => {
      const loginRes = await login(tenantASlug, TEACHER_PHONE, PASSWORD);
      expect(loginRes.status).toBe(200);
      const jar = mergeCookiesFrom(loginRes, {});

      const res = await request(server).get('/api/v1/branches').set('Cookie', cookieHeader(jar));
      expect(res.status).toBe(403);
      expect(errorBody(res).code).toBe('PERMISSION_DENIED');
    });
  });

  describe('tenant isolation', () => {
    it("tenant A's access token cannot see tenant B's branches", async () => {
      const migratorPg = new PgClient({ connectionString: testApp.migratorUrl });
      await migratorPg.connect();
      try {
        await migratorPg.query('BEGIN');
        await migratorPg.query("SELECT set_config('app.current_tenant', $1, true)", [tenantBId]);
        await migratorPg.query(
          'INSERT INTO branches (id, tenant_id, name, code) VALUES ($1, $2, $3, $4)',
          [uuidv7(), tenantBId, 'Tenant B HQ', `B-${Date.now()}`],
        );
        await migratorPg.query('COMMIT');
      } catch (error) {
        await migratorPg.query('ROLLBACK');
        throw error;
      } finally {
        await migratorPg.end();
      }

      const loginRes = await login(tenantASlug, OWNER_A_PHONE, PASSWORD);
      const jar = mergeCookiesFrom(loginRes, {});

      const res = await request(server).get('/api/v1/branches').set('Cookie', cookieHeader(jar));
      expect(res.status).toBe(200);
      // TZ 6.2 envelope: the rows live under `data`.
      for (const branch of (res.body as { data: { name: string }[] }).data) {
        expect(branch.name).not.toBe('Tenant B HQ');
      }
    });
  });

  describe('CSRF', () => {
    it('rejects a non-GET request missing the CSRF header with 403', async () => {
      const loginRes = await login(tenantASlug, OWNER_A_PHONE, PASSWORD);
      const jar = mergeCookiesFrom(loginRes, {});

      const res = await request(server)
        .post('/api/v1/branches')
        .set('Cookie', cookieHeader(jar))
        .send({ name: 'No CSRF Branch', code: `NOCSRF-${Date.now()}` });

      expect(res.status).toBe(403);
      expect(errorBody(res).code).toBe('CSRF_TOKEN_MISMATCH');
    });

    it('accepts a non-GET request with a matching CSRF header', async () => {
      const loginRes = await login(tenantASlug, OWNER_A_PHONE, PASSWORD);
      const jar = mergeCookiesFrom(loginRes, {});

      const res = await request(server)
        .post('/api/v1/branches')
        .set('Cookie', cookieHeader(jar))
        .set('x-csrf-token', jar.csrf_token ?? '')
        .send({ name: 'With CSRF Branch', code: `CSRF-${Date.now()}` });

      expect(res.status).toBe(201);
    });
  });

  describe('login rate limiting', () => {
    it('locks out after 5 failed attempts and returns 429 on the 6th', async () => {
      const phone = '+998906666666';
      await seedOwnerUser(seedPrisma, tenantAId, {
        fullName: 'Rate Limited User',
        phone,
        password: PASSWORD,
      });

      // A successful login anywhere resets this IP's failure counter, so
      // the next 5 failures below start from a clean slate regardless of
      // what earlier tests in this file did on the same IP.
      const reset = await login(tenantASlug, phone, PASSWORD);
      expect(reset.status).toBe(200);

      for (let i = 0; i < 5; i += 1) {
        const res = await login(tenantASlug, phone, 'wrong-password');
        expect(res.status).toBe(401);
      }

      const blocked = await login(tenantASlug, phone, 'wrong-password');
      expect(blocked.status).toBe(429);
    });
  });
});
