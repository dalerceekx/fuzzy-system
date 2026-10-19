import { randomUUID } from 'node:crypto';
import {
  SessionRevokeReason,
  UserRole,
  UserStatus,
} from '../../src/generated/prisma/enums.js';
import { keyId } from '../../src/security/crypto.js';
import { createTestApp, type TestApp } from '../utils/app.js';
import { loginAs } from '../utils/auth.js';
import { createUser } from '../utils/factories.js';
import { ProbeController } from './support/probe.controller.js';
import {
  craftToken,
  decodeHeader,
  decodePayload,
  unsignedToken,
} from './support/tokens.js';

const ME = '/api/v1/test-probe/me';

describe('AccessTokenGuard', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp({ controllers: [ProbeController] });
  });

  afterAll(async () => {
    await testApp.close();
  });

  async function farmerSession() {
    const { user } = await createUser(testApp.prisma);
    const auth = await loginAs(testApp, user);
    return { user, auth };
  }

  async function expectUnauthorized(
    headers: Record<string, string>,
  ): Promise<void> {
    const res = await testApp.http().get(ME).set(headers).expect(401);
    expect(res.body).toStrictEqual({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: 'Avtorizatsiya talab qilinadi',
      requestId: res.headers['x-request-id'],
    });
  }

  describe('accepts', () => {
    it('a valid access token and exposes the DB role (no role in the JWT)', async () => {
      const { user, auth } = await farmerSession();
      const res = await testApp.http().get(ME).set(auth.authHeader).expect(200);
      expect(res.body.user).toStrictEqual({
        id: user.id,
        role: UserRole.FARMER,
        sessionId: auth.sessionId,
        isDemo: false,
        mfaVerified: true,
      });
      expect(res.body.context).toMatchObject({
        userId: user.id,
        role: UserRole.FARMER,
      });

      const payload = decodePayload(auth.accessToken);
      expect(Object.keys(payload).sort()).toEqual([
        'aud',
        'exp',
        'iat',
        'iss',
        'jti',
        'sid',
        'sub',
        'typ',
      ]);
      expect(decodeHeader(auth.accessToken)).toMatchObject({
        alg: 'HS256',
        kid: keyId(process.env.JWT_ACCESS_SECRET ?? ''),
      });
    });

    it('re-reads the role from the database on every request', async () => {
      const { user, auth } = await farmerSession();
      await testApp.prisma.user.update({
        where: { id: user.id },
        data: { role: UserRole.SUPPORT },
      });
      const res = await testApp.http().get(ME).set(auth.authHeader).expect(200);
      expect(res.body.user.role).toBe(UserRole.SUPPORT);
    });

    it('tokens signed with a previous secret (rotation) via their kid', async () => {
      const { user, auth } = await farmerSession();
      const previous = process.env.JWT_ACCESS_SECRETS_PREVIOUS ?? '';
      const token = craftToken({
        secret: previous,
        sub: user.id,
        sid: auth.sessionId,
      });
      expect(decodeHeader(token).kid).toBe(keyId(previous));
      await testApp
        .http()
        .get(ME)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });

    it('a lower-case "bearer" scheme (RFC 7235: case-insensitive)', async () => {
      const { auth } = await farmerSession();
      await testApp
        .http()
        .get(ME)
        .set('Authorization', `bearer ${auth.accessToken}`)
        .expect(200);
    });

    it('updates session.lastUsedAt at most every 5 minutes', async () => {
      const { auth } = await farmerSession();
      const old = new Date(Date.now() - 10 * 60 * 1000);
      await testApp.prisma.session.update({
        where: { id: auth.sessionId },
        data: { createdAt: new Date(old.getTime() - 1000), lastUsedAt: old },
      });
      await testApp.http().get(ME).set(auth.authHeader).expect(200);
      const touched = await testApp.prisma.session.findUniqueOrThrow({
        where: { id: auth.sessionId },
      });
      expect(touched.lastUsedAt.getTime()).toBeGreaterThan(old.getTime());

      await testApp.http().get(ME).set(auth.authHeader).expect(200);
      const again = await testApp.prisma.session.findUniqueOrThrow({
        where: { id: auth.sessionId },
      });
      expect(again.lastUsedAt.getTime()).toBe(touched.lastUsedAt.getTime());
    });
  });

  describe('rejects with a uniform 401', () => {
    it('a missing Authorization header', async () => {
      await expectUnauthorized({});
    });

    it.each([
      'Bearer',
      'Bearer ',
      'Basic dXNlcjpwYXNz',
      'Token abc.def.ghi',
      'Bearer not-a-jwt',
      'Bearer a.b',
      'Bearer a.b.c.d',
      `Bearer ${'a'.repeat(5000)}.b.c`,
    ])('a malformed header: %s', async (value) => {
      await expectUnauthorized({ Authorization: value.slice(0, 6000) });
    });

    it('an unsigned alg:none token', async () => {
      const { user, auth } = await farmerSession();
      const payload = decodePayload(auth.accessToken);
      await expectUnauthorized({
        Authorization: `Bearer ${unsignedToken({ ...payload, sub: user.id }, keyId(process.env.JWT_ACCESS_SECRET ?? ''))}`,
      });
    });

    it('a token signed with another HMAC algorithm (HS512)', async () => {
      const { user, auth } = await farmerSession();
      await expectUnauthorized({
        Authorization: `Bearer ${craftToken({ algorithm: 'HS512', sub: user.id, sid: auth.sessionId })}`,
      });
    });

    it('a forged signature with a valid kid', async () => {
      const { user, auth } = await farmerSession();
      const forged = craftToken({
        secret: 'attacker-chosen-secret-0123456789abcdef',
        kid: keyId(process.env.JWT_ACCESS_SECRET ?? ''),
        sub: user.id,
        sid: auth.sessionId,
      });
      await expectUnauthorized({ Authorization: `Bearer ${forged}` });
    });

    it.each([
      ['an unknown kid', { kid: 'deadbeef' }],
      ['no kid', { kid: null }],
      ['a wrong issuer', { iss: 'someone-else' }],
      ['a wrong audience', { aud: 'other-clients' }],
      ['typ=refresh', { typ: 'refresh' }],
      ['typ=mfa', { typ: 'mfa', extra: { purpose: 'challenge' } }],
      ['no exp claim', { expiresIn: null }],
      ['an expired token', { expiresIn: -60 }],
      ['a non-UUID subject', { sub: 'admin' }],
    ] as const)('%s', async (_label, overrides) => {
      const { user, auth } = await farmerSession();
      const token = craftToken({
        sub: user.id,
        sid: auth.sessionId,
        ...overrides,
      });
      await expectUnauthorized({ Authorization: `Bearer ${token}` });
    });

    it('a refresh token used as an access token', async () => {
      const { auth } = await farmerSession();
      await expectUnauthorized({
        Authorization: `Bearer ${auth.refreshToken}`,
      });
    });

    it('a token whose subject does not own the session', async () => {
      const { auth } = await farmerSession();
      const { user: other } = await createUser(testApp.prisma);
      await expectUnauthorized({
        Authorization: `Bearer ${craftToken({ sub: other.id, sid: auth.sessionId })}`,
      });
    });

    it('a token for a session that does not exist', async () => {
      const { user } = await farmerSession();
      await expectUnauthorized({
        Authorization: `Bearer ${craftToken({ sub: user.id, sid: randomUUID() })}`,
      });
    });

    it('a revoked session', async () => {
      const { auth } = await farmerSession();
      await testApp.prisma.session.update({
        where: { id: auth.sessionId },
        data: {
          revokedAt: new Date(),
          revokedReason: SessionRevokeReason.LOGOUT,
        },
      });
      await expectUnauthorized(auth.authHeader);
    });

    it('an expired session (absolute family lifetime)', async () => {
      const { auth } = await farmerSession();
      const past = Date.now() - 60 * 60 * 1000;
      await testApp.prisma.session.update({
        where: { id: auth.sessionId },
        data: { createdAt: new Date(past - 60_000), expiresAt: new Date(past) },
      });
      await expectUnauthorized(auth.authHeader);
    });

    it.each([
      UserStatus.BLOCKED,
      UserStatus.ARCHIVED,
      UserStatus.PENDING_VERIFICATION,
    ])('a user whose status is now %s', async (status) => {
      const { user, auth } = await farmerSession();
      await testApp.prisma.user.update({
        where: { id: user.id },
        data: {
          status,
          blockedAt: status === UserStatus.BLOCKED ? new Date() : null,
          archivedAt: status === UserStatus.ARCHIVED ? new Date() : null,
          phoneVerifiedAt:
            status === UserStatus.PENDING_VERIFICATION ? null : new Date(),
        },
      });
      await expectUnauthorized(auth.authHeader);
    });

    it.each([UserRole.ADMIN, UserRole.SUPER_ADMIN])(
      'a %s session that has not passed MFA',
      async (role) => {
        const { user } = await createUser(testApp.prisma, {
          role,
          mfaEnabled: true,
        });
        const session = await testApp.prisma.session.create({
          data: {
            userId: user.id,
            currentRefreshJti: randomUUID(),
            expiresAt: new Date(Date.now() + 3600_000),
            mfaVerifiedAt: null,
          },
        });
        await expectUnauthorized({
          Authorization: `Bearer ${craftToken({ sub: user.id, sid: session.id })}`,
        });
      },
    );

    it('a user promoted to ADMIN on a session without MFA', async () => {
      const { user } = await createUser(testApp.prisma);
      const auth = await loginAs(testApp, user, { mfaVerified: false });
      await testApp.http().get(ME).set(auth.authHeader).expect(200);
      await testApp.prisma.user.update({
        where: { id: user.id },
        data: { role: UserRole.ADMIN },
      });
      await expectUnauthorized(auth.authHeader);
    });

    it('a demo user while DEMO_ACCOUNTS_ENABLED=false', async () => {
      const { user } = await createUser(testApp.prisma, { isDemo: true });
      const auth = await loginAs(testApp, user);
      await expectUnauthorized(auth.authHeader);
    });

    it('a token sent only as a cookie or query parameter', async () => {
      const { auth } = await farmerSession();
      await testApp
        .http()
        .get(ME)
        .set('Cookie', `access_token=${auth.accessToken}`)
        .expect(401);
      await testApp
        .http()
        .get(`${ME}?access_token=${auth.accessToken}`)
        .expect(401);
    });
  });

  describe('demo accounts enabled (development/test only)', () => {
    let demoApp: TestApp;

    beforeAll(async () => {
      demoApp = await createTestApp({
        controllers: [ProbeController],
        env: { DEMO_ACCOUNTS_ENABLED: 'true' },
      });
    });

    afterAll(async () => {
      await demoApp.close();
    });

    it('lets demo users in', async () => {
      const { user } = await createUser(demoApp.prisma, { isDemo: true });
      const auth = await loginAs(demoApp, user);
      const res = await demoApp.http().get(ME).set(auth.authHeader).expect(200);
      expect(res.body.user).toMatchObject({ id: user.id, isDemo: true });
    });
  });
});
