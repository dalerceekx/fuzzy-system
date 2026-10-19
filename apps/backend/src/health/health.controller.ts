import { Controller, Get, Inject, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { Redis } from 'ioredis';
import { Public } from '../common/decorators/public.decorator.js';
import { SkipGlobalRateLimit } from '../common/decorators/skip-global-rate-limit.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { REDIS } from '../redis/redis.module.js';
import {
  STORAGE_DRIVER,
  type StorageDriver,
} from '../storage/storage.types.js';

type CheckStatus = 'up' | 'down';

export interface HealthReport {
  status: 'ok' | 'error';
  checks: { database: CheckStatus; redis: CheckStatus; storage: CheckStatus };
}

const CHECK_TIMEOUT_MS = 3_000;
/**
 * /health is public and exempt from the global rate limit (load balancers
 * poll it), so dependency probes are shared: concurrent callers wait for one
 * in-flight probe and the result is reused for this long. A flood therefore
 * costs at most one DB/Redis/S3 round trip per window.
 */
export const HEALTH_CACHE_MS = 5_000;

/** Reports only 'up'/'down' — never error messages or configuration. */
@ApiTags('health')
@Public()
@SkipGlobalRateLimit()
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  private cached?: { report: Promise<HealthReport>; expiresAt: number };

  @Get()
  async check(
    @Res({ passthrough: true }) res: Response,
  ): Promise<HealthReport> {
    const report = await this.report();
    res.status(report.status === 'ok' ? 200 : 503);
    return report;
  }

  /** Liveness: the process serves HTTP; no dependency checks. */
  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  private report(): Promise<HealthReport> {
    const now = Date.now();
    if (this.cached && now < this.cached.expiresAt) return this.cached.report;
    const report = this.runChecks();
    // The window starts now, so callers arriving while the probe is in flight
    // share it; probe() never rejects, so the cached promise cannot either.
    this.cached = { report, expiresAt: now + HEALTH_CACHE_MS };
    return report;
  }

  private async runChecks(): Promise<HealthReport> {
    const [database, redis, storage] = await Promise.all([
      probe(() => this.prisma.$queryRaw`SELECT 1`),
      probe(() => this.redis.ping()),
      probe(() => this.storage.healthCheck()),
    ]);
    const checks = { database, redis, storage };
    const healthy = Object.values(checks).every((status) => status === 'up');
    return { status: healthy ? 'ok' : 'error', checks };
  }
}

async function probe(check: () => Promise<unknown>): Promise<CheckStatus> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), CHECK_TIMEOUT_MS);
  });
  try {
    await Promise.race([check(), timeout]);
    return 'up';
  } catch {
    return 'down';
  } finally {
    clearTimeout(timer);
  }
}
