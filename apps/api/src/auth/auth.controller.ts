import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { CookieService } from './cookie.service';
import { RequestUserService } from './request-user.service';
import { Public } from './decorators/public.decorator';
import { RequirePermission } from './decorators/require-permission.decorator';
import { SkipCsrf } from './decorators/skip-csrf.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { loginSchema, type LoginDto } from './dto/login.dto';
import { REFRESH_TOKEN_COOKIE } from './auth.constants';
import { getCookie } from './cookie.util';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly cookieService: CookieService,
    private readonly requestUserService: RequestUserService,
  ) {}

  /**
   * 200, not Nest's default 201 for POST: nothing is created at a URL a
   * client could then fetch — the result is a pair of cookies on the
   * current session. Same reasoning for every other POST here.
   */
  @Public()
  @SkipCsrf()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    const { accessToken, refreshToken } = await this.authService.login(dto, req.ip ?? 'unknown');
    this.cookieService.setAuthCookies(res, accessToken, refreshToken);
    return { ok: true };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    const presented = getCookie(req, REFRESH_TOKEN_COOKIE);
    const { accessToken, refreshToken } = await this.authService.refresh(presented);
    this.cookieService.setAuthCookies(res, accessToken, refreshToken);
    return { ok: true };
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    const presented = getCookie(req, REFRESH_TOKEN_COOKIE);
    await this.authService.logout(presented);
    this.cookieService.clearAuthCookies(res);
    return { ok: true };
  }

  @RequirePermission('auth.logout_all')
  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  async logoutAll(@Res({ passthrough: true }) res: Response): Promise<{ ok: true }> {
    const user = this.requestUserService.current;
    if (!user) {
      throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Not authenticated', details: null });
    }
    await this.authService.logoutAll(user);
    this.cookieService.clearAuthCookies(res);
    return { ok: true };
  }

  @RequirePermission('auth.me')
  @Get('me')
  async me() {
    const user = this.requestUserService.current;
    if (!user) {
      throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Not authenticated', details: null });
    }
    return this.authService.me(user);
  }
}
