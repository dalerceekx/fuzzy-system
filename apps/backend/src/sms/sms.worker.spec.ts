import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { ClaimedJob, SmsJob, SmsQueue } from './sms.queue.js';
import { SmsProviderError, type SmsProvider } from './sms.types.js';
import { SmsWorker, retryDelayMs, sanitizedErrorCode } from './sms.worker.js';
import type { SmsDeliveryReports } from './webhook/sms-delivery-reports.js';

const MAX_ATTEMPTS = 3;

/** In-memory stand-in for SmsQueue with the same claim/ack semantics. */
class FakeQueue {
  readonly maxAgeMs = 300_000;
  waiting = new Map<string, SmsJob | null>();
  acked: string[] = [];
  dead: string[] = [];
  retries: Array<{ attempt: number; delayMs: number }> = [];
  submitted = new Set<string>();
  private sequence = 0;

  add(job: Partial<SmsJob> = {}): string {
    const id = job.smsMessageId ?? `sms-${(this.sequence += 1)}`;
    this.waiting.set(id, {
      smsMessageId: id,
      to: '+998901234567',
      text: 'Mening Fermam: tasdiqlash kodi 111222. Kodni hech kimga bermang.',
      purpose: 'PHONE_VERIFICATION',
      attempt: 0,
      createdAt: Date.now(),
      ...job,
    });
    return id;
  }

  claim(id: string): Promise<ClaimedJob | null> {
    if (!this.waiting.has(id)) return Promise.resolve(null);
    const job = this.waiting.get(id) ?? null;
    this.waiting.delete(id);
    return Promise.resolve(
      job ? { id, job } : { id, job: null, reason: 'EXPIRED' },
    );
  }

  claimNext(): Promise<ClaimedJob | null> {
    const [id] = this.waiting.keys();
    return id ? this.claim(id) : Promise.resolve(null);
  }

  ack(id: string) {
    this.acked.push(id);
    return Promise.resolve();
  }

  deadLetter(id: string) {
    this.dead.push(id);
    return Promise.resolve();
  }

  retry(job: SmsJob, delayMs: number) {
    this.retries.push({ attempt: job.attempt, delayMs });
    this.waiting.set(job.smsMessageId, job);
    return Promise.resolve();
  }

  recoverStale() {
    return Promise.resolve(0);
  }

  beginSubmission(id: string) {
    if (this.submitted.has(id)) return Promise.resolve(false);
    this.submitted.add(id);
    return Promise.resolve(true);
  }
}

function setup(send: SmsProvider['send']) {
  const queue = new FakeQueue();
  const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
  const prisma = {
    smsMessage: {
      update: vi.fn(
        ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          updates.push({ id: where.id, data });
          return Promise.resolve({});
        },
      ),
    },
  };
  const provider: SmsProvider = { name: 'fake', send: vi.fn(send) };
  const reports = { applyPending: vi.fn(() => Promise.resolve()) };
  const values: Partial<Env> = {
    NODE_ENV: 'test',
    SMS_MAX_SEND_ATTEMPTS: MAX_ATTEMPTS,
  };
  const config = {
    get: (key: keyof Env) => values[key],
  } as unknown as ConfigService<Env, true>;
  const worker = new SmsWorker(
    queue as unknown as SmsQueue,
    prisma as unknown as PrismaService,
    provider,
    reports as unknown as SmsDeliveryReports,
    config,
  );
  return { queue, updates, provider, reports, worker };
}

const last = <T>(items: T[]) => items[items.length - 1];

