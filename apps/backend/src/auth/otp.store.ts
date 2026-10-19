import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import { rateLimitIpKey } from '../common/context/client-ip.js';
import { Errors } from '../common/errors/app.exception.js';
import type { Env } from '../config/env.js';
import { REDIS } from '../redis/redis.module.js';
import { hashIdentifier } from '../security/crypto.js';

const INITIALIZE = `
redis.call('HSET', KEYS[1], 'digest', ARGV[1], 'attempts', 0, 'maxAttempts', ARGV[2])
redis.call('PEXPIRE', KEYS[1], ARGV[3])
return 1
`;

// The digest comparison with the submitted code happens in constant time in
// Node. ARGV[1] fences that result against concurrent regeneration. A success
// removes the verifier atomically; a DB failure afterwards requires a resend.
const VERIFY = `
if redis.call('HGET', KEYS[1], 'digest') ~= ARGV[1] then return 0 end
local attempts = tonumber(redis.call('HGET', KEYS[1], 'attempts'))
local maximum = tonumber(redis.call('HGET', KEYS[1], 'maxAttempts'))
if not attempts or not maximum or attempts >= maximum then return 0 end
redis.call('HINCRBY', KEYS[1], 'attempts', 1)
if ARGV[2] == '1' then
  redis.call('DEL', KEYS[1])
  return 1
end
return 0
`;

// One reservation covers every route that can cause an OTP SMS. Check all
// limits before changing counters, and acquire the phone cooldown atomically.
// All keys share a Redis Cluster slot; neither phone nor IP appears in keys.
const RESERVE_SEND = `
local cooldown = redis.call('PTTL', KEYS[3])
if cooldown > 0 then return cooldown end
for i = 1, 2 do
  local count = tonumber(redis.call('GET', KEYS[i]) or '0')
  if count >= tonumber(ARGV[1]) then
    return math.max(1, redis.call('PTTL', KEYS[i]))
  end
end
for i = 1, 2 do
  if redis.call('INCR', KEYS[i]) == 1 then
    redis.call('PEXPIRE', KEYS[i], 3600000)
  end
end
redis.call('SET', KEYS[3], '1', 'PX', ARGV[2])
return 0
`;

/** Short-lived HMAC verifier; PostgreSQL retains transactional account binding. */
@Injectable()
export class OtpStore {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly config: ConfigService<Env, true>,
  ) {}

  static key(id: string): string {
    return `{otp}:verifier:${id}`;
  }

  static phoneCooldownKey(phone: string): string {
    return `{otp}:phone-cooldown:${hashIdentifier(phone)}`;
  }

  async initialize(
    id: string,
    digest: string,
    maxAttempts: number,
    expiresAt: Date,
  ): Promise<void> {
    await this.run(
      INITIALIZE,
      [OtpStore.key(id)],
      [digest, maxAttempts, Math.max(1, expiresAt.getTime() - Date.now())],
    );
  }

  async verify(
    id: string,
    expectedDigest: string,
    matches: boolean,
  ): Promise<boolean> {
    return (
      (await this.run(
        VERIFY,
        [OtpStore.key(id)],
        [expectedDigest, matches ? 1 : 0],
      )) === 1
    );
  }

  async reserveSend(phone: string, ip: string | undefined): Promise<void> {
    const retryMs = await this.run(
      RESERVE_SEND,
      [
        `{otp}:hour:phone:${hashIdentifier(phone)}`,
        `{otp}:hour:ip:${hashIdentifier(rateLimitIpKey(ip))}`,
        OtpStore.phoneCooldownKey(phone),
      ],
      [
        this.config.get('OTP_MAX_REQUESTS_PER_HOUR', { infer: true }),
        this.config.get('OTP_RESEND_COOLDOWN_SECONDS', { infer: true }) * 1000,
      ],
    );
    if (retryMs > 0) throw Errors.tooManyRequests(Math.ceil(retryMs / 1000));
  }

  private async run(
    script: string,
    keys: string[],
    args: Array<string | number>,
  ): Promise<number> {
    try {
      return Number(
        await this.redis.eval(script, keys.length, ...keys, ...args),
      );
    } catch {
      throw Errors.serviceUnavailable(
        'OTP_UNAVAILABLE',
        'Tasdiqlash xizmati vaqtincha ishlamayapti. Keyinroq urinib ko‘ring',
      );
    }
  }
}
