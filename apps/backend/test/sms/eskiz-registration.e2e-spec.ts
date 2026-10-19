import { randomUUID } from 'node:crypto';
import { maskPhone } from '../../src/common/phone.js';
import { EskizSmsProvider } from '../../src/sms/providers/eskiz-sms.provider.js';
import { SMS_PROVIDER } from '../../src/sms/sms.types.js';
import { AUTH, login, register } from '../auth/helpers.js';
import { createTestApp, type TestApp } from '../utils/app.js';
import { uniqueIp } from '../utils/ips.js';
import { captureLogs, flushLogs, type CapturedLogs } from '../utils/logs.js';

const TOKEN = 'test-only-eskiz-access-token';
const PASSWORD = 'test-only-eskiz-password';
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

/** Real DI/provider/queue/auth, fake HTTP transport: cannot send paid SMS. */
describe('Eskiz registration through the application', () => {
  let app: TestApp;
  let logs: CapturedLogs;
  let mode: 'accept' | 'auth-failure' | 'timeout';
  let submissions: Array<{ to: string; text: string; from: string }>;
  let requests: string[];

  beforeEach(async () => {
    mode = 'accept';
    submissions = [];
    requests = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        requests.push(url);
        if (url === 'https://notify.eskiz.uz/api/auth/login') {
          return mode === 'auth-failure'
            ? json({ error: PASSWORD }, 401)
            : json({ data: { token: TOKEN }, token_type: 'bearer' });
        }
        if (url !== 'https://notify.eskiz.uz/api/message/sms/send') {
          throw new Error('Unexpected mocked HTTP request');
        }
        expect(init.headers).toMatchObject({
          Authorization: `Bearer ${TOKEN}`,
        });
        const body = init.body as FormData;
        submissions.push({
          to: String(body.get('mobile_phone')),
          text: String(body.get('message')),
          from: String(body.get('from')),
        });
        if (mode === 'timeout')
          throw new DOMException('Ambiguous submission', 'TimeoutError');
        return json({ id: randomUUID(), status: 'waiting' });
      }),
    );
    logs = captureLogs();
    app = await createTestApp({
      features: ['auth'],
      env: {
        SMS_PROVIDER: 'eskiz',
        ESKIZ_EMAIL: 'account@example.test',
        ESKIZ_PASSWORD: PASSWORD,
      },
    });
    expect(app.app.get(SMS_PROVIDER)).toBeInstanceOf(EskizSmsProvider);
  });

  afterEach(async () => {
    await app?.close();
    logs?.stop();
    vi.unstubAllGlobals();
  });

  it('accepts SMS, verifies once and preserves password/JWT login with no secret logs', async () => {
    const { phone, verificationId, password } = await register(app);
    expect(submissions).toHaveLength(1);
    expect(submissions[0]).toMatchObject({ to: phone.slice(1), from: '4546' });
    const code = /Tasdiqlash kodingiz: (\d{6})\./.exec(
      submissions[0].text,
    )?.[1];
    expect(code).toBeDefined();
    expect(submissions[0].text).toBe(
      `RIIZQ: Tasdiqlash kodingiz: ${code}. Kod 5 daqiqa amal qiladi. Uni hech kimga bermang.`,
    );
    expect(
      await app.prisma.user.findUniqueOrThrow({ where: { phone } }),
    ).toMatchObject({
      status: 'PENDING_VERIFICATION',
      phoneVerifiedAt: null,
    });
    const sms = await app.prisma.smsMessage.findFirstOrThrow({
      where: { phoneMasked: maskPhone(phone), provider: 'eskiz' },
      orderBy: { createdAt: 'desc' },
    });
    // Accepted by provider does not prove handset delivery or phone ownership.
    expect(sms).toMatchObject({
      status: 'SENT',
      deliveredAt: null,
      attempts: 1,
    });
    await login(app, phone, password).expect(401);
    const verify = () =>
      app
        .http()
        .post(`${AUTH}/otp/verify`)
        .set('X-Forwarded-For', uniqueIp())
        .send({ verificationId, code });
    await verify().expect(200);
    await verify().expect(400);
    const authenticated = await login(app, phone, password).expect(200);
    expect(authenticated.body.accessToken).toEqual(expect.any(String));
    expect(authenticated.body.user.role).toBe('FARMER');
    await flushLogs();
    for (const secret of [code!, TOKEN, PASSWORD, password, phone]) {
      expect(logs.text()).not.toContain(secret);
    }
  });

  it.each(['auth-failure', 'timeout'] as const)(
    'leaves registration pending on %s and never blindly retries',
    async (failure) => {
      mode = failure;
      const { phone, password } = await register(app);
      expect(submissions).toHaveLength(failure === 'timeout' ? 1 : 0);
      expect(requests).toHaveLength(failure === 'timeout' ? 2 : 1);
      expect(
        await app.prisma.user.findUniqueOrThrow({ where: { phone } }),
      ).toMatchObject({
        status: 'PENDING_VERIFICATION',
        phoneVerifiedAt: null,
      });
      expect(
        await app.prisma.smsMessage.findFirstOrThrow({
          where: { phoneMasked: maskPhone(phone), provider: 'eskiz' },
          orderBy: { createdAt: 'desc' },
        }),
      ).toMatchObject({
        status: 'FAILED',
        attempts: 1,
        lastError: failure === 'timeout' ? 'ESKIZ_TIMEOUT' : 'ESKIZ_AUTH_401',
      });
      await login(app, phone, password).expect(401);
    },
  );
});
