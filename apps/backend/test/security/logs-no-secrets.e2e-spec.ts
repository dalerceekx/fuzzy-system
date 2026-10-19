import { maskPhone } from '../../src/common/phone.js';
import { UserRole } from '../../src/generated/prisma/enums.js';
import {
  AUTH,
  otpFor,
  login,
  register,
  skipResendCooldown,
  webCookies,
} from '../auth/helpers.js';
import { createTestApp, type TestApp } from '../utils/app.js';
import { createUser } from '../utils/factories.js';
import { uniqueIp } from '../utils/ips.js';
import { captureLogs, flushLogs } from '../utils/logs.js';
import { totpNow } from '../utils/totp.js';

/**
 * Runs every credential-bearing auth flow with log capture on and asserts
 * that no password, OTP, token, MFA secret, Authorization/Cookie value or
 * unmasked phone number reached the application logs.
 */
describe('Security: auth flows never log secrets', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp({ features: ['auth'] });
  });

  afterAll(async () => {
    await testApp.close();
  });

  const post = (path: string, body: object) =>
    testApp
      .http()
      .post(`${AUTH}/${path}`)
      .set('X-Forwarded-For', uniqueIp())
      .send(body);

  it('register → verify → login → refresh → reset → MFA', async () => {
    const secrets: string[] = [];
    const phones: string[] = [];
    const logs = captureLogs();
    try {
      // Registration + verification (with a wrong attempt and a resend).
      const reg = await register(testApp, { password: 'Logda-yoq-parol-1' });
      phones.push(reg.phone);
      secrets.push(reg.password);
      await skipResendCooldown(testApp, reg.verificationId);
      await post('otp/resend', { verificationId: reg.verificationId }).expect(
        202,
      );
      const code = (await otpFor(testApp, reg.phone)) ?? '';
      secrets.push(code);
      await post('verify-phone', {
        verificationId: reg.verificationId,
        code: code === '000000' ? '111111' : '000000',
      }).expect(400);
      await post('verify-phone', {
        verificationId: reg.verificationId,
        code,
      }).expect(200);

      // Failed and successful logins, web + mobile.
      await login(testApp, reg.phone, 'Notogri-parol-9').expect(401);
      secrets.push('Notogri-parol-9');
      const web = await login(testApp, reg.phone, reg.password).expect(200);
      const cookies = webCookies(web);
      secrets.push(
        web.body.accessToken as string,
        cookies.refresh,
        cookies.csrf,
      );
      const mobile = await login(testApp, reg.phone, reg.password, {
        mobile: true,
      }).expect(200);
      secrets.push(
        mobile.body.accessToken as string,
        mobile.body.refreshToken as string,
      );

      // Refresh in both transports.
      const webRefresh = await testApp
        .http()
        .post(`${AUTH}/refresh`)
        .set('Cookie', cookies.header)
        .set('X-CSRF-Token', cookies.csrf)
        .expect(200);
      secrets.push(webRefresh.body.accessToken as string);
      const mobileRefresh = await testApp
        .http()
        .post(`${AUTH}/refresh`)
        .send({ refreshToken: mobile.body.refreshToken })
        .expect(200);
      secrets.push(
        mobileRefresh.body.accessToken as string,
        mobileRefresh.body.refreshToken as string,
      );
      // Reuse detection logs a warning — still without the token.
      await testApp
        .http()
        .post(`${AUTH}/refresh`)
        .send({ refreshToken: mobile.body.refreshToken })
        .expect(401);

      // Password change, forgot and reset.
      await testApp
        .http()
        .post(`${AUTH}/password/change`)
        .set('Authorization', `Bearer ${web.body.accessToken as string}`)
        .send({
          currentPassword: reg.password,
          newPassword: 'Almashgan-parol-2',
        })
        .expect(204);
      secrets.push('Almashgan-parol-2');
      // Model the elapsed phone-wide cooldown before starting another flow.
      await skipResendCooldown(testApp, reg.verificationId);
      const forgot = await post('password/forgot', {
        phone: reg.phone,
      }).expect(202);
      const resetCode = (await otpFor(testApp, reg.phone)) ?? '';
      secrets.push(resetCode);
      await post('password/reset', {
        verificationId: forgot.body.verificationId,
        code: resetCode,
        newPassword: 'Tiklangan-parol-3',
      }).expect(200);
      secrets.push('Tiklangan-parol-3');

      // MFA enrolment and challenge.
      const admin = await createUser(testApp.prisma, {
        role: UserRole.SUPER_ADMIN,
        password: 'Admin-parol-logsiz-4',
      });
      phones.push(admin.user.phone);
      secrets.push(admin.password);
      const setupLogin = await login(
        testApp,
        admin.user.phone,
        admin.password,
      ).expect(200);
      secrets.push(setupLogin.body.mfaToken as string);
      const setup = await post('mfa/setup', {
        mfaToken: setupLogin.body.mfaToken,
      }).expect(200);
      const secret = setup.body.secret as string;
      const totp = totpNow(secret);
      secrets.push(secret, totp);
      const enabled = await post('mfa/enable', {
        mfaToken: setupLogin.body.mfaToken,
        code: totp,
      }).expect(200);
      secrets.push(enabled.body.accessToken as string);
      const challenge = await login(
        testApp,
        admin.user.phone,
        admin.password,
      ).expect(200);
      secrets.push(challenge.body.mfaToken as string);
      await post('mfa/verify', {
        mfaToken: challenge.body.mfaToken,
        code: totp,
      }).expect(401);

      await flushLogs();
    } finally {
      logs.stop();
    }

    const text = logs.text();
    expect(logs.lines().length).toBeGreaterThan(20);
    for (const secret of secrets.filter(Boolean)) {
      expect(text.includes(secret), `leaked ${secret.slice(0, 6)}…`).toBe(
        false,
      );
    }
    for (const env of [
      'OTP_PEPPER',
      'JWT_ACCESS_SECRET',
      'JWT_REFRESH_SECRET',
    ]) {
      expect(text).not.toContain(process.env[env] ?? '<unset>');
    }
    expect(text).not.toMatch(/Bearer\s+[A-Za-z0-9]/);
    expect(text).not.toMatch(/eyJ[\w-]+\.[\w-]+\./);
    expect(text).not.toMatch(/scrypt\$/);
    expect(text).not.toMatch(/mf_rt=|mf_csrf=/);
    for (const phone of phones) {
      expect(text).not.toContain(phone);
      expect(text).not.toContain(phone.slice(1));
      expect(text).not.toContain(phone.slice(4));
    }
    // Where phones appear at all, they are masked.
    const masked = phones.map((phone) => maskPhone(phone));
    const mentioned = masked.filter((m) => text.includes(m));
    for (const m of mentioned) expect(m).toContain('*');
  });
});
