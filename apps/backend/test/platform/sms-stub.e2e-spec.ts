import { maskPhone } from '../../src/common/phone.js';
import { hashIdentifier } from '../../src/security/crypto.js';
import { SmsService } from '../../src/sms/sms.service.js';
import { createTestApp, type TestApp } from '../utils/app.js';
import { uniquePhone } from '../utils/factories.js';
import { captureLogs, flushLogs } from '../utils/logs.js';
import { lastOtp } from '../utils/sms.js';
import { uniqueIp } from '../utils/ips.js';

describe('SmsService public API (foundation stub)', () => {
  let testApp: TestApp;
  let sms: SmsService;

  beforeAll(async () => {
    testApp = await createTestApp({
      env: { SMS_DAILY_LIMIT_PER_PHONE: '2', SMS_DAILY_LIMIT_PER_IP: '3' },
    });
    sms = testApp.app.get(SmsService);
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('delivers the OTP to the mock inbox before sendOtp resolves, never logging the code', async () => {
    const phone = await uniquePhone();
    const logs = captureLogs();
    await sms.sendOtp({ phone, code: '493817', purpose: 'PHONE_VERIFICATION' });
    await flushLogs();
    logs.stop();

    expect(testApp.sms.lastTo(phone)?.text).toBe(
      'RIIZQ: Tasdiqlash kodingiz: 493817. Kod 5 daqiqa amal qiladi. Uni hech kimga bermang.',
    );
    expect(lastOtp(testApp.sms, phone)).toBe('493817');
    // Positive control: the delivery line was captured, with a masked phone.
    expect(logs.text()).toContain('otp sms accepted by provider');
    expect(logs.text()).toContain(maskPhone(phone));
    expect(logs.text()).not.toContain('493817');
    expect(logs.text()).not.toContain(phone);
  });

  it('enforces the daily per-phone quota with 429 RATE_LIMITED', async () => {
    const phone = await uniquePhone();
    await sms.consumeDailyQuota(phone, uniqueIp());
    await sms.consumeDailyQuota(phone, uniqueIp());
    await expect(
      sms.consumeDailyQuota(phone, uniqueIp()),
    ).rejects.toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
    });
  });

  it('enforces the daily per-IP quota across different phones', async () => {
    const ip = uniqueIp();
    for (let i = 0; i < 3; i += 1)
      await sms.consumeDailyQuota(await uniquePhone(), ip);
    const error = await sms
      .consumeDailyQuota(await uniquePhone(), ip)
      .catch((err: unknown) => err);
    expect(error).toMatchObject({ status: 429, code: 'RATE_LIMITED' });
    const retryAfter = (error as { details: { retryAfterSeconds: number } })
      .details.retryAfterSeconds;
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(24 * 60 * 60);
  });

  it("a client blocked by its IP quota cannot use up another phone's quota", async () => {
    const attackerIp = uniqueIp();
    for (let i = 0; i < 3; i += 1)
      await sms.consumeDailyQuota(await uniquePhone(), attackerIp);
    const victim = await uniquePhone();
    for (let i = 0; i < 6; i += 1) {
      await expect(
        sms.consumeDailyQuota(victim, attackerIp),
      ).rejects.toMatchObject({ status: 429 });
    }
    const phoneKeys = await testApp.redis.keys(
      `rl:sms:phone:${hashIdentifier(victim)}:*`,
    );
    expect(phoneKeys).toStrictEqual([]);
    // The victim still gets the full per-phone quota (2) from a fresh IP.
    await sms.consumeDailyQuota(victim, uniqueIp());
    await sms.consumeDailyQuota(victim, uniqueIp());
  });

  it('keys quota counters by hashed phone (no raw phone in Redis keys)', async () => {
    const phone = await uniquePhone();
    await sms.consumeDailyQuota(phone, uniqueIp());
    const keys = await testApp.redis.keys('rl:sms:*');
    expect(keys.length).toBeGreaterThan(0);
    expect(
      keys.some((key) => key.includes(phone) || key.includes(phone.slice(1))),
    ).toBe(false);
  });
});
