import type { Redis } from 'ioredis';
import { maskPhone } from '../../src/common/phone.js';
import { EncryptionService } from '../../src/security/encryption.service.js';
import { MockSmsProvider } from '../../src/sms/providers/mock-sms.provider.js';
import { SMS_QUEUE_KEYS, SmsQueue } from '../../src/sms/sms.queue.js';
import { otpMessageText, SmsService } from '../../src/sms/sms.service.js';
import {
  SMS_PROVIDER,
  SmsProviderError,
  type SmsMessageInput,
} from '../../src/sms/sms.types.js';
import { SmsWorker } from '../../src/sms/sms.worker.js';
import { createTestApp, type TestApp } from '../utils/app.js';
import { uniquePhone } from '../utils/factories.js';

/** Mock inbox whose next `failures` sends throw the given error. */
class FlakyProvider extends MockSmsProvider {
  failures = 0;
  error: Error = new SmsProviderError('HTTP_503', true);
  calls = 0;

  override send(message: SmsMessageInput) {
    this.calls += 1;
    if (this.failures > 0) {
      this.failures -= 1;
      return Promise.reject(this.error);
    }
    return super.send(message);
  }
}

/** Every value stored in Redis, whatever its type. */
async function allRedisValues(redis: Redis): Promise<string[]> {
  const values: string[] = [];
  for (const key of await redis.keys('*')) {
    values.push(key);
    const type = await redis.type(key);
    if (type === 'string') values.push((await redis.get(key)) ?? '');
    if (type === 'list') values.push(...(await redis.lrange(key, 0, -1)));
    if (type === 'zset') values.push(...(await redis.zrange(key, '0', '-1')));
    if (type === 'set') values.push(...(await redis.smembers(key)));
    if (type === 'hash')
      values.push(...Object.values(await redis.hgetall(key)));
  }
  return values;
}

