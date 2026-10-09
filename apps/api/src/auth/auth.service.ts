import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { TENANT_PRISMA, type TenantPrismaClient } from '../database/tenant-prisma.provider';
import { TenantContextService } from '../tenant/tenant-context.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { SessionService } from './session.service';
import { RateLimitService } from './rate-limit.service';
import { PermissionsService } from './permissions.service';
import { normalizePhone } from './phone.util';
import type { LoginDto } from './dto/login.dto';
import type { RequestUser } from './types';

interface AuthFindUserRow {
  user_id: string;
  tenant_id: string;
  password_hash: string;
  is_active: boolean;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
}

function invalidCredentials(): UnauthorizedException {
  // Deliberately identical for "unknown tenant", "unknown login", "wrong
  // password", and "inactive user" — see docs/QUESTIONS.md. Distinguishing
  // them would let an attacker enumerate valid tenant slugs/logins.
  return new UnauthorizedException({
    code: 'INVALID_CREDENTIALS',
    message: 'Invalid tenant, login, or password',
    details: null,
  });
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(TENANT_PRISMA) private readonly tenantDb: TenantPrismaClient,
    private readonly tenantContext: TenantContextService,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
    private readonly sessionService: SessionService,
    private readonly rateLimitService: RateLimitService,
    private readonly permissionsService: PermissionsService,
  ) {}

  async login(dto: LoginDto, ip: string): Promise<LoginResult> {
    // A phone-shaped login is normalized to +998XXXXXXXXX before lookup, to
    // match the form it's stored in (see seed:owner) — an email-shaped
    // login is left as-is, since normalizePhone only ever returns non-null
    // for a valid UZ phone number.
    const login = normalizePhone(dto.login) ?? dto.login;
    const accountKey = `${dto.tenant_slug}:${login}`;
    await this.rateLimitService.assertLoginAllowed(ip, accountKey);

    // Raw (unextended) client: no tenant context exists yet, and this is
    // the one place that's expected — auth_find_user is the documented RLS
    // bypass (see the auth migration). Everywhere else in this service runs
    // through tenantDb, after tenantContext.setTenantId below.
    const rows = await this.prisma.$queryRaw<
      AuthFindUserRow[]
    >`SELECT * FROM auth_find_user(${dto.tenant_slug}, ${login})`;
    const found = rows[0];

    if (!found) {
      await this.rateLimitService.recordFailure(ip, accountKey);
      throw invalidCredentials();
    }

    const passwordOk = await this.passwordService.verify(found.password_hash, dto.password);
    if (!passwordOk || !found.is_active) {
      await this.rateLimitService.recordFailure(ip, accountKey);
      throw invalidCredentials();
    }

    await this.rateLimitService.recordSuccess(ip, accountKey);

    this.tenantContext.setTenantId(found.tenant_id);
    const { refreshToken, session } = await this.sessionService.createSession(
      found.tenant_id,
      found.user_id,
    );
    const accessToken = this.tokenService.signAccessToken({
      sub: found.user_id,
      tenant_id: found.tenant_id,
      session_id: session.id,
    });

    return { accessToken, refreshToken };
  }

  async refresh(presentedToken: string | undefined): Promise<LoginResult> {
    if (!presentedToken) {
      throw this.refreshInvalid();
    }
    const parsed = this.tokenService.parseRefreshToken(presentedToken);
    if (!parsed) {
      throw this.refreshInvalid();
    }

    this.tenantContext.setTenantId(parsed.tenantId);

    const result = await this.sessionService.rotate(parsed.tenantId, presentedToken);
    if (result.outcome === 'reuse-detected') {
      throw new UnauthorizedException({
        code: 'REFRESH_TOKEN_REUSED',
        message: 'Refresh token already used; all sessions in its family were revoked',
        details: null,
      });
    }
    if (result.outcome === 'invalid') {
      throw this.refreshInvalid();
    }

    const user = await this.tenantDb.user.findUnique({ where: { id: result.userId } });
    if (!user || !user.isActive) {
      await this.sessionService.revokeAllForUser(parsed.tenantId, result.userId);
      throw new UnauthorizedException({
        code: 'USER_INACTIVE',
        message: 'User is inactive',
        details: null,
      });
    }

    const accessToken = this.tokenService.signAccessToken({
      sub: result.userId,
      tenant_id: parsed.tenantId,
      session_id: result.session.id,
    });

    return { accessToken, refreshToken: result.refreshToken };
  }

  async logout(presentedToken: string | undefined): Promise<void> {
    if (!presentedToken) {
      return;
    }
    const parsed = this.tokenService.parseRefreshToken(presentedToken);
    if (!parsed) {
      return;
    }
    this.tenantContext.setTenantId(parsed.tenantId);
    await this.sessionService.revokeByToken(parsed.tenantId, presentedToken);
  }

  async logoutAll(user: RequestUser): Promise<void> {
    await this.sessionService.revokeAllForUser(user.tenantId, user.userId);
  }

  async me(user: RequestUser) {
    const [dbUser, effective] = await Promise.all([
      this.tenantDb.user.findUnique({
        where: { id: user.userId },
        include: {
          userRoles: { include: { role: true } },
          userBranches: { include: { branch: true } },
        },
      }),
      this.permissionsService.getEffectivePermissions(user.tenantId, user.userId),
    ]);

    if (!dbUser) {
      throw new UnauthorizedException({ code: 'USER_NOT_FOUND', message: 'User not found', details: null });
    }

    return {
      user: {
        id: dbUser.id,
        fullName: dbUser.fullName,
        phone: dbUser.phone,
        email: dbUser.email,
      },
      roles: dbUser.userRoles.map((userRole) => ({
        code: userRole.role.code,
        name: userRole.role.name,
      })),
      permissions: Object.entries(effective.scopes).map(([code, scope]) => ({ code, scope })),
      branches: dbUser.userBranches.map((userBranch) => ({
        id: userBranch.branch.id,
        name: userBranch.branch.name,
      })),
    };
  }

  private refreshInvalid(): UnauthorizedException {
    return new UnauthorizedException({
      code: 'REFRESH_TOKEN_INVALID',
      message: 'Invalid, expired, or missing refresh token',
      details: null,
    });
  }
}
