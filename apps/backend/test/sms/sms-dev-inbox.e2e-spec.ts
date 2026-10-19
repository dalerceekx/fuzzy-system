import { maskPhone } from '../../src/common/phone.js';
import { SmsService } from '../../src/sms/sms.service.js';
import { createTestApp, type TestApp } from '../utils/app.js';
import { uniquePhone } from '../utils/factories.js';
import { lastOtp } from '../utils/sms.js';

// Positive control for the dev-only inbox (sms-service.e2e-spec.ts asserts it
// is absent in NODE_ENV=test). Its own file: ConditionalModule evaluates
// process.env once, when the sms module is first loaded.

describe('dev SMS inbox (NODE_ENV=development, SMS_PROVIDER=mock)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    process.env.NODE_ENV = 'development';
    try {
      testApp = await createTestApp({
        features: ['sms'],
        env: { NODE_ENV: 'development' },
      });
    } finally {
      process.env.NODE_ENV = 'test';
    }
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('exists and shows recent messages with masked phones only', async () => {
    const phone = await uniquePhone();
    // Not inline outside NODE_ENV=test: the background worker delivers it.
    await testApp.app
      .get(SmsService)
      .sendOtp({ phone, code: '246810', purpose: 'PHONE_VERIFICATION' });
    await vi.waitFor(() => expect(lastOtp(testApp.sms, phone)).toBe('246810'), {
      timeout: 5_000,
      interval: 50,
    });

    const res = await testApp.http().get('/api/v1/dev/sms-inbox');
    expect(res.status).toBe(200);
    const messages = res.body as Array<{ to: string; text: string }>;
    expect(messages.length).toBeLessThanOrEqual(20);
    expect(messages[0]).toMatchObject({ to: maskPhone(phone) });
    expect(messages[0].text).toContain('246810');
    expect(JSON.stringify(res.body)).not.toContain(phone);
  });
});
