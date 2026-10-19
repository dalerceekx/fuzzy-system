import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS } from '../redis/redis.module.js';

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  /** 0 when allowed; otherwise seconds until the window resets (≥ 1). */
  retryAfterSeconds: number;
}

// INCR and PEXPIRE in one atomic script: a counter can never be left
// without an expiry (which would block a client forever).
const HIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { count, ttl }
`;

type HitCommand = (key: string, windowMs: number) => Promise<[number, number]>;

/**
 * Fixed-window counters in Redis. Keys are namespaced by callers, e.g.
 * `rl:login:ip:<ip>` or `rl:login:acct:<hashIdentifier(phone)>`; never put
 * raw phone numbers or tokens into keys.
 */
@Injectable()
export class RateLimitService {
  private readonly hitCommand: HitCommand;

  constructor(@Inject(REDIS) private readonly redis: Redis) {
    if (!('rateLimitHit' in redis)) {
      redis.defineCommand('rateLimitHit', { numberOfKeys: 1, lua: HIT_SCRIPT });
    }
    const command = (redis as unknown as { rateLimitHit: HitCommand })
      .rateLimitHit;
    this.hitCommand = command.bind(redis);
  }

  async hit(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<RateLimitResult> {
    const windowMs = Math.max(1, Math.round(windowSeconds * 1000));
    const [count, ttlMs] = await this.hitCommand(key, windowMs);
    const allowed = count <= limit;
    return {
      allowed,
      count,
      retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil(ttlMs / 1000)),
    };
  }

  async get(key: string): Promise<number> {
    const value = await this.redis.get(key);
    const count = value === null ? 0 : Number.parseInt(value, 10);
    return Number.isFinite(count) ? count : 0;
  }

  async reset(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async lock(key: string, seconds: number): Promise<void> {
    await this.redis.set(key, '1', 'EX', Math.max(1, Math.ceil(seconds)));
  }

  /** Takes a cooldown only if absent, so concurrent resends have one winner. */
  async acquireLock(key: string, seconds: number): Promise<boolean> {
    return (
      (await this.redis.set(
        key,
        '1',
        'EX',
        Math.max(1, Math.ceil(seconds)),
        'NX',
      )) === 'OK'
    );
  }

  /** Remaining lock time in seconds, 0 if not locked. */
  async lockedFor(key: string): Promise<number> {
    const ttlMs = await this.redis.pttl(key);
    return ttlMs > 0 ? Math.ceil(ttlMs / 1000) : 0;
  }
}
