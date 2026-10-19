import { UserStatus } from '../../src/generated/prisma/enums.js';
import { AUTH, otpFor, login } from '../auth/helpers.js';
import { craftToken } from '../platform/support/tokens.js';
import { createTestApp, type TestApp } from '../utils/app.js';
import { createUser } from '../utils/factories.js';
import { uniqueIp } from '../utils/ips.js';

/**
 * Expired tokens and tokens of revoked sessions are refused (401) on every
 * path: access tokens on protected routes, refresh tokens on /refresh.
 */
describe('Security: expired and revoked sessions', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp({ features: ['auth'] });
  });

  afterAll(async () => {
    await testApp.close();
  });

  async function mobileSession() {
    const { user, password } = await createUser(testApp.prisma);
    const res = await login(testApp, user.phone, password, {
      mobile: true,
    }).expect(200);
    const session = await testApp.prisma.session.findFirstOrThrow({
      where: { userId: user.id },
    });
    return {
      user,
      password,
      sessionId: session.id,
      access: res.body.accessToken as string,
      refresh: res.body.refreshToken as string,
    };
  }

  const me = (token: string) =>
    testApp.http().get(`${AUTH}/me`).set('Authorization', `Bearer ${token}`);
  const refresh = (token: string) =>
    testApp.http().post(`${AUTH}/refresh`).send({ refreshToken: token });

  it('an expired access token (valid signature, live session) → 401', async () => {
    const s = await mobileSession();
    const expired = craftToken({
      sub: s.user.id,
      sid: s.sessionId,
      expiresIn: -60,
    });
    const res = await me(expired).expect(401);
    expect(res.body).toMatchObject({
      code: 'UNAUTHORIZED',
      message: 'Avtorizatsiya talab qilinadi',
    });
    expect(res.body).not.toHaveProperty('details');
    await me(s.access).expect(200);
  });

  it('an expired refresh token → 401', async () => {
    const s = await mobileSession();
    const expired = craftToken({
      secret: process.env.JWT_REFRESH_SECRET,
      typ: 'refresh',
      sub: s.user.id,
      sid: s.sessionId,
      expiresIn: -60,
    });
    await refresh(expired).expect(401);
  });

  it('an expired session (absolute family lifetime) refuses access and refresh', async () => {
    const s = await mobileSession();
    await testApp.prisma.session.update({
      where: { id: s.sessionId },
      data: {
        createdAt: new Date(Date.now() - 7_200_000),
        expiresAt: new Date(Date.now() - 1_000),
      },
    });
    await me(s.access).expect(401);
    await refresh(s.refresh).expect(401);
  });

  it('after logout: access and refresh tokens are dead', async () => {
    const s = await mobileSession();
    await testApp
      .http()
      .post(`${AUTH}/logout`)
      .set('Authorization', `Bearer ${s.access}`)
      .expect(204);
    await me(s.access).expect(401);
    await refresh(s.refresh).expect(401);
  });

  it('after logout-all: every session of the user is dead', async () => {
    const a = await mobileSession();
    const bRes = await login(testApp, a.user.phone, a.password, {
      mobile: true,
    }).expect(200);
    await testApp
      .http()
      .post(`${AUTH}/logout-all`)
      .set('Authorization', `Bearer ${a.access}`)
      .expect(204);
    for (const token of [a.access, bRes.body.accessToken as string]) {
      await me(token).expect(401);
    }
    for (const token of [a.refresh, bRes.body.refreshToken as string]) {
      await refresh(token).expect(401);
    }
  });

  it('after a password reset: all sessions are dead', async () => {
    const s = await mobileSession();
    const forgot = await testApp
      .http()
      .post(`${AUTH}/password/forgot`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ phone: s.user.phone })
      .expect(202);
    await testApp
      .http()
      .post(`${AUTH}/password/reset`)
      .set('X-Forwarded-For', uniqueIp())
      .send({
        verificationId: forgot.body.verificationId,
        code: await otpFor(testApp, s.user.phone),
        newPassword: 'Yangi-parol-2026',
      })
      .expect(200);
    await me(s.access).expect(401);
    await refresh(s.refresh).expect(401);
  });

  it('after revoking a session by id: its tokens are dead', async () => {
    const a = await mobileSession();
    const b = await login(testApp, a.user.phone, a.password, {
      mobile: true,
    }).expect(200);
    await testApp
      .http()
      .delete(`${AUTH}/sessions/${a.sessionId}`)
      .set('Authorization', `Bearer ${b.body.accessToken as string}`)
      .expect(204);
    await me(a.access).expect(401);
    await refresh(a.refresh).expect(401);
    await me(b.body.accessToken as string).expect(200);
  });

  it('a user blocked after login loses access and refresh immediately', async () => {
    const s = await mobileSession();
    await testApp.prisma.user.update({
      where: { id: s.user.id },
      data: {
        status: UserStatus.BLOCKED,
        blockedAt: new Date(),
        blockedReason: 'test',
      },
    });
    await me(s.access).expect(401);
    await refresh(s.refresh).expect(401);
  });
});