describe('SmsWorker', () => {
  beforeAll(() => Logger.overrideLogger(false));
  afterAll(() => Logger.overrideLogger(['log', 'error', 'warn']));

  it('sends, acknowledges and records SENT with the provider id', async () => {
    const { queue, updates, reports, worker } = setup(() =>
      Promise.resolve({ providerMessageId: 'p-1' }),
    );
    const id = queue.add();
    await worker.processNow(id);
    expect(queue.acked).toStrictEqual([id]);
    expect(last(updates).data).toMatchObject({
      status: 'SENT',
      attempts: 1,
      providerMessageId: 'p-1',
      lastError: null,
    });
    // Early delivery reports are applied only after the id is stored.
    expect(reports.applyPending).toHaveBeenCalledWith('p-1');
    expect(reports.applyPending.mock.invocationCallOrder[0]).toBeGreaterThan(
      vi.mocked(
        (worker as unknown as { prisma: PrismaService }).prisma.smsMessage
          .update,
      ).mock.invocationCallOrder[0],
    );
  });

  it('a failing early-report lookup does not affect the sent message', async () => {
    const { queue, reports, provider, worker } = setup(() =>
      Promise.resolve({ providerMessageId: 'p-5' }),
    );
    reports.applyPending.mockRejectedValue(new Error('redis down'));
    const id = queue.add();
    await expect(worker.processNow(id)).resolves.toBeUndefined();
    expect(provider.send).toHaveBeenCalledTimes(1);
    expect(queue.acked).toStrictEqual([id]);
  });

  it('retries transient failures with backoff, then succeeds', async () => {
    let calls = 0;
    const { queue, updates, worker } = setup(() =>
      ++calls < 3
        ? Promise.reject(new SmsProviderError('HTTP_503', true))
        : Promise.resolve({ providerMessageId: 'p-2' }),
    );
    const id = queue.add();
    await worker.processNow(id);
    expect(queue.retries.map((retry) => retry.attempt)).toStrictEqual([1, 2]);
    expect(queue.acked).toStrictEqual([id]);
    expect(queue.dead).toStrictEqual([]);
    expect(updates[0].data).toMatchObject({
      attempts: 1,
      lastError: 'HTTP_503',
    });
    expect(last(updates).data).toMatchObject({ status: 'SENT', attempts: 3 });
  });

  it('never retries an unknown ambiguous error and stores only its class', async () => {
    const { queue, updates, provider, worker } = setup(() =>
      Promise.reject(
        new Error('connect to https://key:secret@x failed +998901234567'),
      ),
    );
    const id = queue.add();
    await worker.processNow(id);
    expect(provider.send).toHaveBeenCalledTimes(1);
    expect(queue.dead).toStrictEqual([id]);
    expect(last(updates).data).toStrictEqual({
      status: 'FAILED',
      attempts: 1,
      lastError: 'Error',
    });
  });

  it('does not resubmit a recovered job with a durable submission marker', async () => {
    const { queue, provider, worker, updates } = setup(() =>
      Promise.resolve({ providerMessageId: 'never' }),
    );
    Object.assign(provider, { requiresSubmissionGuard: true });
    const id = queue.add();
    queue.submitted.add(id);
    await worker.processNow(id);
    expect(provider.send).not.toHaveBeenCalled();
    expect(queue.dead).toStrictEqual([id]);
    expect(last(updates).data).toMatchObject({
      lastError: 'SUBMISSION_UNCERTAIN',
    });
  });

  it('does not call a real provider when the Redis submission guard fails', async () => {
    const { queue, provider, worker } = setup(() =>
      Promise.resolve({ providerMessageId: 'never' }),
    );
    Object.assign(provider, { requiresSubmissionGuard: true });
    vi.spyOn(queue, 'beginSubmission').mockRejectedValue(
      new Error('Redis down'),
    );
    const id = queue.add();
    await expect(worker.processNow(id)).rejects.toThrow('Redis down');
    expect(provider.send).not.toHaveBeenCalled();
  });

  it('does not retry permanent provider errors', async () => {
    const { queue, updates, provider, worker } = setup(() =>
      Promise.reject(new SmsProviderError('HOST_NOT_ALLOWED', false)),
    );
    const id = queue.add();
    await worker.processNow(id);
    expect(provider.send).toHaveBeenCalledTimes(1);
    expect(queue.dead).toStrictEqual([id]);
    expect(last(updates).data).toMatchObject({
      status: 'FAILED',
      lastError: 'HOST_NOT_ALLOWED',
    });
  });

  it('drops jobs whose payload expired with the OTP, without sending', async () => {
    const { queue, updates, provider, worker } = setup(() =>
      Promise.resolve({ providerMessageId: 'never' }),
    );
    queue.waiting.set('gone', null);
    await worker.processNow('gone');
    expect(provider.send).not.toHaveBeenCalled();
    expect(queue.dead).toStrictEqual(['gone']);
    expect(last(updates).data).toStrictEqual({
      status: 'FAILED',
      lastError: 'EXPIRED',
    });
  });

  it('stops retrying once the next attempt would outlive the OTP', async () => {
    const { queue, provider, worker } = setup(() =>
      Promise.reject(new SmsProviderError('TIMEOUT', true)),
    );
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    try {
      const id = queue.add({ createdAt: now - queue.maxAgeMs + 1 });
      await worker.processNow(id);
      expect(provider.send).toHaveBeenCalledTimes(1);
      expect(queue.dead).toStrictEqual([id]);
    } finally {
      clock.mockRestore();
    }
  });

  it('drops a claimed job when its original OTP deadline has passed', async () => {
    const { queue, provider, worker, updates } = setup(() =>
      Promise.resolve({ providerMessageId: 'never' }),
    );
    const id = queue.add({ expiresAt: Date.now() - 1 });
    await worker.processNow(id);
    expect(provider.send).not.toHaveBeenCalled();
    expect(queue.dead).toStrictEqual([id]);
    expect(last(updates).data).toMatchObject({ lastError: 'OTP_EXPIRED' });
  });

  it('does not schedule retries beyond the original OTP deadline', async () => {
    const { queue, provider, worker } = setup(() =>
      Promise.reject(new SmsProviderError('SAFE_REJECTION', true)),
    );
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    try {
      const id = queue.add({ expiresAt: now + 1 });
      await worker.processNow(id);
      expect(provider.send).toHaveBeenCalledTimes(1);
      expect(queue.retries).toHaveLength(0);
      expect(queue.dead).toStrictEqual([id]);
    } finally {
      clock.mockRestore();
    }
  });

  it('a failing status update never causes a second send', async () => {
    const { queue, provider, worker } = setup(() =>
      Promise.resolve({ providerMessageId: 'p-3' }),
    );
    const prisma = (worker as unknown as { prisma: PrismaService }).prisma;
    vi.mocked(prisma.smsMessage.update).mockRejectedValue(new Error('db down'));
    const id = queue.add();
    await worker.processNow(id);
    expect(provider.send).toHaveBeenCalledTimes(1);
    expect(queue.acked).toStrictEqual([id]);
  });

  it('background loop processes queued jobs and stops gracefully', async () => {
    const { queue, worker } = setup(() =>
      Promise.resolve({ providerMessageId: 'p-4' }),
    );
    const first = queue.add();
    worker.start();
    await vi.waitFor(() => expect(queue.acked).toStrictEqual([first]));
    const second = queue.add();
    worker.notify();
    await vi.waitFor(() => expect(queue.acked).toContain(second));
    await worker.stop();
    queue.add();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(queue.acked).toHaveLength(2);
  });
});

describe('retryDelayMs', () => {
  it('grows exponentially with jitter and is capped', () => {
    expect(retryDelayMs(1, 2_000, () => 1)).toBe(2_000);
    expect(retryDelayMs(2, 2_000, () => 1)).toBe(4_000);
    expect(retryDelayMs(2, 2_000, () => 0)).toBe(2_000);
    expect(retryDelayMs(20, 2_000, () => 1)).toBe(60_000);
  });
});

describe('sanitizedErrorCode', () => {
  it('keeps only codes / class names', () => {
    expect(sanitizedErrorCode(new SmsProviderError('HTTP_500', true))).toBe(
      'HTTP_500',
    );
    expect(sanitizedErrorCode(new TypeError('secret +998901234567'))).toBe(
      'TypeError',
    );
    expect(sanitizedErrorCode('raw string')).toBe('UNKNOWN');
  });
});
