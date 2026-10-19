import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import { maskPhone } from '../common/phone.js';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { REDIS } from '../redis/redis.module.js';
import { EncryptionService } from '../security/encryption.service.js';

/** Decrypted queue job. It contains the OTP text: never log it. */
export interface SmsJob {
  smsMessageId: string;
  to: string;
  text: string;
  purpose: string;
  attempt: number;
  /** Enqueue time (ms since epoch). */
  createdAt: number;
  /** Original OTP deadline. Optional only for jobs queued before this upgrade. */
  expiresAt?: number;
}

export type ClaimedJob =
  | { id: string; job: SmsJob }
  | { id: string; job: null; reason: 'EXPIRED' | 'DECRYPT_FAILED' };

// The `{sms}` hash tag keeps every key in one Redis Cluster slot, which the
// multi-key scripts below require.
export const SMS_QUEUE_KEYS = {
  ready: '{sms}:ready',
  processing: '{sms}:processing',
  delayed: '{sms}:delayed',
  dead: '{sms}:dead',
  jobPrefix: '{sms}:job:',
  leasePrefix: '{sms}:lease:',
  submissionPrefix: '{sms}:submitted:',
} as const;

// A claimed job keeps its lease while being sent (provider timeout is 10 s);
// jobs in the processing list without a lease belong to a crashed worker.
const LEASE_MS = 60_000;
const DEAD_LETTER_MAX = 1_000;
const PROMOTE_BATCH = 100;

// Moves due retries to the ready list, then claims the oldest ready job and
// takes its lease in the same atomic step, so recovery can never requeue a
// job another worker is sending.
const CLAIM_NEXT = `
local due = redis.call('ZRANGEBYSCORE', KEYS[3], '-inf', ARGV[1], 'LIMIT', 0, tonumber(ARGV[5]))
for _, id in ipairs(due) do
  redis.call('ZREM', KEYS[3], id)
  redis.call('RPUSH', KEYS[1], id)
end
local id = redis.call('LMOVE', KEYS[1], KEYS[2], 'RIGHT', 'LEFT')
if not id then return false end
redis.call('SET', ARGV[3] .. id, '1', 'PX', ARGV[4])
return { id, redis.call('GET', ARGV[2] .. id) or '' }
`;

// Claims one specific job (inline processing in tests) wherever it waits.
const CLAIM_ONE = `
local id = ARGV[1]
if redis.call('LREM', KEYS[1], 1, id) == 0 and redis.call('ZREM', KEYS[3], id) == 0 then
  return false
end
redis.call('LPUSH', KEYS[2], id)
redis.call('SET', ARGV[3] .. id, '1', 'PX', ARGV[4])
return { id, redis.call('GET', ARGV[2] .. id) or '' }
`;

const RECOVER = `
local ids = redis.call('LRANGE', KEYS[1], 0, -1)
local count = 0
for _, id in ipairs(ids) do
  if redis.call('EXISTS', ARGV[1] .. id) == 0 then
    redis.call('LREM', KEYS[1], 1, id)
    redis.call('RPUSH', KEYS[2], id)
    count = count + 1
  end
end
return count
`;

// Persist the decision before contacting a paid provider. A recovered job
// may have been accepted remotely before its worker died: never resend it.
const BEGIN_SUBMISSION = `
if redis.call('EXISTS', KEYS[1]) == 0 or redis.call('EXISTS', KEYS[2]) == 0 then
  return 0
end
if redis.call('SET', KEYS[3], '1', 'NX', 'PX', ARGV[1]) then return 1 end
return 0
`;

type ClaimReply = [string, string] | null;
interface QueueCommands {
  smsBeginSubmission(
    lease: string,
    job: string,
    submitted: string,
    ttlMs: number,
  ): Promise<number>;
  smsClaimNext(
    ready: string,
    processing: string,
    delayed: string,
    now: number,
    jobPrefix: string,
    leasePrefix: string,
    leaseMs: number,
    batch: number,
  ): Promise<ClaimReply>;
  smsClaimOne(
    ready: string,
    processing: string,
    delayed: string,
    id: string,
    jobPrefix: string,
    leasePrefix: string,
    leaseMs: number,
  ): Promise<ClaimReply>;
  smsRecover(
    processing: string,
    ready: string,
    leasePrefix: string,
  ): Promise<number>;
}

const jobAad = (id: string) => `sms.job:${id}`;

/**
 * Reliable Redis queue for outgoing SMS plus the `sms_messages` tracking
 * row. Payloads are AES-GCM encrypted (they contain the OTP) and expire
 * with the OTP, so a stuck queue never keeps usable codes around.
 */
