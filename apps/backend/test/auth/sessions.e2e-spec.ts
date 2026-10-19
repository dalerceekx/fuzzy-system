import { AuditAction } from '../../src/audit/audit-actions.js';
import { SessionRevokeReason } from '../../src/generated/prisma/enums.js';
import { createTestApp, type TestApp } from '../utils/app.js';
import { loginAs } from '../utils/auth.js';
import { createUser } from '../utils/factories.js';
import {
  AUTH,
  CSRF_COOKIE,
  login,
  REFRESH_COOKIE,
  setCookies,
  webCookies,
} from './helpers.js';

const ORIGIN = 'http://localhost:5173';

describe('Auth: refresh, logout, sessions, me', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp({ features: ['auth'] });
  });

  afterAll(async () => {
    await testApp.close();
  });

  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  describe('POST /refresh', () => {
    it('mobile: body token in → rotated body token out, no cookies', async () => {
      const { user, password } = await createUser(testApp.prisma);
      const first = await login(testApp, user.phone, password, {
        mobile: true,
      }).expect(200);
      const res = await testApp
        .http()
        .post(`${AUTH}/refresh`)
        .send({ refreshToken: first.body.refreshToken })
        .expect(200);
      expect(res.body).toEqual({
        accessToken: expect.any(String),
        accessTokenExpiresIn: 900,
        refreshToken: expect.any(String),
      });
      expect(res.body.refreshToken).not.toBe(first.body.refreshToken);
      expect(res.headers['set-cookie']).toBeUndefined();
      await testApp
        .http()
        .get(`${AUTH}/me`)
        .set(bearer(res.body.accessToken as string))
        .expect(200);
    });

    it('web: cookie + matching X-CSRF-Token → new cookie, never a body refresh token', async () => {
      const { user, password } = await createUser(testApp.prisma);
      const cookies = webCookies(
        await login(testApp, user.phone, password).expect(200),
      );
      const res = await testApp
        .http()
        .post(`${AUTH}/refresh`)
        .set('Cookie', cookies.header)
        .set('X-CSRF-Token', cookies.csrf)
        .set('Origin', ORIGIN)
        .expect(200);
      expect(res.body).toEqual({
        accessToken: expect.any(String),
        accessTokenExpiresIn: 900,
      });
      const rotated = setCookies(res).find((c) => c.name === REFRESH_COOKIE);
      expect(rotated?.value).toBeTruthy();
      expect(rotated?.value).not.toBe(cookies.refresh);
      expect(rotated?.attributes).toMatchObject({
        httponly: '',
        path: '/api/v1/auth',
      });
      // Family lifetime is absolute: Max-Age only shrinks.
      expect(Number(rotated?.attributes['max-age'])).toBeLessThanOrEqual(
        30 * 86400,
      );
    });

    it('web: missing/mismatched CSRF header or a foreign Origin → 403 CSRF_FAILED, session untouched', async () => {
      const { user, password } = await createUser(testApp.prisma);
      const cookies = webCookies(
        await login(testApp, user.phone, password).expect(200),
      );
      const attempts = [
        () =>
          testApp.http().post(`${AUTH}/refresh`).set('Cookie', cookies.header),
        () =>
          testApp
            .http()
            .post(`${AUTH}/refresh`)
            .set('Cookie', cookies.header)
            .set('X-CSRF-Token', `${cookies.csrf}x`),
        () =>
          testApp
            .http()
            .post(`${AUTH}/refresh`)
            .set('Cookie', `${REFRESH_COOKIE}=${cookies.refresh}`)
            .set('X-CSRF-Token', cookies.csrf),
        () =>
          testApp
            .http()
            .post(`${AUTH}/refresh`)
            .set('Cookie', cookies.header)
            .set('X-CSRF-Token', cookies.csrf)
            .set('Origin', 'https://evil.example'),
      ];
      for (const attempt of attempts) {
        const res = await attempt().expect(403);
        expect(res.body.code).toBe('CSRF_FAILED');
        expect(res.headers['set-cookie']).toBeUndefined();
      }
      // The family is still valid.
      await testApp
        .http()
        .post(`${AUTH}/refresh`)
        .set('Cookie', cookies.header)
        .set('X-CSRF-Token', cookies.csrf)
        .expect(200);
    });

    it('no token at all → 401; an access token is not a refresh token', async () => {
      await testApp.http().post(`${AUTH}/refresh`).expect(401);
      await testApp.http().post(`${AUTH}/refresh`).send({}).expect(401);
      const { user } = await createUser(testApp.prisma);
      const session = await loginAs(testApp, user);
      await testApp
        .http()
        .post(`${AUTH}/refresh`)
        .send({ refreshToken: session.accessToken })
        .expect(401);
      await testApp
        .http()
        .post(`${AUTH}/refresh`)
        .send({ refreshToken: 'garbage' })
        .expect(400);
    });

    it('a failed cookie refresh clears the cookies', async () => {
      const { user, password } = await createUser(testApp.prisma);
      const cookies = webCookies(
        await login(testApp, user.phone, password).expect(200),
      );
      await testApp.prisma.session.updateMany({
        where: { userId: user.id },
        data: {
          revokedAt: new Date(),
          revokedReason: SessionRevokeReason.ADMIN_REVOKED,
        },
      });
      const res = await testApp
        .http()
        .post(`${AUTH}/refresh`)
        .set('Cookie', cookies.header)
        .set('X-CSRF-Token', cookies.csrf)
        .expect(401);
      const cleared = setCookies(res);
      for (const name of [REFRESH_COOKIE, CSRF_COOKIE]) {
        const cookie = cleared.find((c) => c.name === name);
        expect(cookie?.value).toBe('');
        expect(cookie?.attributes.expires).toContain('1970');
      }
    });
  });

  describe('logout / logout-all', () => {
    it('logout revokes only the current session, clears cookies, audits', async () => {
      const { user } = await createUser(testApp.prisma);
      const current = await loginAs(testApp, user);
      const other = await loginAs(testApp, user);
      const res = await testApp
        .http()
        .post(`${AUTH}/logout`)
        .set(current.authHeader)
        .expect(204);
      expect(
        setCookies(res)
          .map((c) => c.name)
          .sort(),
      ).toEqual([CSRF_COOKIE, REFRESH_COOKIE].sort());

      await testApp
        .http()
        .get(`${AUTH}/me`)
        .set(current.authHeader)
        .expect(401);
      await testApp.http().get(`${AUTH}/me`).set(other.authHeader).expect(200);
      const row = await testApp.prisma.session.findUniqueOrThrow({
        where: { id: current.sessionId },
      });
      expect(row.revokedReason).toBe(SessionRevokeReason.LOGOUT);
      expect(
        await testApp.prisma.auditLog.count({
          where: {
            action: AuditAction.AUTH_LOGOUT,
            resourceId: current.sessionId,
            actorId: user.id,
          },
        }),
      ).toBe(1);
    });

    it('logout-all revokes every session of the user and audits', async () => {
      const { user } = await createUser(testApp.prisma);
      const a = await loginAs(testApp, user);
      const b = await loginAs(testApp, user);
      const bystander = await loginAs(
        testApp,
        (await createUser(testApp.prisma)).user,
      );
      await testApp
        .http()
        .post(`${AUTH}/logout-all`)
        .set(a.authHeader)
        .expect(204);
      for (const session of [a, b]) {
        await testApp
          .http()
          .get(`${AUTH}/me`)
          .set(session.authHeader)
          .expect(401);
      }
      await testApp
        .http()
        .get(`${AUTH}/me`)
        .set(bystander.authHeader)
        .expect(200);
      const rows = await testApp.prisma.session.findMany({
        where: { id: { in: [a.sessionId, b.sessionId] } },
      });
      expect(rows.map((r) => r.revokedReason)).toEqual([
        SessionRevokeReason.LOGOUT_ALL,
        SessionRevokeReason.LOGOUT_ALL,
      ]);
      const audit = await testApp.prisma.auditLog.findFirstOrThrow({
        where: { action: AuditAction.AUTH_LOGOUT_ALL, resourceId: user.id },
      });
      expect(audit).toMatchObject({ actorId: user.id });
      expect(audit.newValue).toMatchObject({ sessionsRevoked: 2 });
    });

    it('anonymous calls are rejected', async () => {
      await testApp.http().post(`${AUTH}/logout`).expect(401);
      await testApp.http().post(`${AUTH}/logout-all`).expect(401);
      await testApp.http().get(`${AUTH}/sessions`).expect(401);
      await testApp.http().get(`${AUTH}/me`).expect(401);
    });
  });

  describe('GET /sessions, DELETE /sessions/:id', () => {
    it('lists own active sessions, paginated, marking the current one', async () => {
      const { user } = await createUser(testApp.prisma);
      const current = await loginAs(testApp, user, { userAgent: 'ua-current' });
      const others = [
        await loginAs(testApp, user),
        await loginAs(testApp, user),
      ];
      const revoked = await loginAs(testApp, user);
      await testApp.prisma.session.update({
        where: { id: revoked.sessionId },
        data: {
          revokedAt: new Date(),
          revokedReason: SessionRevokeReason.LOGOUT,
        },
      });
      await loginAs(testApp, (await createUser(testApp.prisma)).user);

      const res = await testApp
        .http()
        .get(`${AUTH}/sessions`)
        .set(current.authHeader)
        .expect(200);
      expect(res.body).toMatchObject({ page: 1, limit: 20, total: 3 });
      const items = res.body.items as Array<Record<string, unknown>>;
      expect(items.map((i) => i.id).sort()).toEqual(
        [current.sessionId, ...others.map((o) => o.sessionId)].sort(),
      );
      expect(items.filter((i) => i.current)).toEqual([
        expect.objectContaining({
          id: current.sessionId,
          userAgent: 'ua-current',
        }),
      ]);
      expect(Object.keys(items[0]).sort()).toEqual(
        ['createdAt', 'current', 'id', 'ip', 'lastUsedAt', 'userAgent'].sort(),
      );

      const page = await testApp
        .http()
        .get(`${AUTH}/sessions?page=2&limit=2`)
        .set(current.authHeader)
        .expect(200);
      expect(page.body).toMatchObject({ page: 2, limit: 2, total: 3 });
      expect(page.body.items).toHaveLength(1);
      await testApp
        .http()
        .get(`${AUTH}/sessions?limit=101`)
        .set(current.authHeader)
        .expect(400);
    });

    it('revokes an own session by id and audits; others → 404', async () => {
      const { user } = await createUser(testApp.prisma);
      const current = await loginAs(testApp, user);
      const second = await loginAs(testApp, user);
      const stranger = await loginAs(
        testApp,
        (await createUser(testApp.prisma)).user,
      );

      await testApp
        .http()
        .delete(`${AUTH}/sessions/${second.sessionId}`)
        .set(current.authHeader)
        .expect(204);
      await testApp.http().get(`${AUTH}/me`).set(second.authHeader).expect(401);
      expect(
        await testApp.prisma.auditLog.count({
          where: {
            action: AuditAction.AUTH_SESSION_REVOKED,
            resourceId: second.sessionId,
            actorId: user.id,
          },
        }),
      ).toBe(1);

      for (const id of [
        stranger.sessionId,
        second.sessionId,
        crypto.randomUUID(),
      ]) {
        const res = await testApp
          .http()
          .delete(`${AUTH}/sessions/${id}`)
          .set(current.authHeader)
          .expect(404);
        expect(res.body.code).toBe('NOT_FOUND');
      }
      await testApp
        .http()
        .get(`${AUTH}/me`)
        .set(stranger.authHeader)
        .expect(200);
      await testApp
        .http()
        .delete(`${AUTH}/sessions/not-a-uuid`)
        .set(current.authHeader)
        .expect(400);
    });
  });

  describe('GET /me', () => {
    it('returns the public user projection', async () => {
      const { user } = await createUser(testApp.prisma);
      const session = await loginAs(testApp, user);
      const res = await testApp
        .http()
        .get(`${AUTH}/me`)
        .set(session.authHeader)
        .expect(200);
      expect(res.body).toMatchObject({
        id: user.id,
        phone: user.phone,
        role: user.role,
        status: user.status,
      });
      expect(Object.keys(res.body as object).sort()).toEqual(
        [
          'archivedAt',
          'blockedAt',
          'createdAt',
          'email',
          'fullName',
          'id',
          'isDemo',
          'lastLoginAt',
          'mfaEnabled',
          'phone',
          'phoneVerifiedAt',
          'role',
          'status',
          'updatedAt',
        ].sort(),
      );
    });
  });
});
