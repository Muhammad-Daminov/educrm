import { Inject, Injectable } from '@nestjs/common';
import type { Session } from '@prisma/client';
import { uuidv7 } from '@educrm/shared';
import { REFRESH_TOKEN_TTL_SECONDS } from './auth.constants';
import { TokenService } from './token.service';
import { TENANT_PRISMA, type TenantPrismaClient } from '../database/tenant-prisma.provider';

export type RotateResult =
  | { outcome: 'rotated'; refreshToken: string; session: Session; userId: string }
  | { outcome: 'reuse-detected' }
  | { outcome: 'invalid' };

@Injectable()
export class SessionService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly tenantDb: TenantPrismaClient,
    private readonly tokenService: TokenService,
  ) {}

  private expiryDate(): Date {
    return new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000);
  }

  /** Call only after the tenant context for `tenantId` has been established. */
  async createSession(tenantId: string, userId: string): Promise<{ refreshToken: string; session: Session }> {
    const refreshToken = this.tokenService.generateRefreshToken(tenantId);
    const session = await this.tenantDb.session.create({
      data: {
        id: uuidv7(),
        tenantId,
        userId,
        familyId: uuidv7(),
        tokenHash: this.tokenService.hashRefreshToken(refreshToken),
        expiresAt: this.expiryDate(),
      },
    });
    return { refreshToken, session };
  }

  /**
   * Rotation + reuse detection. A presented token whose hash matches an
   * ALREADY-revoked row means it was used once (and rotated) before — a
   * replay of a stolen/leaked token — so the entire family (every
   * descendant of the original login) is revoked, not just this row.
   */
  async rotate(tenantId: string, presentedToken: string): Promise<RotateResult> {
    const tokenHash = this.tokenService.hashRefreshToken(presentedToken);
    const existing = await this.tenantDb.session.findFirst({ where: { tenantId, tokenHash } });

    if (!existing) {
      return { outcome: 'invalid' };
    }

    if (existing.revokedAt) {
      await this.tenantDb.transaction((tx) =>
        tx.session.updateMany({
          where: { tenantId, familyId: existing.familyId, revokedAt: null },
          data: { revokedAt: new Date() },
        }),
      );
      return { outcome: 'reuse-detected' };
    }

    if (existing.expiresAt < new Date()) {
      return { outcome: 'invalid' };
    }

    const refreshToken = this.tokenService.generateRefreshToken(tenantId);
    const session = await this.tenantDb.transaction(async (tx) => {
      await tx.session.update({ where: { id: existing.id }, data: { revokedAt: new Date() } });
      return tx.session.create({
        data: {
          id: uuidv7(),
          tenantId,
          userId: existing.userId,
          familyId: existing.familyId,
          tokenHash: this.tokenService.hashRefreshToken(refreshToken),
          expiresAt: this.expiryDate(),
        },
      });
    });

    return { outcome: 'rotated', refreshToken, session, userId: existing.userId };
  }

  async revokeByToken(tenantId: string, presentedToken: string): Promise<void> {
    const tokenHash = this.tokenService.hashRefreshToken(presentedToken);
    await this.tenantDb.session.updateMany({
      where: { tenantId, tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(tenantId: string, userId: string): Promise<void> {
    await this.tenantDb.session.updateMany({
      where: { tenantId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
