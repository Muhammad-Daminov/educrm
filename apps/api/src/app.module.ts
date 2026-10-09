import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import type { Request, Response } from 'express';
import { ClsModule } from 'nestjs-cls';
import { LoggerModule } from 'nestjs-pino';
import { validateEnv } from './config/env.validation';
import {
  assignRequestId,
  RequestIdMiddleware,
  resolveRequestId,
} from './common/middleware/request-id.middleware';
import { captureRequestMeta } from './common/request-meta';
import { HealthModule } from './health/health.module';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './redis/redis.module';
import { BranchesModule } from './branches/branches.module';
import { ReferenceModule } from './reference/reference.module';
import { ClassroomsModule } from './classrooms/classrooms.module';
import { EmployeesModule } from './employees/employees.module';
import { AuthModule } from './auth/auth.module';
import { AuditModule } from './audit/audit.module';
import { OutboxModule } from './outbox/outbox.module';
import { resolveAuthFromAccessToken } from './auth/access-token-context.resolver';
import { CsrfGuard } from './auth/guards/csrf.guard';
import { PermissionsGuard } from './auth/guards/permissions.guard';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor';

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
          const requestId = assignRequestId(req, res);
          // Captured here for the same reason: a rejected request can still
          // produce an audit row, and TZ M11.3 wants ip/user_agent/
          // request_id on it.
          captureRequestMeta(cls, req, requestId);
          resolveAuthFromAccessToken(cls, req);
        },
      },
    }),
    LoggerModule.forRoot({
      // Same named-wildcard reason as the RequestIdMiddleware mount below.
      // nestjs-pino defaults to `path: '*'`, which is the other source of
      // the LegacyRouteConverter warning on boot — once per logger
      // middleware it mounts.
      forRoutes: [{ path: '{*path}', method: RequestMethod.ALL }],
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
    AuditModule,
    OutboxModule,
    BranchesModule,
    ReferenceModule,
    ClassroomsModule,
    EmployeesModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    // TZ 6.2: every success response is `{ data, meta? }`. Here rather than
    // in main.ts so integration tests see the real wire format.
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // `'{*path}'`, not `'*'`: Express 5's path-to-regexp v8 dropped bare
    // `*` in favour of named wildcards. Nest still auto-converts `'*'`, but
    // only after logging a LegacyRouteConverter warning on every boot — and
    // the conversion is a compatibility shim, not a promise.
    consumer.apply(RequestIdMiddleware).forRoutes('{*path}');
  }
}
