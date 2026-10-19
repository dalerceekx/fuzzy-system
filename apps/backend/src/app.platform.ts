import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { createObserveModule } from '@nestjs/observe';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuditModule } from './audit/audit.module.js';
import { validateEnv } from './config/env.js';
import { HealthModule } from './health/health.module.js';
import { IdempotencyModule } from './idempotency/idempotency.module.js';
import { LoggingModule } from './logging/logging.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RedisModule } from './redis/redis.module.js';
import { AccessTokenGuard } from './security/guards/access-token.guard.js';
import { GlobalRateLimitGuard } from './security/guards/global-rate-limit.guard.js';
import { RolesGuard } from './security/guards/roles.guard.js';
import { SecurityModule } from './security/security.module.js';
import { StorageModule } from './storage/storage.module.js';

// Platform layer shared by every feature module. Kept separate from
// app.module.ts so tests can boot the platform plus only the feature modules
// they exercise (see test/utils/app.ts `features`).

export const { ObserveModule, ObserveInstrument } = createObserveModule();

// Telemetry is only enabled when real credentials are provided via env.
export const observeEnabled = Boolean(
  process.env.OBSERVE_APP_KEY && process.env.OBSERVE_APP_SECRET,
);

export const PLATFORM_IMPORTS = [
  ConfigModule.forRoot({
    isGlobal: true,
    cache: true,
    // Tests get their environment from test/setup/env.ts only, so a
    // developer's .env can never point them at a real database.
    ignoreEnvFile: process.env.NODE_ENV === 'test',
    validate: validateEnv,
  }),
  ...(observeEnabled
    ? [
        ObserveModule.forRoot({
          appKey: process.env.OBSERVE_APP_KEY!,
          appSecret: process.env.OBSERVE_APP_SECRET!,
          serviceId: 'meningfermam-api',
        }),
      ]
    : []),
  LoggingModule,
  PrismaModule,
  RedisModule,
  SecurityModule,
  AuditModule,
  IdempotencyModule,
  StorageModule,
  HealthModule,
];

export const PLATFORM_CONTROLLERS = [AppController];

export const PLATFORM_PROVIDERS = [
  AppService,
  // Order matters: rate limit → authentication → authorization.
  { provide: APP_GUARD, useExisting: GlobalRateLimitGuard },
  { provide: APP_GUARD, useExisting: AccessTokenGuard },
  { provide: APP_GUARD, useExisting: RolesGuard },
];
