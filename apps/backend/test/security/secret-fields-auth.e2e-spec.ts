import type { Response } from 'supertest';
import { UserRole } from '../../src/generated/prisma/enums.js';
import {
  AUTH,
  otpFor,
  deepEntries,
  login,
  register,
  skipResendCooldown,
  webCookies,
} from '../auth/helpers.js';
import { decodePayload } from '../platform/support/tokens.js';
import { createTestApp, type TestApp } from '../utils/app.js';
import { createUser } from '../utils/factories.js';
import { uniqueIp } from '../utils/ips.js';
import { totpNow } from '../utils/totp.js';

const FORBIDDEN_KEYS = [
  'password',
  'passwordHash',
  'currentPassword',
  'newPassword',
  'mfaSecretEnc',
  'mfaPendingSecretEnc',
  'mfaLastUsedStep',
  'codeHash',
  'currentRefreshJti',
  'refreshCount',
  'otp',
  'pepper',
];

// Values that must never be in a response: hashes, ciphertexts, secrets.
const FORBIDDEN_VALUE_PATTERNS = [
  /scrypt\$/,
  /^v1\.[0-9a-f]{8}\./,
  /^[0-9a-f]{64}$/,
];

/**
 * Deep scan of every auth response body: no password hash, OTP digest, MFA
 * ciphertext, refresh jti or env secret — in any key or value — and tokens
 * appear only where the contract puts them.
 */
