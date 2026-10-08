import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { Request, Response } from 'express';
import { ClsModule } from 'nestjs-cls';
import { LoggerModule } from 'nestjs-pino';
import { validateEnv } from './config/env.validation';
import {
  assignRequestId,
  RequestIdMiddleware,
  resolveRequestId,
} from './common/middleware/request-id.middleware';
import { HealthModule } from './health/health.module';
import { DatabaseModule } from './database/database.module';
import { BranchesModule } from './branches/branches.module';
import { resolveTenantFromHeader } from './tenant/tenant-header.resolver';

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
          // Must run before resolveTenantFromHeader: that can throw (missing/invalid
          // tenant), and RequestIdMiddleware (which normally assigns this) never gets
          // to run if `next()` isn't reached, which would otherwise leave error
          // responses without a request id.
          assignRequestId(req, res);
          resolveTenantFromHeader(cls, req);
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
    BranchesModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
