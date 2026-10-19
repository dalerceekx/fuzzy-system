import {
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import type { Env } from '../config/env.js';
import { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { dbErrorInfo } from './db-errors.js';

export {
  dbErrorInfo,
  isCheckViolation,
  isDatabaseError,
  isForeignKeyViolation,
  isNotFoundError,
  isSerializationFailure,
  isUniqueViolation,
  type DbErrorInfo,
} from './db-errors.js';

export type Tx = Prisma.TransactionClient;

const UTC_ZONES = new Set([
  'UTC',
  'Etc/UTC',
  'UCT',
  'Etc/UCT',
  'GMT',
  'Etc/GMT',
  'Universal',
  'Zulu',
]);

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: ConfigService<Env, true>) {
    super({
      adapter: new PrismaPg({
        connectionString: config.get('DATABASE_URL', { infer: true }),
      }),
      transactionOptions: { maxWait: 5_000, timeout: 15_000 },
    });
  }

  async onModuleInit(): Promise<void> {
    let timeZone: string;
    try {
      const rows = await this.$queryRaw<Array<{ tz: string }>>`
        SELECT current_setting('TimeZone') AS tz`;
      timeZone = rows[0]?.tz ?? '';
    } catch (err) {
      // Not fatal: /health reports the database as down until it is back.
      this.logger.error(
        { db: dbErrorInfo(err) ?? { error: errorName(err) } },
        'database is not reachable at startup',
      );
      return;
    }
    // Columns are `timestamp without time zone` holding UTC. Prisma writes
    // UTC wall-clock values, but DEFAULT CURRENT_TIMESTAMP and now() follow
    // the session time zone, so a non-UTC session would silently shift
    // created_at and break every expiry comparison (sessions, OTPs, keys).
    if (!UTC_ZONES.has(timeZone)) {
      throw new Error(
        `PostgreSQL session TimeZone must be UTC (got "${timeZone}"). ` +
          'Set `timezone = UTC` for the server/database/role (or PGTZ=UTC).',
      );
    }
  }

  // Runs after every onModuleDestroy hook, so modules that flush work on
  // shutdown can still use the database.
  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
    this.logger.log('database connections closed');
  }
}

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}
