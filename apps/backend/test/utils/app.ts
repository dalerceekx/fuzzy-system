import type {
  DynamicModule,
  ForwardReference,
  Provider,
  Type,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  Test,
  type TestingModule,
  type TestingModuleBuilder,
} from '@nestjs/testing';
import type { Redis } from 'ioredis';
import request from 'supertest';
import { configureApp, NEST_APP_OPTIONS } from '../../src/app.setup.js';
import { validateEnv } from '../../src/config/env.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { REDIS } from '../../src/redis/redis.module.js';
import { MockSmsProvider } from '../../src/sms/providers/mock-sms.provider.js';
import { SMS_PROVIDER } from '../../src/sms/sms.types.js';

/** Feature modules that can be booted in isolation (`features` option). */
const FEATURE_MODULE_FILES = {
  sms: ['sms/sms.module.js', 'SmsModule'],
  auth: ['auth/auth.module.js', 'AuthModule'],
  users: ['users/users.module.js', 'UsersModule'],
  files: ['files/files.module.js', 'FilesModule'],
  farms: ['farms/farms.module.js', 'FarmsModule'],
  animals: ['animals/animals.module.js', 'AnimalsModule'],
  inventory: ['inventory/inventory.module.js', 'InventoryModule'],
  rations: ['rations/rations.module.js', 'RationsModule'],
  vet: ['vet/vet.module.js', 'VetModule'],
  diseases: ['diseases/diseases.module.js', 'DiseasesModule'],
} as const;

export type TestFeature = keyof typeof FEATURE_MODULE_FILES;

export interface TestAppOptions {
  /**
   * Boot the platform layer plus only these feature modules instead of the
   * full AppModule. Modules are imported lazily, so unrelated (possibly
   * unfinished) feature modules are never loaded.
   */
  features?: TestFeature[];
  /** Test-only controllers (e.g. probes for guards/filters). */
  controllers?: Type<unknown>[];
  providers?: Provider[];
  imports?: Array<
    Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference
  >;
  /**
   * Environment overrides for this app instance only (validated with the
   * real schema), e.g. `{ RATE_LIMIT_GLOBAL_PER_MINUTE: '3' }`. `undefined`
   * removes a variable (to test a schema default). The test targets
   * (DATABASE_URL, MIGRATION_DATABASE_URL, REDIS_URL) cannot be overridden,
   * nor LOG_LEVEL / LOG_PRETTY: the root logger is process-wide and built by
   * the first app of a file, so a per-app value would be silently ignored.
   */
  env?: Record<string, string | undefined>;
  /** Further customization, e.g. `builder.overrideProvider(X).useValue(y)`. */
  configure?: (builder: TestingModuleBuilder) => TestingModuleBuilder | void;
}

export interface TestApp {
  app: NestExpressApplication;
  /** A fresh supertest agent for the app's HTTP server. */
  http: () => ReturnType<typeof request>;
  prisma: PrismaService;
  redis: Redis;
  moduleRef: TestingModule;
  /** In-memory SMS inbox (SMS_PROVIDER=mock). */
  sms: MockSmsProvider;
  close: () => Promise<void>;
}

const NON_OVERRIDABLE_ENV = [
  'DATABASE_URL',
  'MIGRATION_DATABASE_URL',
  'REDIS_URL',
  'LOG_LEVEL',
  'LOG_PRETTY',
];

/**
 * Boots the real AppModule with exactly the HTTP setup of main.ts
 * (configureApp) against the test database and Redis.
 */
export async function createTestApp(
  options: TestAppOptions = {},
): Promise<TestApp> {
  for (const name of NON_OVERRIDABLE_ENV) {
    if (options.env && name in options.env) {
      throw new Error(`createTestApp: env.${name} cannot be overridden`);
    }
  }
  const builder = Test.createTestingModule(
    options.features
      ? await platformWithFeatures(options)
      : {
          imports: [
            (await import('../../src/app.module.js')).AppModule,
            ...(options.imports ?? []),
          ],
          controllers: options.controllers ?? [],
          providers: options.providers ?? [],
        },
  );
  if (options.env) {
    const merged: Record<string, unknown> = { ...process.env };
    for (const [name, value] of Object.entries(options.env)) {
      if (value === undefined) delete merged[name];
      else merged[name] = value;
    }
    builder
      .overrideProvider(ConfigService)
      .useValue(new ConfigService(validateEnv(merged)));
  }
  options.configure?.(builder);

  const moduleRef = await builder.compile();
  const app =
    moduleRef.createNestApplication<NestExpressApplication>(NEST_APP_OPTIONS);
  try {
    configureApp(app);
    await app.init();
  } catch (err) {
    // e.g. a test asserting that a configuration refuses to start: release
    // the Prisma/Redis connections the module already opened.
    await app.close().catch(() => undefined);
    throw err;
  }

  return {
    app,
    http: () => request(app.getHttpServer()),
    prisma: app.get(PrismaService),
    redis: app.get<Redis>(REDIS),
    moduleRef,
    get sms(): MockSmsProvider {
      // Resolved lazily: apps booted without the sms feature have no provider.
      const smsProvider = app.get<unknown>(SMS_PROVIDER, { strict: false });
      if (!(smsProvider instanceof MockSmsProvider)) {
        throw new Error('The SMS inbox needs SMS_PROVIDER=mock');
      }
      return smsProvider;
    },
    close: () => app.close(),
  };
}

async function platformWithFeatures(options: TestAppOptions) {
  const platform = await import('../../src/app.platform.js');
  const features = await Promise.all(
    (options.features ?? []).map(async (name) => {
      const [file, exportName] = FEATURE_MODULE_FILES[name];
      const mod = (await import(`../../src/${file}`)) as Record<
        string,
        Type<unknown>
      >;
      return mod[exportName];
    }),
  );
  return {
    imports: [
      ...platform.PLATFORM_IMPORTS,
      ...features,
      ...(options.imports ?? []),
    ],
    controllers: [
      ...platform.PLATFORM_CONTROLLERS,
      ...(options.controllers ?? []),
    ],
    providers: [...platform.PLATFORM_PROVIDERS, ...(options.providers ?? [])],
  };
}
