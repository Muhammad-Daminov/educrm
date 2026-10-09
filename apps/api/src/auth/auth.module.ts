import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { SessionService } from './session.service';
import { RateLimitService } from './rate-limit.service';
import { PermissionsService } from './permissions.service';
import { CookieService } from './cookie.service';
import { RequestUserService } from './request-user.service';

@Module({
  imports: [DatabaseModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    TokenService,
    SessionService,
    RateLimitService,
    PermissionsService,
    CookieService,
    RequestUserService,
  ],
  exports: [PermissionsService, RequestUserService],
})
export class AuthModule {}