describe('SMS queue and worker', () => {
  let testApp: TestApp;
  let provider: FlakyProvider;
  let queue: SmsQueue;
  let worker: SmsWorker;
  let sms: SmsService;

  beforeAll(async () => {
    provider = new FlakyProvider();
    testApp = await createTestApp({
      features: ['sms'],
      env: { SMS_MAX_SEND_ATTEMPTS: '3', OTP_TTL_SECONDS: '120' },
      configure: (builder) =>
        builder.overrideProvider(SMS_PROVIDER).useValue(provider),
    });
    queue = testApp.app.get(SmsQueue);
    worker = testApp.app.get(SmsWorker);
    sms = testApp.app.get(SmsService);
  });

  afterEach(() => {
    provider.failures = 0;
    provider.error = new SmsProviderError('HTTP_503', true);
  });

  afterAll(async () => {
    await testApp.close();
  });

  const row = (id: string) =>
    testApp.prisma.smsMessage.findUniqueOrThrow({ where: { id } });

  it('stores only an encrypted, expiring payload in Redis and a masked phone in the DB', async () => {
    const phone = await uniquePhone();
    const code = '730194';
    const id = await queue.enqueue({
      to: phone,
      text: otpMessageText(code),
      purpose: 'PHONE_VERIFICATION',
      provider: 'mock',
    });

    const values = await allRedisValues(testApp.redis);
    const jobKey = `${SMS_QUEUE_KEYS.jobPrefix}${id}`;
    expect(values).toContain(jobKey);
    for (const value of values) {
      expect(value).not.toContain(code);
      expect(value).not.toContain(phone.slice(1));
      expect(value).not.toContain('tasdiqlash');
    }
    const ttl = await testApp.redis.ttl(jobKey);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(120);

    // Positive control: the payload really is the job, encrypted.
    const payload = (await testApp.redis.get(jobKey)) ?? '';
    const decrypted = testApp.app
      .get(EncryptionService)
      .decrypt(payload, `sms.job:${id}`);
    expect(decrypted).toContain(code);

    const stored = await row(id);
    expect(stored).toMatchObject({
      status: 'QUEUED',
      phoneMasked: maskPhone(phone),
      purpose: 'PHONE_VERIFICATION',
      provider: 'mock',
    });
    expect(JSON.stringify(stored)).not.toContain(code);

    await worker.processNow(id);
    expect(await row(id)).toMatchObject({ status: 'SENT', attempts: 1 });
    expect(await testApp.redis.exists(jobKey)).toBe(0);
    expect(
      await testApp.redis.lrange(SMS_QUEUE_KEYS.processing, 0, -1),
    ).not.toContain(id);
  });

  it('sendOtp delivers inline (NODE_ENV=test) after transient failures', async () => {
    const phone = await uniquePhone();
    provider.failures = 2;
    const before = provider.calls;
    await sms.sendOtp({ phone, code: '615243', purpose: 'PASSWORD_RESET' });
    expect(provider.calls - before).toBe(3);
    expect(provider.lastTo(phone)?.text).toBe(otpMessageText('615243'));
  });

  it('does not retry an unknown ambiguous error and keeps only its class', async () => {
    const phone = await uniquePhone();
    provider.failures = 10;
    provider.error = new Error(`upstream said Bearer sk-live-123 for ${phone}`);
    const id = await queue.enqueue({
      to: phone,
      text: otpMessageText('908172'),
      purpose: 'PHONE_VERIFICATION',
      provider: 'mock',
    });
    const before = provider.calls;
    await worker.processNow(id);

    expect(provider.calls - before).toBe(1);
    expect(await row(id)).toMatchObject({
      status: 'FAILED',
      attempts: 1,
      lastError: 'Error',
      providerMessageId: null,
    });
    expect(await testApp.redis.lrange(SMS_QUEUE_KEYS.dead, 0, -1)).toContain(
      id,
    );
    expect(await testApp.redis.exists(`${SMS_QUEUE_KEYS.jobPrefix}${id}`)).toBe(
      0,
    );
  });

  it('sendOtp never throws, even when the provider keeps failing', async () => {
    const phone = await uniquePhone();
    provider.failures = 10;
    await expect(
      sms.sendOtp({ phone, code: '112233', purpose: 'PHONE_VERIFICATION' }),
    ).resolves.toBeUndefined();
    expect(provider.lastTo(phone)).toBeUndefined();
  });

  it('drops a job whose encrypted payload expired with the OTP', async () => {
    const phone = await uniquePhone();
    const id = await queue.enqueue({
      to: phone,
      text: otpMessageText('445566'),
      purpose: 'PHONE_VERIFICATION',
      provider: 'mock',
    });
    await testApp.redis.del(`${SMS_QUEUE_KEYS.jobPrefix}${id}`);
    await worker.processNow(id);
    expect(provider.lastTo(phone)).toBeUndefined();
    expect(await row(id)).toMatchObject({
      status: 'FAILED',
      lastError: 'EXPIRED',
    });
  });

  it('bounds queue TTL by the original OTP deadline instead of enqueue time', async () => {
    const expiresAt = Date.now() + 30_000;
    const id = await queue.enqueue({
      to: await uniquePhone(),
      text: otpMessageText('445566'),
      purpose: 'PHONE_VERIFICATION',
      provider: 'mock',
      expiresAt,
    });
    const ttl = await testApp.redis.pttl(`${SMS_QUEUE_KEYS.jobPrefix}${id}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(30_000);
    const claimed = await queue.claim(id);
    expect(claimed?.job?.expiresAt).toBe(expiresAt);
    await queue.ack(id);
  });

  it('does not send a code that expired before it could be enqueued', async () => {
    const phone = await uniquePhone();
    const id = await queue.enqueue({
      to: phone,
      text: otpMessageText('445566'),
      purpose: 'PHONE_VERIFICATION',
      provider: 'mock',
      expiresAt: Date.now() - 1,
    });
    await worker.processNow(id);
    expect(provider.lastTo(phone)).toBeUndefined();
    expect(await row(id)).toMatchObject({
      status: 'FAILED',
      lastError: 'EXPIRED',
    });
  });

  it('rejects a payload moved to another job id (AAD binding)', async () => {
    const [a, b] = [await uniquePhone(), await uniquePhone()];
    const enqueue = (to: string) =>
      queue.enqueue({
        to,
        text: otpMessageText('101010'),
        purpose: 'PHONE_VERIFICATION',
        provider: 'mock',
      });
    const idA = await enqueue(a);
    const idB = await enqueue(b);
    const payloadA =
      (await testApp.redis.get(`${SMS_QUEUE_KEYS.jobPrefix}${idA}`)) ?? '';
    await testApp.redis.set(
      `${SMS_QUEUE_KEYS.jobPrefix}${idB}`,
      payloadA,
      'KEEPTTL',
    );

    await worker.processNow(idB);
    expect(await row(idB)).toMatchObject({
      status: 'FAILED',
      lastError: 'DECRYPT_FAILED',
    });
    expect(provider.lastTo(a)).toBeUndefined();
    await worker.processNow(idA);
    expect(provider.lastTo(a)).toBeDefined();
  });

  it('requeues jobs of a crashed worker (no lease) but not leased ones', async () => {
    const enqueue = async () =>
      queue.enqueue({
        to: await uniquePhone(),
        text: otpMessageText('202020'),
        purpose: 'PHONE_VERIFICATION',
        provider: 'mock',
      });
    const crashed = await enqueue();
    const live = await enqueue();
    expect(await queue.claim(crashed)).toMatchObject({ id: crashed });
    expect(await queue.claim(live)).toMatchObject({ id: live });
    await testApp.redis.del(`${SMS_QUEUE_KEYS.leasePrefix}${crashed}`);

    expect(await queue.recoverStale()).toBe(1);
    expect(await testApp.redis.lrange(SMS_QUEUE_KEYS.ready, 0, -1)).toContain(
      crashed,
    );
    expect(
      await testApp.redis.lrange(SMS_QUEUE_KEYS.processing, 0, -1),
    ).toContain(live);

    await worker.processNow(crashed);
    expect(await row(crashed)).toMatchObject({ status: 'SENT' });
    await queue.ack(live);
  });

  it('background worker delivers queued jobs and stops gracefully', async () => {
    const phone = await uniquePhone();
    worker.start();
    try {
      const id = await queue.enqueue({
        to: phone,
        text: otpMessageText('303030'),
        purpose: 'PHONE_VERIFICATION',
        provider: 'mock',
      });
      worker.notify();
      await vi.waitFor(
        async () => expect((await row(id)).status).toBe('SENT'),
        { timeout: 5_000, interval: 50 },
      );
      expect(provider.lastTo(phone)?.text).toBe(otpMessageText('303030'));
    } finally {
      await worker.stop();
    }

    // Stopped: new jobs stay queued.
    const id = await queue.enqueue({
      to: await uniquePhone(),
      text: otpMessageText('404040'),
      purpose: 'PHONE_VERIFICATION',
      provider: 'mock',
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect((await row(id)).status).toBe('QUEUED');
    await worker.processNow(id);
  });

  it('background worker retries failed sends via the delayed set', async () => {
    const phone = await uniquePhone();
    provider.failures = 1;
    worker.start();
    try {
      const id = await queue.enqueue({
        to: phone,
        text: otpMessageText('505050'),
        purpose: 'PHONE_VERIFICATION',
        provider: 'mock',
      });
      worker.notify();
      await vi.waitFor(
        async () =>
          expect(await row(id)).toMatchObject({ status: 'SENT', attempts: 2 }),
        { timeout: 5_000, interval: 50 },
      );
    } finally {
      await worker.stop();
    }
  });
});
