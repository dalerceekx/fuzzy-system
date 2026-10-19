import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule, ObserveInstrument, observeEnabled } from './app.module.js';
import { configureApp, NEST_APP_OPTIONS } from './app.setup.js';
import type { Env } from './config/env.js';
import { getRootLogger, serializeError } from './logging/logger.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    ...NEST_APP_OPTIONS,
    instrument: observeEnabled ? ObserveInstrument : undefined,
  });
  configureApp(app);
  // SIGTERM/SIGINT → stop accepting requests (503), let in-flight ones
  // finish, run onModuleDestroy / onApplicationShutdown hooks (workers stop,
  // Prisma $disconnect, Redis quit), flush logs and exit 0.
  app.enableShutdownHooks([], { useProcessExit: true });

  const config = app.get<ConfigService<Env, true>>(ConfigService);
  await app.listen(config.get('PORT', { infer: true }), '0.0.0.0');
}

/** Logs as structured JSON (errors summarized, no secrets) and exits. */
function die(message: string, err: unknown): never {
  getRootLogger().fatal({ err: serializeError(err) }, message);
  process.exit(1);
}

// Same outcome as Node's defaults (crash and let the supervisor restart),
// but logged through pino instead of a raw stack on stderr.
process.on('unhandledRejection', (reason) =>
  die('unhandled promise rejection', reason),
);
process.on('uncaughtException', (err) => die('uncaught exception', err));

try {
  await bootstrap();
} catch (err) {
  die('application failed to start', err);
}
