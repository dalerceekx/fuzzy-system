import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service.js';
import { validateEnv, type Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PasswordService } from '../security/password.service.js';

/**
 * Minimal context for operator CLIs: the API's own env validation, database
 * client, audit writer and password hashing — no HTTP, Redis or guards.
 * Providers are wired with explicit factories (no reliance on emitted
 * decorator metadata), so the CLI behaves the same whether it runs compiled
 * (`node dist/cli/…`) or from source through esbuild-based runners like tsx.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      ignoreEnvFile: process.env.NODE_ENV === 'test',
      validate: validateEnv,
    }),
  ],
  providers: [
    {
      provide: PrismaService,
      useFactory: (config: ConfigService<Env, true>) =>
        new PrismaService(config),
      inject: [ConfigService],
    },
    {
      provide: AuditService,
      useFactory: (prisma: PrismaService) => new AuditService(prisma),
      inject: [PrismaService],
    },
    {
      provide: PasswordService,
      useFactory: (config: ConfigService<Env, true>) =>
        new PasswordService(config),
      inject: [ConfigService],
    },
  ],
})
export class CliModule {}
