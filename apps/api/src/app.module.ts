import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import type { Request, Response } from 'express';
import { ClsModule } from 'nestjs-cls';
import { LoggerModule } from 'nestjs-pino';
import { validateEnv } from './config/env.validation';
import { assignRequestId, RequestIdMiddleware, resolveRequestId } from './common/middleware/request-id.middleware';
import { HealthModule } from './health/health.module';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './redis/redis.module';
import { BranchesModule } from './branches/branches.module';
import { AuthModule } from './auth/auth.module';
import { resolveAuthFromAccessToken } from './auth/access-token-context.resolver';
import { CsrfGuard } from './auth/guards/csrf.guard';
import { PermissionsGuard } from './auth/guards/permissions.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: true,
        setup: (cls, req: Request, res: Response) => {
          // Must run before resolveAuthFromAccessToken: RequestIdMiddleware
          // (which normally assigns this) never gets to run if a later
          // guard rejects the request first, which would otherwise leave
          // error responses without a request id.
          assignRequestId(req, res);
          resolveAuthFromAccessToken(cls, req);
        },
      },
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        transport:
          process.env.NODE_ENV === 'production'
            ? undefined
            : { target: 'pino-pretty', options: { singleLine: true } },
        genReqId: (req) => resolveRequestId(req),
        customProps: (req) => ({
          request_id: (req as { id?: string }).id,
        }),
      },
    }),
    HealthModule,
    DatabaseModule,
    RedisModule,
    AuthModule,
    BranchesModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