describe('Security: no secret fields in auth responses', () => {
  let testApp: TestApp;
  const responses: Array<{ label: string; res: Response }> = [];
  const plaintextSecrets: string[] = [];

  beforeAll(async () => {
    testApp = await createTestApp({ features: ['auth'] });
  });

  afterAll(async () => {
    await testApp.close();
  });

  const record = (label: string, res: Response) => {
    responses.push({ label, res });
    return res;
  };
  const post = (path: string, body: object) =>
    testApp
      .http()
      .post(`${AUTH}/${path}`)
      .set('X-Forwarded-For', uniqueIp())
      .send(body);

  it('exercises every auth route', async () => {
    plaintextSecrets.push(
      process.env.OTP_PEPPER ?? '',
      process.env.JWT_ACCESS_SECRET ?? '',
      process.env.JWT_REFRESH_SECRET ?? '',
      process.env.DATA_ENCRYPTION_KEY ?? '',
    );

    // Registration and verification
    const reg = await register(testApp);
    record('register', reg.res);
    plaintextSecrets.push(reg.password);
    await skipResendCooldown(testApp, reg.verificationId);
    record(
      'otp/resend',
      await post('otp/resend', { verificationId: reg.verificationId }),
    );
    const code = (await otpFor(testApp, reg.phone)) ?? '';
    record(
      'verify-phone (wrong)',
      await post('verify-phone', {
        verificationId: reg.verificationId,
        code: code === '000000' ? '111111' : '000000',
      }),
    );
    record(
      'verify-phone',
      await post('verify-phone', { verificationId: reg.verificationId, code }),
    );

    // Web and mobile login, refresh, sessions, me
    const web = record(
      'login web',
      await login(testApp, reg.phone, reg.password),
    );
    const cookies = webCookies(web);
    const access = web.body.accessToken as string;
    const auth = { Authorization: `Bearer ${access}` };
    record(
      'refresh web',
      await testApp
        .http()
        .post(`${AUTH}/refresh`)
        .set('Cookie', cookies.header)
        .set('X-CSRF-Token', cookies.csrf),
    );
    const mobile = record(
      'login mobile',
      await login(testApp, reg.phone, reg.password, { mobile: true }),
    );
    record(
      'refresh mobile',
      await testApp
        .http()
        .post(`${AUTH}/refresh`)
        .send({ refreshToken: mobile.body.refreshToken }),
    );
    record('me', await testApp.http().get(`${AUTH}/me`).set(auth));
    record('sessions', await testApp.http().get(`${AUTH}/sessions`).set(auth));
    record(
      'login wrong password',
      await login(testApp, reg.phone, 'Wrong-pass-1'),
    );

    // Password change / forgot / reset
    record(
      'password/change',
      await testApp.http().post(`${AUTH}/password/change`).set(auth).send({
        currentPassword: reg.password,
        newPassword: 'Ikkinchi-parol-2',
      }),
    );
    plaintextSecrets.push('Ikkinchi-parol-2');
    const forgot = record(
      'password/forgot',
      await post('password/forgot', { phone: reg.phone }),
    );
    const resetCode = (await otpFor(testApp, reg.phone)) ?? '';
    record(
      'password/reset',
      await post('password/reset', {
        verificationId: forgot.body.verificationId,
        code: resetCode,
        newPassword: 'Uchinchi-parol-3',
      }),
    );
    plaintextSecrets.push('Uchinchi-parol-3', code, resetCode);

    // MFA enrolment and challenge
    const admin = await createUser(testApp.prisma, { role: UserRole.ADMIN });
    plaintextSecrets.push(admin.password);
    const challenge = record(
      'login admin (setup)',
      await login(testApp, admin.user.phone, admin.password),
    );
    const setup = record(
      'mfa/setup',
      await post('mfa/setup', { mfaToken: challenge.body.mfaToken }),
    );
    const enable = record(
      'mfa/enable',
      await post('mfa/enable', {
        mfaToken: challenge.body.mfaToken,
        code: totpNow(setup.body.secret as string),
      }),
    );
    const second = await login(testApp, admin.user.phone, admin.password);
    record(
      'mfa/verify (replayed code)',
      await post('mfa/verify', {
        mfaToken: second.body.mfaToken,
        code: totpNow(setup.body.secret as string),
      }),
    );
    record(
      'logout',
      await testApp
        .http()
        .post(`${AUTH}/logout`)
        .set('Authorization', `Bearer ${enable.body.accessToken as string}`),
    );
    record(
      'logout-all',
      await testApp.http().post(`${AUTH}/logout-all`).set(auth),
    );

    const failed = responses.filter(({ res }) => res.status >= 500);
    expect(failed.map(({ label }) => label)).toEqual([]);
  });

  it('no response contains a sensitive key or secret value', () => {
    expect(responses.length).toBeGreaterThan(15);
    for (const { label, res } of responses) {
      const { keys, strings } = deepEntries(res.body);
      for (const key of FORBIDDEN_KEYS) {
        expect(keys, `${label}: key ${key}`).not.toContain(key);
      }
      for (const value of strings) {
        for (const pattern of FORBIDDEN_VALUE_PATTERNS) {
          expect(value, `${label}: value`).not.toMatch(pattern);
        }
      }
      const text = JSON.stringify(res.body ?? {});
      for (const secret of plaintextSecrets.filter(Boolean)) {
        expect(text.includes(secret), `${label}: leaked secret`).toBe(false);
      }
      for (const header of ['authorization', 'x-csrf-token']) {
        expect(res.headers[header], `${label}: ${header}`).toBeUndefined();
      }
    }
  });

  it('only mfa/setup returns the TOTP secret, and only its own two fields', () => {
    for (const { label, res } of responses) {
      const { keys } = deepEntries(res.body);
      if (label === 'mfa/setup') {
        expect(Object.keys(res.body as object).sort()).toEqual([
          'otpauthUrl',
          'secret',
        ]);
      } else {
        expect(keys, label).not.toContain('secret');
        expect(keys, label).not.toContain('otpauthUrl');
      }
    }
  });

  it('refresh tokens appear in a body only for mobile transport', () => {
    for (const { label, res } of responses) {
      const has = 'refreshToken' in ((res.body as object) ?? {});
      expect(has, label).toBe(label.includes('mobile'));
    }
  });

  it('JWT payloads carry ids only (no role, phone, name or secret)', () => {
    const tokens = responses.flatMap(({ res }) =>
      ['accessToken', 'refreshToken', 'mfaToken']
        .map((key) => (res.body as Record<string, unknown>)?.[key])
        .filter((value): value is string => typeof value === 'string'),
    );
    expect(tokens.length).toBeGreaterThan(5);
    for (const token of tokens) {
      const payload = decodePayload(token);
      expect(Object.keys(payload).sort()).toEqual(
        expect.arrayContaining([
          'aud',
          'exp',
          'iat',
          'iss',
          'jti',
          'sub',
          'typ',
        ]),
      );
      expect(JSON.stringify(payload)).not.toMatch(
        /role|phone|fullName|FARMER|ADMIN|password|\+998/i,
      );
    }
  });
});
