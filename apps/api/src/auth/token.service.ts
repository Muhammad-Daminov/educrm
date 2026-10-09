import { randomBytes, createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import jwt from 'jsonwebtoken';
import { ACCESS_TOKEN_TTL_SECONDS } from './auth.constants';
import type { Env } from '../config/env.validation';

export interface AccessTokenClaims {
  sub: string;
  tenant_id: string;
  session_id: string;
}

export interface ParsedRefreshToken {
  tenantId: string;
  raw: string;
}

/**
 * Standalone (no DI) so it can be called from the CLS middleware `setup`
 * hook in app.module.ts, which runs before Nest's injector is available —
 * same reason app.module.ts already reads `process.env.NODE_ENV` directly
 * instead of via ConfigService. `TokenService.verifyAccessToken` below is a
 * thin DI-friendly wrapper around this for use everywhere else.
 */
export function decodeAccessTokenClaims(token: string, secret: string): AccessTokenClaims | null {
  try {
    const decoded = jwt.verify(token, secret);
    if (
      typeof decoded === 'object' &&
      decoded !== null &&
      typeof decoded.sub === 'string' &&
      typeof decoded.tenant_id === 'string' &&
      typeof decoded.session_id === 'string'
    ) {
      return { sub: decoded.sub, tenant_id: decoded.tenant_id, session_id: decoded.session_id };
    }
    return null;
  } catch {
    return null;
  }
}

@Injectable()
export class TokenService {
  constructor(private readonly configService: ConfigService<Env, true>) {}

  private get secret(): string {
    return this.configService.get('JWT_SECRET', { infer: true });
  }

  signAccessToken(claims: AccessTokenClaims): string {
    return jwt.sign(claims, this.secret, {
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    });
  }

  /** Returns null (never throws) on an invalid/expired/tampered token. */
  verifyAccessToken(token: string): AccessTokenClaims | null {
    return decodeAccessTokenClaims(token, this.secret);
  }

  /**
   * Opaque refresh token, format `{tenantId}.{32 random bytes, base64url}`.
   * The tenant id prefix isn't secret (tenant ids aren't sensitive) — it
   * lets `/auth/refresh` establish tenant context from the cookie alone,
   * with no separate lookup and no RLS bypass. The random suffix is what
   * actually authenticates the token; only its SHA-256 hash is stored.
   */
  generateRefreshToken(tenantId: string): string {
    const random = randomBytes(32).toString('base64url');
    return `${tenantId}.${random}`;
  }

  parseRefreshToken(token: string): ParsedRefreshToken | null {
    const dotIndex = token.indexOf('.');
    if (dotIndex <= 0) {
      return null;
    }
    const tenantId = token.slice(0, dotIndex);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId)) {
      return null;
    }
    return { tenantId, raw: token };
  }

  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
