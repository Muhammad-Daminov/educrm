import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import type { Env } from './config/env.validation';

/**
 * Serves HTTP. The default role.
 */
async function bootstrapApi(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(app.get(Logger));
  app.useGlobalFilters(new AllExceptionsFilter());
  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();

  const configService = app.get(ConfigService<Env, true>);
  const port = configService.get('PORT', { infer: true });

  await app.listen(port);
}

/**
 * Runs the queue consumers and the outbox relay — same AppModule, no HTTP
 * server (TZ 7.1 "KERAK — worker ajratish"). The worker-only services key
 * off APP_ROLE themselves, so this just builds the DI container and keeps
 * the process alive.
 *
 * `enableShutdownHooks` matters more here than on the API side: it is what
 * lets the BullMQ worker drain in-flight jobs on SIGTERM instead of
 * abandoning them mid-flight.
 */
async function bootstrapWorker(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });

  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  app.get(Logger).log('Worker process started (APP_ROLE=worker)');
}

async function bootstrap(): Promise<void> {
  // Read directly rather than through ConfigService: the role decides which
  // kind of application to build, so it is needed before the DI container
  // exists. env.validation still validates it for everything downstream.
  if (process.env.APP_ROLE === 'worker') {
    await bootstrapWorker();
    return;
  }
  await bootstrapApi();
}

bootstrap().catch((error: unknown) => {
  console.error('Failed to start application', error);
  process.exit(1);
});
