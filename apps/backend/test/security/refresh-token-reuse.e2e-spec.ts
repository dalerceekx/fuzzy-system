import { AuditAction } from '../../src/audit/audit-actions.js';
import { SessionRevokeReason } from '../../src/generated/prisma/enums.js';
import {
  AUTH,
  CSRF_COOKIE,
  login,
  REFRESH_COOKIE,
  setCookies,
  webCookies,
} from '../auth/helpers.js';
import { createTestApp, type TestApp } from '../utils/app.js';
import { createUser } from '../utils/factories.js';

/**
 * Refresh tokens rotate on every use. Presenting an already-rotated token is
 * treated as theft: the whole token family (session) is revoked, including
 * the newest token the legitimate client (or the attacker) holds.
 */
describe('Security: refresh token reuse detection', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp({ features: ['auth'] });
  });

  afterAll(async () => {
    await testApp.close();
  });

  const refreshBody = (refreshToken: string) =>
    testApp.http().post(`${AUTH}/refresh`).send({ refreshToken });

  async function expectFamilyRevoked(sessionId: string, userId: string) {
    const session = await testApp.prisma.session.findUniqueOrThrow({
      where: { id: sessionId },
    });
    expect(session.revokedReason).toBe(SessionRevokeReason.REFRESH_TOKEN_REUSE);
    expect(session.revokedAt).toBeInstanceOf(Date);
    const audits = await testApp.prisma.auditLog.findMany({
      where: { action: AuditAction.AUTH_REFRESH_REUSE, resourceId: sessionId },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorId: userId,
      resourceType: 'session',
    });
    expect(JSON.stringify(audits[0])).not.toMatch(/eyJ/);
  }

  it('mobile: reusing a rotated token → 401 and the newest token of the family dies too', async () => {
    const { user, password } = await createUser(testApp.prisma);
    const first = await login(testApp, user.phone, password, {
      mobile: true,
    }).expect(200);
    const other = await login(testApp, user.phone, password, {
      mobile: true,
    }).expect(200);
    const r1 = first.body.refreshToken as string;

    const rotated = await refreshBody(r1).expect(200);
    const r2 = rotated.body.refreshToken as string;
    const access2 = rotated.body.accessToken as string;

    const reuse = await refreshBody(r1).expect(401);
    expect(reuse.body.code).toBe('UNAUTHORIZED');

    await refreshBody(r2).expect(401);
    await testApp
      .http()
      .get(`${AUTH}/me`)
      .set('Authorization', `Bearer ${access2}`)
      .expect(401);

    const sessionId = (
      await testApp.prisma.session.findFirstOrThrow({
        where: {
          userId: user.id,
          revokedReason: SessionRevokeReason.REFRESH_TOKEN_REUSE,
        },
      })
    ).id;
    await expectFamilyRevoked(sessionId, user.id);

    // Other families (another device) are unaffected.
    await refreshBody(other.body.refreshToken as string).expect(200);
  });

  it('web (cookie): reuse revokes the family and clears the cookies', async () => {
    const { user, password } = await createUser(testApp.prisma);
    const original = webCookies(
      await login(testApp, user.phone, password).expect(200),
    );
    const refresh = (cookieRefresh: string) =>
      testApp
        .http()
        .post(`${AUTH}/refresh`)
        .set(
          'Cookie',
          `${REFRESH_COOKIE}=${cookieRefresh}; ${CSRF_COOKIE}=${original.csrf}`,
        )
        .set('X-CSRF-Token', original.csrf);

    const rotated = await refresh(original.refresh).expect(200);
    const newRefresh = setCookies(rotated).find(
      (c) => c.name === REFRESH_COOKIE,
    )?.value as string;
    expect(newRefresh).toBeTruthy();

    const reuse = await refresh(original.refresh).expect(401);
    expect(
      setCookies(reuse)
        .filter((c) => c.value === '')
        .map((c) => c.name)
        .sort(),
    ).toEqual([CSRF_COOKIE, REFRESH_COOKIE].sort());

    await refresh(newRefresh).expect(401);
    const session = await testApp.prisma.session.findFirstOrThrow({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });
    await expectFamilyRevoked(session.id, user.id);
  });

  it('two parallel refreshes with the same token: at most one wins, then the family is revoked', async () => {
    const { user, password } = await createUser(testApp.prisma);
    const res = await login(testApp, user.phone, password, {
      mobile: true,
    }).expect(200);
    const token = res.body.refreshToken as string;
    const results = await Promise.all([refreshBody(token), refreshBody(token)]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 200).length).toBeLessThanOrEqual(1);
    expect(statuses).toContain(401);
    for (const result of results.filter((r) => r.status === 200)) {
      await refreshBody(result.body.refreshToken as string).expect(401);
    }
    const session = await testApp.prisma.session.findFirstOrThrow({
      where: { userId: user.id },
    });
    await expectFamilyRevoked(session.id, user.id);
  });
});
