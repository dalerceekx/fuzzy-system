import { Logger } from '@nestjs/common';
import { createTestApp, type TestApp } from '../utils/app.js';
import { loginAs } from '../utils/auth.js';
import { createUser } from '../utils/factories.js';
import { captureLogs, flushLogs } from '../utils/logs.js';
import { ProbeController } from './support/probe.controller.js';

describe('Structured logs', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp({ controllers: [ProbeController] });
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('writes one JSON access line per request without headers, bodies or query strings', async () => {
    const { user } = await createUser(testApp.prisma);
    const auth = await loginAs(testApp, user);
    const logs = captureLogs();

    await testApp
      .http()
      .get('/api/v1/test-probe/me?token=query-secret-value&code=987654')
      .set(auth.authHeader)
      .set('Cookie', 'mf_rt=cookie-secret-value')
      .set('X-CSRF-Token', 'csrf-secret-value')
      .set('X-Request-Id', 'log-test-request-01')
      .expect(200);
    await testApp
      .http()
      .post('/api/v1/test-probe/echo')
      .set('Authorization', 'Bearer header.secret.value')
      .send({ name: 'ok', password: 'body-password-value' })
      .expect(200);
    await flushLogs();
    logs.stop();

    const text = logs.text();
    for (const secret of [
      auth.accessToken,
      'query-secret-value',
      '987654',
      'cookie-secret-value',
      'csrf-secret-value',
      'header.secret.value',
      'body-password-value',
      'Bearer',
    ]) {
      expect(text).not.toContain(secret);
    }

    const lines = logs.json();
    const access = lines.filter((line) => line.msg === 'request completed');
    expect(access).toHaveLength(2);
    expect(access[0]).toMatchObject({
      level: 'info',
      reqId: 'log-test-request-01',
      method: 'GET',
      path: '/api/v1/test-probe/me',
      statusCode: 200,
      userId: user.id,
      service: 'meningfermam-api',
    });
    expect(typeof access[0].responseTime).toBe('number');
    expect(Number.isNaN(Date.parse(String(access[0].time)))).toBe(false);
    for (const line of access) {
      expect(line).not.toHaveProperty('req');
      expect(line).not.toHaveProperty('res');
      expect(line).not.toHaveProperty('headers');
    }
    expect(access[1]).not.toHaveProperty('userId');
  });

  it('redacts sensitive keys at any depth in application logs', async () => {
    const logs = captureLogs();
    new Logger('LoggingTest').warn(
      {
        password: 'plain-password-1',
        user: {
          newPassword: 'plain-password-2',
          passwordHash: 'scrypt$x',
          mfaSecretEnc: 'v1.enc',
        },
        token: 'jwt-1',
        payload: {
          nested: {
            refreshToken: 'jwt-2',
            otp: '111111',
            code: '222222',
            apiKey: 'sms-key-1',
          },
        },
        phone: '+99890*****67',
      },
      'sensitive structure',
    );
    await flushLogs();
    logs.stop();

    const text = logs.text();
    for (const secret of [
      'plain-password-1',
      'plain-password-2',
      'scrypt$x',
      'v1.enc',
      'jwt-1',
      'jwt-2',
      '111111',
      '222222',
      'sms-key-1',
    ]) {
      expect(text).not.toContain(secret);
    }
    const [line] = logs
      .json()
      .filter((entry) => entry.msg === 'sensitive structure');
    expect(line).toMatchObject({
      level: 'warn',
      context: 'LoggingTest',
      password: '[REDACTED]',
      token: '[REDACTED]',
      phone: '+99890*****67',
      user: {
        newPassword: '[REDACTED]',
        passwordHash: '[REDACTED]',
        mfaSecretEnc: '[REDACTED]',
      },
    });
  });

  it('never logs the message or DETAIL of a database error, even when passed directly', async () => {
    const error = await testApp.prisma.user
      .create({
        data: {
          phone: 'bad',
          fullName: 'X',
          passwordHash: 'scrypt$leaky-hash-value',
        },
      })
      .catch((err: unknown) => err);
    const logs = captureLogs();
    new Logger('LoggingTest').error(error);
    new Logger('LoggingTest').error(
      { cause: error, nested: { error } },
      'wrapped',
    );
    await flushLogs();
    logs.stop();

    expect(logs.text()).not.toMatch(
      /leaky-hash-value|Failing row|violates check constraint|Invalid `/,
    );
    expect(logs.text()).toContain('"sqlState":"23514"');
    expect(logs.text()).toContain('"constraint":"users_phone_e164_chk"');
  });
});
