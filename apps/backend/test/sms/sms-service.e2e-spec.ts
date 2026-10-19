import { ModulesContainer } from '@nestjs/core';
import { maskPhone } from '../../src/common/phone.js';
import {
  secondsUntilNextTashkentDay,
  todayInTashkent,
} from '../../src/common/time.js';
import { hashIdentifier } from '../../src/security/crypto.js';
import { SmsService } from '../../src/sms/sms.service.js';
import { createTestApp, type TestApp } from '../utils/app.js';
import { uniquePhone } from '../utils/factories.js';
import { uniqueIp } from '../utils/ips.js';
import { captureLogs, flushLogs } from '../utils/logs.js';
import { lastOtp } from '../utils/sms.js';
import { SmsQuotaProbeController } from './support/quota-probe.controller.js';

describe('SmsService', () => {
  let testApp: TestApp;
  let sms: SmsService;

  beforeAll(async () => {
    testApp = await createTestApp({
      features: ['sms'],
      controllers: [SmsQuotaProbeController],
      env: { SMS_DAILY_LIMIT_PER_PHONE: '3', SMS_DAILY_LIMIT_PER_IP: '5' },
    });
    sms = testApp.app.get(SmsService);
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('masks phone and never logs the code or text; DB keeps only the masked phone', async () => {
    const phone = await uniquePhone();
    const code = '864213';
    const logs = captureLogs();
    try {
      await sms.sendOtp({ phone, code, purpose: 'PHONE_VERIFICATION' });
      await flushLogs();
    } finally {
      logs.stop();
    }

    expect(lastOtp(testApp.sms, phone)).toBe(code);
    const text = logs.text();
    expect(text).not.toContain(code);
    expect(text).not.toContain(phone);
    expect(text).not.toContain(phone.slice(4));
    expect(text).not.toContain('tasdiqlash');

    // Positive controls: queued + sent lines with masked phone and sms id.
    const lines = logs.json();
    const queued = lines.find((line) => line.msg === 'otp sms queued');
    const sent = lines.find(
      (line) => line.msg === 'otp sms accepted by provider',
    );
    expect(queued).toMatchObject({ phone: maskPhone(phone), status: 'QUEUED' });
    expect(sent).toMatchObject({ phone: maskPhone(phone), status: 'SENT' });
    const smsId = queued?.smsId as string;
    expect(sent?.smsId).toBe(smsId);

    const stored = await testApp.prisma.smsMessage.findUniqueOrThrow({
      where: { id: smsId },
    });
    expect(stored).toMatchObject({
      phoneMasked: maskPhone(phone),
      status: 'SENT',
      purpose: 'PHONE_VERIFICATION',
      provider: 'mock',
    });
    expect(stored.providerMessageId).toMatch(/^mock-/);
    expect(JSON.stringify(stored)).not.toContain(code);
    expect(JSON.stringify(stored)).not.toContain(phone);
  });

  it('per-phone daily quota → 429 RATE_LIMITED with Retry-After until Tashkent midnight', async () => {
    const phone = await uniquePhone();
    for (let i = 0; i < 3; i += 1) {
      const ok = await testApp
        .http()
        .post('/api/v1/test-sms-quota')
        .set('X-Forwarded-For', uniqueIp())
        .send({ phone });
      expect(ok.status).toBe(204);
    }
    const res = await testApp
      .http()
      .post('/api/v1/test-sms-quota')
      .set('X-Forwarded-For', uniqueIp())
      .send({ phone });
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ code: 'RATE_LIMITED' });
    const retryAfter = Number(res.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(secondsUntilNextTashkentDay() + 1);

    const key = `rl:sms:phone:${hashIdentifier(phone)}:${todayInTashkent()}`;
    expect(await testApp.redis.get(key)).toBe('4');
    const ttl = await testApp.redis.ttl(key);
    expect(ttl).toBeGreaterThan(24 * 60 * 60);
    expect(ttl).toBeLessThanOrEqual(2 * 24 * 60 * 60);
  });

  it('per-IP daily quota → 429 across different phones', async () => {
    const ip = uniqueIp();
    const send = async () =>
      testApp
        .http()
        .post('/api/v1/test-sms-quota')
        .set('X-Forwarded-For', ip)
        .send({ phone: await uniquePhone() });
    for (let i = 0; i < 5; i += 1) expect((await send()).status).toBe(204);
    expect((await send()).status).toBe(429);
    expect(
      await testApp.redis.exists(`rl:sms:ip:${ip}:${todayInTashkent()}`),
    ).toBe(1);
  });

  it('one IP cannot use up the per-phone quota of a victim on its own', async () => {
    const isolated = await createTestApp({
      features: ['sms'],
      controllers: [SmsQuotaProbeController],
      env: { SMS_DAILY_LIMIT_PER_PHONE: '10', SMS_DAILY_LIMIT_PER_IP: '50' },
    });
    try {
      const victim = await uniquePhone();
      const attackerIp = uniqueIp();
      const probe = (ip: string) =>
        isolated
          .http()
          .post('/api/v1/test-sms-quota')
          .set('X-Forwarded-For', ip)
          .send({ phone: victim });
      for (let i = 0; i < 4; i += 1) {
        expect((await probe(attackerIp)).status).toBe(204);
      }
      for (let i = 0; i < 6; i += 1) {
        const res = await probe(attackerIp);
        expect(res.status).toBe(429);
        expect(res.body).toMatchObject({ code: 'RATE_LIMITED' });
      }
      const phoneKey = `rl:sms:phone:${hashIdentifier(victim)}:${todayInTashkent()}`;
      expect(await isolated.redis.get(phoneKey)).toBe('4');
      // The victim (another IP) still has the rest of the daily quota.
      expect((await probe(uniqueIp())).status).toBe(204);
      const keys = await isolated.redis.keys(
        `rl:sms:phone-ip:${hashIdentifier(victim)}:*`,
      );
      expect(keys).toHaveLength(2);
      expect(keys.some((key) => key.includes(victim.slice(1)))).toBe(false);
    } finally {
      await isolated.close();
    }
  });

  it('fails closed when Redis is unavailable', async () => {
    const isolated = await createTestApp({
      features: ['sms'],
      controllers: [SmsQuotaProbeController],
    });
    try {
      const service = isolated.app.get(SmsService);
      isolated.redis.disconnect();
      const res = await isolated
        .http()
        .post('/api/v1/test-sms-quota')
        .set('X-Forwarded-For', uniqueIp())
        .send({ phone: await uniquePhone() });
      // Neither allowed (2xx) nor a misleading 429: the request is refused.
      expect(res.status).toBeGreaterThanOrEqual(500);
      expect(JSON.stringify(res.body)).not.toMatch(/redis|connection/i);
      // Sending still never throws into the caller.
      await expect(
        service.sendOtp({
          phone: await uniquePhone(),
          code: '123456',
          purpose: 'PHONE_VERIFICATION',
        }),
      ).resolves.toBeUndefined();
    } finally {
      await isolated.close();
    }
  });

  it('GET /api/v1/dev/sms-inbox does not exist in the test environment', async () => {
    const phone = await uniquePhone();
    await sms.sendOtp({ phone, code: '777111', purpose: 'PHONE_VERIFICATION' });
    const res = await testApp.http().get('/api/v1/dev/sms-inbox');
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('777111');

    const controllers = [...testApp.app.get(ModulesContainer).values()].flatMap(
      (module) => [...module.controllers.values()].map((c) => c.name),
    );
    expect(controllers).toContain('SmsWebhookController');
    expect(controllers).not.toContain('SmsDevInboxController');
  });
});