@Injectable()
export class SmsQueue {
  private readonly commands: QueueCommands;
  private readonly ttlSeconds: number;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    config: ConfigService<Env, true>,
  ) {
    this.ttlSeconds = config.get('OTP_TTL_SECONDS', { infer: true });
    const scripts = [
      ['smsClaimNext', 3, CLAIM_NEXT],
      ['smsClaimOne', 3, CLAIM_ONE],
      ['smsRecover', 2, RECOVER],
      ['smsBeginSubmission', 3, BEGIN_SUBMISSION],
    ] as const;
    for (const [name, numberOfKeys, lua] of scripts) {
      if (!(name in redis)) redis.defineCommand(name, { numberOfKeys, lua });
    }
    this.commands = redis as unknown as QueueCommands;
  }

  /** Jobs older than this are dropped: their OTP has expired anyway. */
  get maxAgeMs(): number {
    return this.ttlSeconds * 1000;
  }

  /** Creates the tracking row and queues the job; returns the row id. */
  async enqueue(params: {
    to: string;
    text: string;
    purpose: string;
    provider: string;
    expiresAt?: number;
  }): Promise<string> {
    const createdAt = Date.now();
    const expiresAt = Math.min(
      params.expiresAt ?? createdAt + this.maxAgeMs,
      createdAt + this.maxAgeMs,
    );
    const row = await this.prisma.smsMessage.create({
      data: {
        phoneMasked: maskPhone(params.to),
        purpose: params.purpose,
        provider: params.provider,
      },
      select: { id: true },
    });
    const job: SmsJob = {
      smsMessageId: row.id,
      to: params.to,
      text: params.text,
      purpose: params.purpose,
      attempt: 0,
      createdAt,
      expiresAt,
    };
    try {
      await this.redis
        .multi()
        .set(this.jobKey(row.id), this.seal(job), 'PXAT', expiresAt)
        .lpush(SMS_QUEUE_KEYS.ready, row.id)
        .exec()
        .then(assertExec);
    } catch (err) {
      await this.prisma.smsMessage
        .update({
          where: { id: row.id },
          data: { status: 'FAILED', lastError: 'QUEUE_UNAVAILABLE' },
        })
        .catch(() => undefined);
      throw err;
    }
    return row.id;
  }

  async claimNext(now = Date.now()): Promise<ClaimedJob | null> {
    const reply = await this.commands.smsClaimNext(
      SMS_QUEUE_KEYS.ready,
      SMS_QUEUE_KEYS.processing,
      SMS_QUEUE_KEYS.delayed,
      now,
      SMS_QUEUE_KEYS.jobPrefix,
      SMS_QUEUE_KEYS.leasePrefix,
      LEASE_MS,
      PROMOTE_BATCH,
    );
    return this.open(reply);
  }

  async claim(id: string): Promise<ClaimedJob | null> {
    const reply = await this.commands.smsClaimOne(
      SMS_QUEUE_KEYS.ready,
      SMS_QUEUE_KEYS.processing,
      SMS_QUEUE_KEYS.delayed,
      id,
      SMS_QUEUE_KEYS.jobPrefix,
      SMS_QUEUE_KEYS.leasePrefix,
      LEASE_MS,
    );
    return this.open(reply);
  }

  /** Done (sent or dropped): removes the job and its payload. */
  async ack(id: string): Promise<void> {
    await this.redis
      .multi()
      .lrem(SMS_QUEUE_KEYS.processing, 1, id)
      .del(this.leaseKey(id), this.jobKey(id))
      .exec()
      .then(assertExec);
  }

  /** False means absent lease/payload or a potentially accepted earlier send. */
  async beginSubmission(id: string): Promise<boolean> {
    return (
      (await this.commands.smsBeginSubmission(
        this.leaseKey(id),
        this.jobKey(id),
        `${SMS_QUEUE_KEYS.submissionPrefix}${id}`,
        this.maxAgeMs + LEASE_MS,
      )) === 1
    );
  }

  /** Schedules another attempt; the payload keeps its original expiry. */
  async retry(job: SmsJob, delayMs: number): Promise<void> {
    const id = job.smsMessageId;
    await this.redis
      .multi()
      .set(this.jobKey(id), this.seal(job), 'KEEPTTL', 'XX')
      .zadd(SMS_QUEUE_KEYS.delayed, Date.now() + delayMs, id)
      .lrem(SMS_QUEUE_KEYS.processing, 1, id)
      // Only known safe provider rejections reach retry().
      .del(this.leaseKey(id), `${SMS_QUEUE_KEYS.submissionPrefix}${id}`)
      .exec()
      .then(assertExec);
  }

  /** Gives up: drops the payload and records the id (no content). */
  async deadLetter(id: string): Promise<void> {
    await this.redis
      .multi()
      .lrem(SMS_QUEUE_KEYS.processing, 1, id)
      .del(this.leaseKey(id), this.jobKey(id))
      .lpush(SMS_QUEUE_KEYS.dead, id)
      .ltrim(SMS_QUEUE_KEYS.dead, 0, DEAD_LETTER_MAX - 1)
      .exec()
      .then(assertExec);
  }

  /** Requeues processing jobs whose worker died (lease expired). */
  recoverStale(): Promise<number> {
    return this.commands.smsRecover(
      SMS_QUEUE_KEYS.processing,
      SMS_QUEUE_KEYS.ready,
      SMS_QUEUE_KEYS.leasePrefix,
    );
  }

  private seal(job: SmsJob): string {
    return this.encryption.encrypt(
      JSON.stringify(job),
      jobAad(job.smsMessageId),
    );
  }

  private open(reply: ClaimReply): ClaimedJob | null {
    if (!reply) return null;
    const [id, payload] = reply;
    if (payload === '') return { id, job: null, reason: 'EXPIRED' };
    let job: SmsJob;
    try {
      job = JSON.parse(this.encryption.decrypt(payload, jobAad(id))) as SmsJob;
    } catch {
      return { id, job: null, reason: 'DECRYPT_FAILED' };
    }
    if (Date.now() >= (job.expiresAt ?? job.createdAt + this.maxAgeMs)) {
      return { id, job: null, reason: 'EXPIRED' };
    }
    return { id, job };
  }

  private jobKey(id: string): string {
    return `${SMS_QUEUE_KEYS.jobPrefix}${id}`;
  }

  private leaseKey(id: string): string {
    return `${SMS_QUEUE_KEYS.leasePrefix}${id}`;
  }
}

/** MULTI/EXEC reports per-command errors in its result, not by throwing. */
function assertExec(results: Array<[Error | null, unknown]> | null): void {
  if (!results) throw new Error('Redis transaction aborted');
  const failed = results.find(([err]) => err);
  if (failed?.[0]) throw failed[0];
}
