import { Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { randomBytes } from 'node:crypto';
import {
  ACCESS_TOKEN_COOKIE,
  ACCESS_TOKEN_TTL_SECONDS,
  AUTH_COOKIE_PATH,
  CSRF_COOKIE,
  REFRESH_TOKEN_COOKIE,
  REFRESH_TOKEN_TTL_SECONDS,
  ROOT_COOKIE_PATH,
} from './auth.constants';

@Injectable()
export class CookieService {
  private get secure(): boolean {
    return process.env.NODE_ENV === 'production';
  }

  setAuthCookies(res: Response, accessToken: string, refreshToken: string): void {
    res.cookie(ACCESS_TOKEN_COOKIE, accessToken, {
      httpOnly: true,
      secure: this.secure,
      sameSite: 'lax',
      path: ROOT_COOKIE_PATH,
      maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000,
    });
    res.cookie(REFRESH_TOKEN_COOKIE, refreshToken, {
      httpOnly: true,
      secure: this.secure,
      sameSite: 'lax',
      path: AUTH_COOKIE_PATH,
      maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000,
    });
    this.setCsrfCookie(res);
  }

  /** Double-submit CSRF token: readable by JS on purpose, so it can be echoed back as a header. */
  setCsrfCookie(res: Response): string {
    const token = randomBytes(32).toString('base64url');
    res.cookie(CSRF_COOKIE, token, {
      httpOnly: false,
      secure: this.secure,
      sameSite: 'lax',
      path: ROOT_COOKIE_PATH,
      maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000,
    });
    return token;
  }

  clearAuthCookies(res: Response): void {
    res.clearCookie(ACCESS_TOKEN_COOKIE, { path: ROOT_COOKIE_PATH });
    res.clearCookie(REFRESH_TOKEN_COOKIE, { path: AUTH_COOKIE_PATH });
    res.clearCookie(CSRF_COOKIE, { path: ROOT_COOKIE_PATH });
  }
}
