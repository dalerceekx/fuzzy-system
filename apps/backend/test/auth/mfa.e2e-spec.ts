import { AuditAction } from '../../src/audit/audit-actions.js';
import { UserRole, UserStatus } from '../../src/generated/prisma/enums.js';
import {
  EncryptionService,
  mfaSecretAad,
} from '../../src/security/encryption.service.js';
import { TokenService } from '../../src/security/tokens/token.service.js';
import { createTestApp, type TestApp } from '../utils/app.js';
import { createUser } from '../utils/factories.js';
import { uniqueIp } from '../utils/ips.js';
import { currentTotpStep, totpAt, totpNow } from '../utils/totp.js';
import { AUTH, login, REFRESH_COOKIE, setCookies } from './helpers.js';

describe('Auth: TOTP MFA (setup, enable, verify)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp({ features: ['auth'] });
  });

  afterAll(async () => {
    await testApp.close();
  });

  const post = (path: string, body: object, mobile = false) => {
    const req = testApp
      .http()
      .post(`${AUTH}/${path}`)
      .set('X-Forwarded-For', uniqueIp());
    if (mobile) req.set('X-Client-Type', 'mobile');
    return req.send(body);
  };

  async function mfaToken(user: { phone: string }, password: string) {
    const res = await login(testApp, user.phone, password).expect(200);
    return res.body.mfaToken as string;
  }

  /** A code for a step the user has not used yet. */
  const wrongCode = (secret: string) => {
    const valid = new Set(
      [-1, 0, 1].map((d) => totpAt(secret, currentTotpStep() + d)),
    );
    let candidate = 0;
    while (valid.has(String(candidate).padStart(6, '0'))) candidate += 1;
    return String(candidate).padStart(6, '0');
  };

  it('setup → enable: encrypted secret, MFA enabled, session with mfaVerifiedAt, cookies', async () => {
    const { user, password } = await createUser(testApp.prisma, {
      role: UserRole.SUPER_ADMIN,
    });
    const token = await mfaToken(user, password);

    const setup = await post('mfa/setup', { mfaToken: token }).expect(200);
    const secret = setup.body.secret as string;
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    const url = new URL(setup.body.otpauthUrl as string);
    expect(url.protocol).toBe('otpauth:');
    expect(url.searchParams.get('secret')).toBe(secret);
    expect(url.searchParams.get('issuer')).toBe('Mening Fermam');
    expect(decodeURIComponent(url.pathname)).not.toContain(user.phone);

    const pending = await testApp.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(pending.mfaEnabled).toBe(false);
    expect(pending.mfaPendingSecretEnc).toMatch(/^v1\./);
    expect(pending.mfaPendingSecretEnc).not.toContain(secret);
    expect(
      testApp.app
        .get(EncryptionService)
        .decrypt(pending.mfaPendingSecretEnc ?? '', mfaSecretAad(user.id)),
    ).toBe(secret);

    const enabled = await post('mfa/enable', {
      mfaToken: token,
      code: totpNow(secret),
    }).expect(200);
    expect(enabled.body).toMatchObject({
      status: 'AUTHENTICATED',
      accessToken: expect.any(String),
      user: { id: user.id, mfaEnabled: true },
    });
    expect(
      setCookies(enabled).some((cookie) => cookie.name === REFRESH_COOKIE),
    ).toBe(true);

    const row = await testApp.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(row).toMatchObject({
      mfaEnabled: true,
      mfaPendingSecretEnc: null,
      mfaLastUsedStep: expect.any(Number),
    });
    expect(row.mfaSecretEnc).toBe(pending.mfaPendingSecretEnc);
    const session = await testApp.prisma.session.findFirstOrThrow({
      where: { userId: user.id },
    });
    expect(session.mfaVerifiedAt).toBeInstanceOf(Date);
    expect(
      await testApp.prisma.auditLog.count({
        where: { action: AuditAction.AUTH_MFA_ENABLED, resourceId: user.id },
      }),
    ).toBe(1);

    await testApp
      .http()
      .get(`${AUTH}/me`)
      .set('Authorization', `Bearer ${enabled.body.accessToken as string}`)
      .expect(200);

    // The setup token is spent; the next login asks for the code.
    await post('mfa/setup', { mfaToken: token }).expect(401);
    await post('mfa/enable', { mfaToken: token, code: totpNow(secret) }).expect(
      401,
    );
    const next = await login(testApp, user.phone, password).expect(200);
    expect(next.body.status).toBe('MFA_REQUIRED');
  });

  it('enable with a wrong code fails (401 MFA_INVALID) and keeps MFA off', async () => {
    const { user, password } = await createUser(testApp.prisma, {
      role: UserRole.ADMIN,
    });
    const token = await mfaToken(user, password);
    const setup = await post('mfa/setup', { mfaToken: token }).expect(200);
    const res = await post('mfa/enable', {
      mfaToken: token,
      code: wrongCode(setup.body.secret as string),
    }).expect(401);
    expect(res.body.code).toBe('MFA_INVALID');
    const row = await testApp.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(row.mfaEnabled).toBe(false);
    expect(row.mfaSecretEnc).toBeNull();
  });

  it('verify: correct code → session (mobile transport), audit login.success with mfa', async () => {
    const { user, password, mfaSecret } = await createUser(testApp.prisma, {
      role: UserRole.ADMIN,
      mfaEnabled: true,
    });
    const token = await mfaToken(user, password);
    const res = await post(
      'mfa/verify',
      { mfaToken: token, code: totpNow(mfaSecret ?? '') },
      true,
    ).expect(200);
    expect(res.body).toMatchObject({
      status: 'AUTHENTICATED',
      refreshToken: expect.any(String),
    });
    expect(res.headers['set-cookie']).toBeUndefined();
    const audit = await testApp.prisma.auditLog.findFirstOrThrow({
      where: { action: AuditAction.AUTH_LOGIN_SUCCESS, resourceId: user.id },
    });
    expect(audit.newValue).toMatchObject({ twoFactor: true });
  });

  it('mfa/verify from a foreign origin (login CSRF) → 403, the code and token stay usable', async () => {
    const { user, password, mfaSecret } = await createUser(testApp.prisma, {
      role: UserRole.ADMIN,
      mfaEnabled: true,
    });
    const token = await mfaToken(user, password);
    const code = totpNow(mfaSecret ?? '');
    const forged = await testApp
      .http()
      .post(`${AUTH}/mfa/verify`)
      .set('X-Forwarded-For', uniqueIp())
      .set('Origin', 'https://evil.example')
      .send({ mfaToken: token, code })
      .expect(403);
    expect(forged.body.code).toBe('CSRF_FAILED');
    expect(forged.headers['set-cookie']).toBeUndefined();
    await post('mfa/verify', { mfaToken: token, code }).expect(200);
  });

  it('a TOTP code cannot be replayed, even with a new mfa token', async () => {
    const { user, password, mfaSecret } = await createUser(testApp.prisma, {
      role: UserRole.SUPER_ADMIN,
      mfaEnabled: true,
    });
    const secret = mfaSecret ?? '';
    const code = totpNow(secret);
    await post('mfa/verify', {
      mfaToken: await mfaToken(user, password),
      code,
    }).expect(200);

    const replay = await post('mfa/verify', {
      mfaToken: await mfaToken(user, password),
      code,
    }).expect(401);
    expect(replay.body.code).toBe('MFA_INVALID');
    expect(
      await testApp.prisma.auditLog.count({
        where: { action: AuditAction.AUTH_MFA_FAILED, resourceId: user.id },
      }),
    ).toBe(1);

    // The next time step is still accepted (±1 step drift).
    await post('mfa/verify', {
      mfaToken: await mfaToken(user, password),
      code: totpAt(secret, currentTotpStep() + 1),
    }).expect(200);
  });

  it('the mfa token is single-use', async () => {
    const { user, password, mfaSecret } = await createUser(testApp.prisma, {
      role: UserRole.ADMIN,
      mfaEnabled: true,
    });
    const token = await mfaToken(user, password);
    await post('mfa/verify', {
      mfaToken: token,
      code: totpNow(mfaSecret ?? ''),
    }).expect(200);
    await post('mfa/verify', {
      mfaToken: token,
      code: totpAt(mfaSecret ?? '', currentTotpStep() + 1),
    }).expect(401);
  });

  it('wrong codes are limited per token (MFA_MAX_ATTEMPTS) → 429 with Retry-After', async () => {
    const { user, password, mfaSecret } = await createUser(testApp.prisma, {
      role: UserRole.ADMIN,
      mfaEnabled: true,
    });
    const token = await mfaToken(user, password);
    const bad = wrongCode(mfaSecret ?? '');
    for (let i = 0; i < 5; i++) {
      await post('mfa/verify', { mfaToken: token, code: bad }).expect(401);
    }
    const limited = await post('mfa/verify', {
      mfaToken: token,
      code: totpNow(mfaSecret ?? ''),
    }).expect(429);
    expect(limited.headers['retry-after']).toMatch(/^\d+$/);
  });

  it('wrong codes are limited per user across fresh tokens', async () => {
    const { user, password, mfaSecret } = await createUser(testApp.prisma, {
      role: UserRole.ADMIN,
      mfaEnabled: true,
    });
    const bad = wrongCode(mfaSecret ?? '');
    for (let i = 0; i < 5; i++) {
      await post('mfa/verify', {
        mfaToken: await mfaToken(user, password),
        code: bad,
      }).expect(401);
    }
    await post('mfa/verify', {
      mfaToken: await mfaToken(user, password),
      code: totpNow(mfaSecret ?? ''),
    }).expect(429);
  });

  it('rejects wrong-purpose, forged and access tokens', async () => {
    const enrolled = await createUser(testApp.prisma, {
      role: UserRole.ADMIN,
      mfaEnabled: true,
    });
    const challenge = await mfaToken(enrolled.user, enrolled.password);
    // challenge token cannot run setup/enable
    await post('mfa/setup', { mfaToken: challenge }).expect(401);
    await post('mfa/enable', {
      mfaToken: challenge,
      code: totpNow(enrolled.mfaSecret ?? ''),
    }).expect(401);

    const fresh = await createUser(testApp.prisma, { role: UserRole.ADMIN });
    const setupToken = await mfaToken(fresh.user, fresh.password);
    await post('mfa/verify', { mfaToken: setupToken, code: '123456' }).expect(
      401,
    );

    const tokens = testApp.app.get(TokenService);
    const access = await tokens.signAccess(
      enrolled.user.id,
      crypto.randomUUID(),
    );
    await post('mfa/verify', {
      mfaToken: access.token,
      code: totpNow(enrolled.mfaSecret ?? ''),
    }).expect(401);
    await post('mfa/verify', { mfaToken: 'not a jwt', code: '123456' }).expect(
      400,
    );
  });

  it('a user blocked after the password step cannot finish MFA', async () => {
    const { user, password, mfaSecret } = await createUser(testApp.prisma, {
      role: UserRole.ADMIN,
      mfaEnabled: true,
    });
    const token = await mfaToken(user, password);
    await testApp.prisma.user.update({
      where: { id: user.id },
      data: {
        status: UserStatus.BLOCKED,
        blockedAt: new Date(),
        blockedReason: 'test',
      },
    });
    await post('mfa/verify', {
      mfaToken: token,
      code: totpNow(mfaSecret ?? ''),
    }).expect(401);
    expect(
      await testApp.prisma.session.count({ where: { userId: user.id } }),
    ).toBe(0);
  });
});
