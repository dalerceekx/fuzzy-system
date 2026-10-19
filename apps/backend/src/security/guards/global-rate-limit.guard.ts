import {
  Injectable,
  Logger,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { rateLimitIpKey } from '../../common/context/client-ip.js';
import { SKIP_GLOBAL_RATE_LIMIT_KEY } from '../../common/decorators/skip-global-rate-limit.decorator.js';
import { Errors } from '../../common/errors/app.exception.js';
import type { Env } from '../../config/env.js';
import { RateLimitService } from '../rate-limit.service.js';

const WINDOW_SECONDS = 60;

/** Per-IP request budget for every route except @SkipGlobalRateLimit(). */
@Injectable()
export class GlobalRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(GlobalRateLimitGuard.name);
  private readonly limit: number;

  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimit: RateLimitService,
    config: ConfigService<Env, true>,
  ) {
    this.limit = config.get('RATE_LIMIT_GLOBAL_PER_MINUTE', { infer: true });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const skip = this.reflector.getAllAndOverride<boolean | undefined>(
      SKIP_GLOBAL_RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (skip === true) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const key = `rl:global:ip:${rateLimitIpKey(request.ip)}`;
    let result;
    try {
      result = await this.rateLimit.hit(key, this.limit, WINDOW_SECONDS);
    } catch (err) {
      // Fail open: this limiter only absorbs floods. Endpoints that need a
      // hard limit (login, OTP, SMS) enforce their own and fail closed.
      this.logger.error(
        { error: err instanceof Error ? err.name : 'unknown' },
        'global rate limiter unavailable',
      );
      return true;
    }
    if (!result.allowed) throw Errors.tooManyRequests(result.retryAfterSeconds);
    return true;
  }
}
