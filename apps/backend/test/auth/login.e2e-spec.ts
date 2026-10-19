import { AuditAction } from '../../src/audit/audit-actions.js';
import { UserRole, UserStatus } from '../../src/generated/prisma/enums.js';
import { TokenService } from '../../src/security/tokens/token.service.js';
import { createTestApp, type TestApp } from '../utils/app.js';
import { createUser } from '../utils/factories.js';
import { uniqueIp } from '../utils/ips.js';
import {
  AUTH,
  CSRF_COOKIE,
  login,
  REFRESH_COOKIE,
  setCookies,
} from './helpers.js';

describe('Auth: POST /login', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp({ features: ['auth'] });
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('web login: access token in the body, refresh token only in an HttpOnly cookie + CSRF cookie', async () => {
    const { user, password } = await createUser(testApp.prisma);
    const res = await login(testApp, user.phone, password).expect(200);

    expect(res.body).toMatchObject({
      status: 'AUTHENTICATED',
      accessToken: expect.any(String),
      accessTokenExpiresIn: 900,
      user: { id: user.id, role: UserRole.FARMER, status: UserStatus.ACTIVE },
    });
    expect(res.body).not.toHaveProperty('refreshToken');

    const cookies = setCookies(res);
    const refresh = cookies.find((cookie) => cookie.name === REFRESH_COOKIE);
    const csrf = cookies.find((cookie) => cookie.name === CSRF_COOKIE);
    // Defaults: AUTH_COOKIE_SECURE=true → __Secure-/__Host- prefixes.
    expect(refresh?.attributes).toMatchObject({
      httponly: '',
      secure: '',
      path: '/api/v1/auth',
      samesite: 'Strict',
    });
    expect(refresh?.attributes).not.toHaveProperty('domain');
    expect(Number(refresh?.attributes['max-age'])).toBeGreaterThan(29 * 86400);
    // __Host- requires Secure, Path=/ and no Domain; readable by the SPA.
    expect(csrf?.attributes).toMatchObject({
      secure: '',
      path: '/',
      samesite: 'Strict',
    });
    expect(csrf?.attributes).not.toHaveProperty('httponly');
    expect(csrf?.attributes).not.toHaveProperty('domain');
    expect(csrf?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const claims = await testApp.app
      .get(TokenService)
      .verifyRefresh(refresh?.value ?? '');
    expect(claims.sub).toBe(user.id);

    await testApp
      .http()
      .get(`${AUTH}/me`)
      .set('Authorization', `Bearer ${res.body.accessToken as string}`)
      .expect(200);

    const row = await testApp.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(row.lastLoginAt).toBeInstanceOf(Date);
    const audit = await testApp.prisma.auditLog.findFirst({
      where: { action: AuditAction.AUTH_LOGIN_SUCCESS, resourceId: user.id },
    });
    expect(audit).toMatchObject({
      actorId: user.id,
      actorRole: UserRole.FARMER,
    });
  });

  it('plain cookie names without Secure when AUTH_COOKIE_SECURE=false (local http dev)', async () => {
    const devApp = await createTestApp({
      features: ['auth'],
      env: {
        AUTH_COOKIE_SECURE: 'false',
        AUTH_COOKIE_SAMESITE: 'lax',
        AUTH_COOKIE_DOMAIN: 'meningfermam.test',
      },
    });
    try {
      const { user, password } = await createUser(devApp.prisma);
      const res = await login(devApp, user.phone, password).expect(200);
      const cookies = setCookies(res);
      expect(cookies.map((c) => c.name).sort()).toEqual(['mf_csrf', 'mf_rt']);
      const refresh = cookies.find((c) => c.name === 'mf_rt');
      const csrf = cookies.find((c) => c.name === 'mf_csrf');
      expect(refresh?.attributes).toMatchObject({
        httponly: '',
        samesite: 'Lax',
        path: '/api/v1/auth',
        domain: 'meningfermam.test',
      });
      expect(refresh?.attributes).not.toHaveProperty('secure');
      expect(csrf?.attributes).toMatchObject({ path: '/' });
      expect(csrf?.attributes).not.toHaveProperty('domain');
    } finally {
      await devApp.close();
    }
  });

  it('mobile login (X-Client-Type: mobile): refresh token in the body, no cookies', async () => {
    const { user, password } = await createUser(testApp.prisma);
    const res = await login(testApp, user.phone, password, {
      mobile: true,
    }).expect(200);
    expect(res.body).toMatchObject({
      status: 'AUTHENTICATED',
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
    });
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('accepts other phone spellings (normalized)', async () => {
    const { user, password } = await createUser(testApp.prisma);
    await login(testApp, user.phone.slice(4), password).expect(200);
  });

  it('BLOCKED → 403 ACCOUNT_BLOCKED only with the correct password', async () => {
    const { user, password } = await createUser(testApp.prisma, {
      status: UserStatus.BLOCKED,
    });
    const res = await login(testApp, user.phone, password).expect(403);
    expect(res.body.code).toBe('ACCOUNT_BLOCKED');
    const wrong = await login(testApp, user.phone, 'Wrong-pass-1').expect(401);
    expect(wrong.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('ARCHIVED and demo users (demo disabled) look like bad credentials', async () => {
    for (const options of [{ status: UserStatus.ARCHIVED }, { isDemo: true }]) {
      const { user, password } = await createUser(testApp.prisma, options);
      const res = await login(testApp, user.phone, password).expect(401);
      expect(res.body).toMatchObject({
        code: 'INVALID_CREDENTIALS',
        message: 'Telefon yoki parol noto‘g‘ri',
      });
      expect(
        await testApp.prisma.session.count({ where: { userId: user.id } }),
      ).toBe(0);
    }
  });

  it('demo users can log in when DEMO_ACCOUNTS_ENABLED=true', async () => {
    const demoApp = await createTestApp({
      features: ['auth'],
      env: { DEMO_ACCOUNTS_ENABLED: 'true' },
    });
    try {
      const { user, password } = await createUser(demoApp.prisma, {
        isDemo: true,
      });
      const res = await login(demoApp, user.phone, password).expect(200);
      expect(res.body.user).toMatchObject({ id: user.id, isDemo: true });
    } finally {
      await demoApp.close();
    }
  });

  it('demo-account phones outside the demo prefix (e.g. +998900000001) are valid login input', async () => {
    const res = await login(testApp, '+998900000001', 'Wrong-pass-1');
    expect(res.status).toBe(401);
  });

  it('rehashes a password stored with weaker parameters on successful login', async () => {
    const strongerApp = await createTestApp({
      features: ['auth'],
      env: { PASSWORD_SCRYPT_COST: '2048' },
    });
    try {
      const { user, password } = await createUser(strongerApp.prisma);
      expect(user.passwordHash).toMatch(/^scrypt\$1024\$/);
      await login(strongerApp, user.phone, password).expect(200);
      const row = await strongerApp.prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      expect(row.passwordHash).toMatch(/^scrypt\$2048\$/);
      await login(strongerApp, user.phone, password).expect(200);
    } finally {
      await strongerApp.close();
    }
  });

  it.each([UserRole.ADMIN, UserRole.SUPER_ADMIN])(
    '%s without MFA → MFA_SETUP_REQUIRED, with MFA → MFA_REQUIRED; no session yet',
    async (role) => {
      const tokens = testApp.app.get(TokenService);
      for (const mfaEnabled of [false, true]) {
        const { user, password } = await createUser(testApp.prisma, {
          role,
          mfaEnabled,
        });
        const res = await login(testApp, user.phone, password).expect(200);
        expect(res.body).toEqual({
          status: mfaEnabled ? 'MFA_REQUIRED' : 'MFA_SETUP_REQUIRED',
          mfaToken: expect.any(String),
          mfaTokenExpiresIn: 300,
        });
        expect(res.headers['set-cookie']).toBeUndefined();
        const claims = await tokens.verifyMfa(res.body.mfaToken as string);
        expect(claims).toMatchObject({
          sub: user.id,
          purpose: mfaEnabled ? 'challenge' : 'setup',
        });
        // An mfa token is not an access token.
        await testApp
          .http()
          .get(`${AUTH}/me`)
          .set('Authorization', `Bearer ${res.body.mfaToken as string}`)
          .expect(401);
        expect(
          await testApp.prisma.session.count({ where: { userId: user.id } }),
        ).toBe(0);
      }
    },
  );

  it('SUPPORT and VET log in directly (MFA not required)', async () => {
    for (const role of [UserRole.SUPPORT, UserRole.VET]) {
      const { user, password } = await createUser(testApp.prisma, { role });
      const res = await login(testApp, user.phone, password).expect(200);
      expect(res.body.status).toBe('AUTHENTICATED');
    }
  });

  it('rejects unknown fields and malformed input', async () => {
    const { user, password } = await createUser(testApp.prisma);
    await testApp
      .http()
      .post(`${AUTH}/login`)
      .send({ phone: user.phone, password, role: 'SUPER_ADMIN' })
      .expect(400);
    await testApp
      .http()
      .post(`${AUTH}/login`)
      .send({ phone: user.phone, password: 'x'.repeat(129) })
      .expect(400);
  });

  describe('login CSRF: cookie-issuing requests must be same-site JSON', () => {
    const attempt = (headers: Record<string, string>, body: string | object) =>
      testApp
        .http()
        .post(`${AUTH}/login`)
        .set('X-Forwarded-For', uniqueIp())
        .set(headers)
        .send(body);

    it('a cross-site form POST is refused before any session or cookie exists', async () => {
      const { user, password } = await createUser(testApp.prisma);
      const form = `phone=${encodeURIComponent(user.phone)}&password=${encodeURIComponent(password)}`;
      const refused = [
        await attempt(
          {
            Origin: 'https://evil.example',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          form,
        ),
        // Same-origin form posts are refused too (not JSON) …
        await attempt(
          { 'Content-Type': 'application/x-www-form-urlencoded' },
          form,
        ),
        // … and so is JSON from a foreign origin or a cross-site fetch.
        await attempt(
          { Origin: 'https://evil.example' },
          { phone: user.phone, password },
        ),
        await attempt(
          { 'Sec-Fetch-Site': 'cross-site' },
          { phone: user.phone, password },
        ),
      ];
      for (const res of refused) {
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('CSRF_FAILED');
        expect(setCookies(res)).toEqual([]);
      }
      // A text/plain body is not parsed at all (400): no cookies either.
      const plain = await attempt(
        { 'Content-Type': 'text/plain' },
        JSON.stringify({ phone: user.phone, password }),
      );
      expect(plain.status).toBe(400);
      expect(setCookies(plain)).toEqual([]);
      expect(
        await testApp.prisma.session.count({ where: { userId: user.id } }),
      ).toBe(0);

      // The SPA's own origin and mobile clients are unaffected.
      const web = await attempt(
        { Origin: 'http://localhost:5173', 'Sec-Fetch-Site': 'same-site' },
        { phone: user.phone, password },
      ).expect(200);
      expect(setCookies(web).map((cookie) => cookie.name)).toContain(
        REFRESH_COOKIE,
      );
      await attempt(
        { 'X-Client-Type': 'mobile', Origin: 'https://evil.example' },
        { phone: user.phone, password },
      ).expect(200);
    });
  });
});
