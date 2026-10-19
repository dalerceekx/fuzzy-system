import {
  Inject,
  Injectable,
  Logger,
  type CanActivate,
  type ExecutionContext,
  type RawBodyRequest,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { Redis } from 'ioredis';
import { rateLimitIpKey } from '../../common/context/client-ip.js';
import { Errors } from '../../common/errors/app.exception.js';
import type { Env } from '../../config/env.js';
import { REDIS } from '../../redis/redis.module.js';
import { sha256Hex } from '../../security/crypto.js';
import { RateLimitService } from '../../security/rate-limit.service.js';
import { checkWebhookSignature } from './sms-signature.js';

const RATE_LIMIT_PER_MINUTE = 120;
// Longer than the ±300 s timestamp window, so a captured request can never
// be replayed while its timestamp is still accepted.
const REPLAY_WINDOW_SECONDS = 600;

/** The spent replay key, so the controller can release it on failure. */
export const SMS_WEBHOOK_REPLAY_KEY = Symbol('smsWebhookReplayKey');
export type SmsWebhookRequest = RawBodyRequest<Request> & {
  [SMS_WEBHOOK_REPLAY_KEY]?: string;
};

/**
 * Authenticates delivery-report webhooks before the body is validated:
 * 404 while SMS_WEBHOOK_SECRET is unset, per-IP rate limit (fails closed),
 * HMAC signature + timestamp window, single-use signatures.
 */
@Injectable()
export class SmsWebhookGuard implements CanActivate {
  private readonly logger = new Logger(SmsWebhookGuard.name);
  private readonly secret: string | undefined;

  constructor(
    private readonly rateLimit: RateLimitService,
    @Inject(REDIS) private readonly redis: Redis,
    config: ConfigService<Env, true>,
  ) {
    this.secret = config.get('SMS_WEBHOOK_SECRET', { infer: true });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.secret) throw Errors.notFound();
    const req = context.switchToHttp().getRequest<SmsWebhookRequest>();

    const limit = await this.rateLimit.hit(
      `rl:sms-webhook:ip:${rateLimitIpKey(req.ip)}`,
      RATE_LIMIT_PER_MINUTE,
      60,
    );
    if (!limit.allowed) throw Errors.tooManyRequests(limit.retryAfterSeconds);

    const signature = req.headers['x-sms-signature'];
    const check = checkWebhookSignature({
      secret: this.secret,
      timestamp: req.headers['x-sms-timestamp'],
      signature,
      rawBody: req.rawBody,
    });
    if (check !== 'ok') return this.reject(check);

    const replayKey = `sms:webhook:seen:${sha256Hex(String(signature).toLowerCase())}`;
    const firstUse = await this.redis.set(
      replayKey,
      '1',
      'EX',
      REPLAY_WINDOW_SECONDS,
      'NX',
    );
    if (firstUse !== 'OK') return this.reject('replayed');
    req[SMS_WEBHOOK_REPLAY_KEY] = replayKey;
    return true;
  }

  private reject(reason: string): never {
    this.logger.warn({ reason }, 'sms webhook rejected');
    throw Errors.unauthorized('Imzo noto‘g‘ri', 'INVALID_SIGNATURE');
  }
}
