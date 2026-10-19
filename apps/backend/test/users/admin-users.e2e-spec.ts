import { randomUUID } from 'node:crypto';
import { maskPhone } from '../../src/common/phone.js';
import {
  SessionRevokeReason,
  UserRole,
  UserStatus,
} from '../../src/generated/prisma/enums.js';
import { verifyPassword } from '../../src/security/password.js';
import { createTestApp, type TestApp } from '../utils/app.js';
import { loginAs } from '../utils/auth.js';
import { createUser, uniquePhone } from '../utils/factories.js';
import { uniqueIp } from '../utils/ips.js';
import {
  actorWithRole,
  auditRowsFor,
  USERS_URL,
  type Actor,
} from './support.js';

const { SUPER_ADMIN, ADMIN, SUPPORT, VET, FARMER } = UserRole;

describe('Admin user management (/api/v1/admin/users)', () => {
  let testApp: TestApp;
  let superAdmin: Actor;
  let admin: Actor;
  let support: Actor;

  beforeAll(async () => {
    testApp = await createTestApp({
      features: ['users'],
      // Demo actors must be able to authenticate for the isolation tests.
      env: { DEMO_ACCOUNTS_ENABLED: 'true' },
    });
    superAdmin = await actorWithRole(testApp, SUPER_ADMIN);
    admin = await actorWithRole(testApp, ADMIN);
    support = await actorWithRole(testApp, SUPPORT);
  });

  afterAll(async () => {
    await testApp.close();
  });

  const http = () => testApp.http();

  describe('GET / (list)', () => {
    it('filters by exact phone, paginates and audits the read with a masked phone', async () => {
      const viewer = await actorWithRole(testApp, SUPPORT);
      const { user: target } = await createUser(testApp.prisma);
      const ip = uniqueIp();

      const res = await http()
        .get(USERS_URL)
        .query({ phone: target.phone, limit: '5', sort: '-createdAt' })
        .set(viewer.auth.authHeader)
        .set('X-Forwarded-For', ip)
        .expect(200);

      expect(res.body).toEqual({
        items: [expect.any(Object)],
        page: 1,
        limit: 5,
        total: 1,
      });
      expect(res.body.items[0]).toMatchObject({
        id: target.id,
        phone: target.phone,
        role: FARMER,
        status: UserStatus.ACTIVE,
      });

      const rows = await testApp.prisma.auditLog.findMany({
        where: { action: 'user.list_viewed', actorId: viewer.user.id },
      });
      expect(rows).toHaveLength(1);
      // The lookup is filed under the account it found ("who viewed X").
      expect(rows[0]).toMatchObject({
        actorRole: SUPPORT,
        ip,
        resourceType: 'user',
        resourceId: target.id,
      });
      expect(rows[0].newValue).toMatchObject({
        filters: { phoneMasked: maskPhone(target.phone) },
        returned: 1,
        userIds: [[target.id]],
      });
      expect(JSON.stringify(rows[0])).not.toContain(target.phone);
    });

    it('records the id of every user returned on a full page', async () => {
      const viewer = await actorWithRole(testApp, SUPPORT);
      // Enough rows for a page larger than the audit array cap (50).
      await Promise.all(
        Array.from({ length: 60 }, () => createUser(testApp.prisma)),
      );
      const res = await http()
        .get(USERS_URL)
        .query({ limit: '100', sort: '-createdAt' })
        .set(viewer.auth.authHeader)
        .expect(200);
      const returnedIds = res.body.items.map((u: { id: string }) => u.id);
      expect(returnedIds.length).toBeGreaterThan(50);

      const [row] = await testApp.prisma.auditLog.findMany({
        where: { action: 'user.list_viewed', actorId: viewer.user.id },
      });
      expect(row.resourceId).toBeNull();
      const { userIds } = row.newValue as { userIds: string[][] };
      expect(userIds.flat()).toEqual(returnedIds);
    });

    it('accepts any phone notation and normalizes it', async () => {
      const { user: target } = await createUser(testApp.prisma);
      const local = target.phone.slice(4); // 9 digits without +998
      const res = await http()
        .get(USERS_URL)
        .query({ phone: local })
        .set(support.auth.authHeader)
        .expect(200);
      expect(res.body.items.map((u: { id: string }) => u.id)).toEqual([
        target.id,
      ]);
    });

    it('filters by role and status together', async () => {
      const phone = await uniquePhone();
      const { user: target } = await createUser(testApp.prisma, {
        phone,
        role: VET,
        status: UserStatus.BLOCKED,
      });
      const match = await http()
        .get(USERS_URL)
        .query({ phone, role: VET, status: UserStatus.BLOCKED })
        .set(admin.auth.authHeader)
        .expect(200);
      expect(match.body.items.map((u: { id: string }) => u.id)).toEqual([
        target.id,
      ]);

      const miss = await http()
        .get(USERS_URL)
        .query({ phone, role: FARMER })
        .set(admin.auth.authHeader)
        .expect(200);
      expect(miss.body).toMatchObject({ items: [], total: 0 });
    });

    it('hides demo users unless isDemo=true is requested', async () => {
      const { user: demo } = await createUser(testApp.prisma, { isDemo: true });
      const hidden = await http()
        .get(USERS_URL)
        .query({ phone: demo.phone })
        .set(superAdmin.auth.authHeader)
        .expect(200);
      expect(hidden.body.total).toBe(0);

      const shown = await http()
        .get(USERS_URL)
        .query({ phone: demo.phone, isDemo: 'true' })
        .set(superAdmin.auth.authHeader)
        .expect(200);
      expect(shown.body.items.map((u: { id: string }) => u.id)).toEqual([
        demo.id,
      ]);
    });

    it.each([
      [{ limit: '101' }],
      [{ limit: '0' }],
      [{ page: 'abc' }],
      [{ sort: 'passwordHash' }],
      [{ sort: 'phone' }],
      [{ role: 'ROOT' }],
      [{ status: 'DELETED' }],
      [{ isDemo: 'yes' }],
      [{ phone: '+1 202 555 0100' }],
      [{ where: '{"role":"SUPER_ADMIN"}' }],
    ])('rejects invalid query %o with 400', async (query) => {
      await http()
        .get(USERS_URL)
        .query(query)
        .set(support.auth.authHeader)
        .expect(400);
    });
  });

  describe('GET /:id', () => {
    it('returns the public user with its active session count and audits user.viewed', async () => {
      const viewer = await actorWithRole(testApp, SUPPORT);
      const { user: target } = await createUser(testApp.prisma);
      await loginAs(testApp, target);
      await loginAs(testApp, target);

      const res = await http()
        .get(`${USERS_URL}/${target.id}`)
        .set(viewer.auth.authHeader)
        .expect(200);
      expect(res.body).toMatchObject({
        id: target.id,
        phone: target.phone,
        activeSessionCount: 2,
      });

      const rows = await auditRowsFor(testApp.prisma, target.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        action: 'user.viewed',
        resourceType: 'user',
        actorId: viewer.user.id,
        actorRole: SUPPORT,
      });
      expect(rows[0].requestId).toBe(res.headers['x-request-id']);
    });

    it('still shows archived users', async () => {
      const { user: target } = await createUser(testApp.prisma, {
        status: UserStatus.ARCHIVED,
      });
      const res = await http()
        .get(`${USERS_URL}/${target.id}`)
        .set(admin.auth.authHeader)
        .expect(200);
      expect(res.body.status).toBe(UserStatus.ARCHIVED);
    });

    it('404 for unknown ids, 400 for malformed ids', async () => {
      await http()
        .get(`${USERS_URL}/${randomUUID()}`)
        .set(support.auth.authHeader)
        .expect(404);
      await http()
        .get(`${USERS_URL}/not-a-uuid`)
        .set(support.auth.authHeader)
        .expect(400);
    });
  });

  describe('POST / (create staff account)', () => {
    it('SUPER_ADMIN creates an ADMIN: ACTIVE, phone verified, password hashed, audited', async () => {
      const phone = await uniquePhone();
      const res = await http()
        .post(USERS_URL)
        .set(superAdmin.auth.authHeader)
        .send({
          phone: phone.slice(1), // '998…' is normalized
          fullName: '  Yangi   Admin ',
          role: ADMIN,
          password: 'Staff-pass-2026',
        })
        .expect(201);
      expect(res.body).toMatchObject({
        phone,
        role: ADMIN,
        status: UserStatus.ACTIVE,
        isDemo: false,
        mfaEnabled: false,
      });
      expect(res.body.phoneVerifiedAt).toEqual(expect.any(String));

      const stored = await testApp.prisma.user.findUniqueOrThrow({
        where: { id: res.body.id },
      });
      expect(stored.fullName).toBe('Yangi   Admin');
      await expect(
        verifyPassword('Staff-pass-2026', stored.passwordHash),
      ).resolves.toBe(true);

      const rows = await auditRowsFor(testApp.prisma, stored.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        action: 'user.created',
        actorId: superAdmin.user.id,
        actorRole: SUPER_ADMIN,
        newValue: { role: ADMIN, phoneMasked: maskPhone(phone) },
      });
    });

    it.each([SUPPORT, VET, FARMER])('ADMIN creates a %s', async (role) => {
      const res = await http()
        .post(USERS_URL)
        .set(admin.auth.authHeader)
        .send({
          phone: await uniquePhone(),
          fullName: 'Xodim',
          role,
          password: 'Staff-pass-2026',
        })
        .expect(201);
      expect(res.body.role).toBe(role);
    });

    it('409 PHONE_TAKEN for an existing phone', async () => {
      const { user: existing } = await createUser(testApp.prisma);
      const res = await http()
        .post(USERS_URL)
        .set(superAdmin.auth.authHeader)
        .send({
          phone: existing.phone,
          fullName: 'Takror',
          role: VET,
          password: 'Staff-pass-2026',
        })
        .expect(409);
      expect(res.body.code).toBe('PHONE_TAKEN');
    });

    it.each([
      ['weak password', { password: 'password' }],
      ['password equal to the phone', { password: 'PHONE' }],
      ['unknown role', { role: 'ROOT' }],
      ['extra field', { status: 'ACTIVE' }],
      ['demo-range phone', { phone: '+998000000123' }],
      ['short name', { fullName: 'A' }],
      ['null role', { role: null }],
    ])('400 for %s', async (_name, override: Record<string, unknown>) => {
      const phone = await uniquePhone();
      const body: Record<string, unknown> = {
        phone,
        fullName: 'Xodim',
        role: VET,
        password: 'Staff-pass-2026',
        ...override,
      };
      if (body.password === 'PHONE') body.password = phone;
      await http()
        .post(USERS_URL)
        .set(superAdmin.auth.authHeader)
        .send(body)
        .expect(400);
      expect(
        await testApp.prisma.user.findUnique({ where: { phone } }),
      ).toBeNull();
    });
  });

  describe('PATCH /:id/role', () => {
    it('changes the role, revokes every session of the target and audits old/new', async () => {
      const { user: target } = await createUser(testApp.prisma);
      const targetSession = await loginAs(testApp, target);

      const res = await http()
        .patch(`${USERS_URL}/${target.id}/role`)
        .set(superAdmin.auth.authHeader)
        .send({ role: VET })
        .expect(200);
      expect(res.body).toMatchObject({ id: target.id, role: VET });

      const session = await testApp.prisma.session.findUniqueOrThrow({
        where: { id: targetSession.sessionId },
      });
      expect(session.revokedReason).toBe(SessionRevokeReason.ROLE_CHANGED);
      await http()
        .get(`${USERS_URL}/${target.id}`)
        .set(targetSession.authHeader)
        .expect(401);

      const rows = await auditRowsFor(testApp.prisma, target.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        action: 'user.role.changed',
        actorId: superAdmin.user.id,
        actorRole: SUPER_ADMIN,
        oldValue: { role: FARMER },
        newValue: { role: VET, revokedSessions: 1 },
      });
    });

    it('ADMIN may move a FARMER to SUPPORT', async () => {
      const { user: target } = await createUser(testApp.prisma);
      await http()
        .patch(`${USERS_URL}/${target.id}/role`)
        .set(admin.auth.authHeader)
        .send({ role: SUPPORT })
        .expect(200);
    });

    it('setting the current role again is a no-op (no revocation, no audit)', async () => {
      const { user: target } = await createUser(testApp.prisma, { role: VET });
      const session = await loginAs(testApp, target);
      await http()
        .patch(`${USERS_URL}/${target.id}/role`)
        .set(superAdmin.auth.authHeader)
        .send({ role: VET })
        .expect(200);
      expect(
        (
          await testApp.prisma.session.findUniqueOrThrow({
            where: { id: session.sessionId },
          })
        ).revokedAt,
      ).toBeNull();
      expect(await auditRowsFor(testApp.prisma, target.id)).toHaveLength(0);
    });

    it('400 for an invalid role body', async () => {
      const { user: target } = await createUser(testApp.prisma);
      for (const body of [{}, { role: 'ROOT' }, { role: VET, extra: 1 }]) {
        await http()
          .patch(`${USERS_URL}/${target.id}/role`)
          .set(superAdmin.auth.authHeader)
          .send(body)
          .expect(400);
      }
    });
  });

  describe('POST /:id/block and /:id/unblock', () => {
    it('blocks with a reason, revokes sessions, then unblocks', async () => {
      const { user: target } = await createUser(testApp.prisma);
      const targetSession = await loginAs(testApp, target);

      const blocked = await http()
        .post(`${USERS_URL}/${target.id}/block`)
        .set(admin.auth.authHeader)
        .send({ reason: 'Shubhali faollik' })
        .expect(200);
      expect(blocked.body).toMatchObject({
        status: UserStatus.BLOCKED,
        blockedAt: expect.any(String),
      });
      const stored = await testApp.prisma.user.findUniqueOrThrow({
        where: { id: target.id },
      });
      expect(stored.blockedReason).toBe('Shubhali faollik');
      expect(
        (
          await testApp.prisma.session.findUniqueOrThrow({
            where: { id: targetSession.sessionId },
          })
        ).revokedReason,
      ).toBe(SessionRevokeReason.USER_BLOCKED);

      const again = await http()
        .post(`${USERS_URL}/${target.id}/block`)
        .set(admin.auth.authHeader)
        .send({ reason: 'Yana' })
        .expect(409);
      expect(again.body.code).toBe('USER_ALREADY_BLOCKED');

      const unblocked = await http()
        .post(`${USERS_URL}/${target.id}/unblock`)
        .set(admin.auth.authHeader)
        .expect(200);
      expect(unblocked.body).toMatchObject({
        status: UserStatus.ACTIVE,
        blockedAt: null,
      });
      expect(
        (
          await testApp.prisma.user.findUniqueOrThrow({
            where: { id: target.id },
          })
        ).blockedReason,
      ).toBeNull();

      const rows = await auditRowsFor(testApp.prisma, target.id);
      expect(rows.map((r) => r.action)).toEqual([
        'user.blocked',
        'user.unblocked',
      ]);
      expect(rows[0]).toMatchObject({
        actorId: admin.user.id,
        actorRole: ADMIN,
        oldValue: { status: UserStatus.ACTIVE },
        newValue: {
          status: UserStatus.BLOCKED,
          reason: 'Shubhali faollik',
          revokedSessions: 1,
        },
      });
    });

    it('unblock: 409 USER_NOT_BLOCKED for an active user', async () => {
      const { user: target } = await createUser(testApp.prisma);
      const res = await http()
        .post(`${USERS_URL}/${target.id}/unblock`)
        .set(admin.auth.authHeader)
        .expect(409);
      expect(res.body.code).toBe('USER_NOT_BLOCKED');
    });

    it('unblock: 409 PHONE_NOT_VERIFIED for a user blocked before verification', async () => {
      const { user: target } = await createUser(testApp.prisma, {
        status: UserStatus.PENDING_VERIFICATION,
      });
      await http()
        .post(`${USERS_URL}/${target.id}/block`)
        .set(admin.auth.authHeader)
        .send({ reason: 'Spam ro‘yxatdan o‘tish' })
        .expect(200);
      const res = await http()
        .post(`${USERS_URL}/${target.id}/unblock`)
        .set(admin.auth.authHeader)
        .expect(409);
      expect(res.body.code).toBe('PHONE_NOT_VERIFIED');
    });

    it('400 without a reason', async () => {
      const { user: target } = await createUser(testApp.prisma);
      for (const body of [{}, { reason: '  ' }, { reason: 'x'.repeat(501) }]) {
        await http()
          .post(`${USERS_URL}/${target.id}/block`)
          .set(admin.auth.authHeader)
          .send(body)
          .expect(400);
      }
      expect(
        (
          await testApp.prisma.user.findUniqueOrThrow({
            where: { id: target.id },
          })
        ).status,
      ).toBe(UserStatus.ACTIVE);
    });
  });

  describe('POST /:id/archive', () => {
    it('soft-deletes, revokes sessions, audits; the user then counts as not found for actions', async () => {
      const { user: target } = await createUser(testApp.prisma);
      const targetSession = await loginAs(testApp, target);

      const res = await http()
        .post(`${USERS_URL}/${target.id}/archive`)
        .set(superAdmin.auth.authHeader)
        .send({ reason: 'Foydalanuvchi so‘rovi' })
        .expect(200);
      expect(res.body).toMatchObject({
        status: UserStatus.ARCHIVED,
        archivedAt: expect.any(String),
      });
      expect(
        (
          await testApp.prisma.session.findUniqueOrThrow({
            where: { id: targetSession.sessionId },
          })
        ).revokedReason,
      ).toBe(SessionRevokeReason.USER_ARCHIVED);
      // Still in the database (no hard delete).
      expect(
        await testApp.prisma.user.findUnique({ where: { id: target.id } }),
      ).not.toBeNull();

      for (const [method, path, body] of [
        ['post', 'archive', { reason: 'Yana' }],
        ['post', 'block', { reason: 'Yana' }],
        ['patch', 'role', { role: VET }],
        ['post', 'sessions/revoke', undefined],
      ] as const) {
        await http()
          [method](`${USERS_URL}/${target.id}/${path}`)
          .set(superAdmin.auth.authHeader)
          .send(body)
          .expect(404);
      }

      const rows = await auditRowsFor(testApp.prisma, target.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        action: 'user.archived',
        newValue: {
          status: UserStatus.ARCHIVED,
          reason: 'Foydalanuvchi so‘rovi',
        },
      });
    });

    it('there is no hard-delete route', async () => {
      const { user: target } = await createUser(testApp.prisma);
      await http()
        .delete(`${USERS_URL}/${target.id}`)
        .set(superAdmin.auth.authHeader)
        .expect(404);
      expect(
        await testApp.prisma.user.findUnique({ where: { id: target.id } }),
      ).not.toBeNull();
    });
  });

  describe('POST /:id/sessions/revoke', () => {
    it('revokes all sessions of the target and audits the count', async () => {
      const { user: target } = await createUser(testApp.prisma);
      const first = await loginAs(testApp, target);
      await loginAs(testApp, target);

      const res = await http()
        .post(`${USERS_URL}/${target.id}/sessions/revoke`)
        .set(admin.auth.authHeader)
        .expect(200);
      expect(res.body).toEqual({ revokedSessions: 2 });
      expect(
        await testApp.prisma.session.count({
          where: { userId: target.id, revokedAt: null },
        }),
      ).toBe(0);
      await http()
        .get(`${USERS_URL}/${target.id}`)
        .set(first.authHeader)
        .expect(401);

      const rows = await auditRowsFor(testApp.prisma, target.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        action: 'user.sessions.revoked',
        newValue: { revokedSessions: 2 },
      });
    });
  });

  describe('POST /:id/mfa/reset', () => {
    it('SUPER_ADMIN clears the TOTP enrollment and revokes sessions', async () => {
      const { user: target } = await createUser(testApp.prisma, {
        role: ADMIN,
        mfaEnabled: true,
      });
      const targetSession = await loginAs(testApp, target);

      const res = await http()
        .post(`${USERS_URL}/${target.id}/mfa/reset`)
        .set(superAdmin.auth.authHeader)
        .expect(200);
      expect(res.body).toMatchObject({ id: target.id, mfaEnabled: false });

      const stored = await testApp.prisma.user.findUniqueOrThrow({
        where: { id: target.id },
      });
      expect(stored).toMatchObject({
        mfaEnabled: false,
        mfaSecretEnc: null,
        mfaPendingSecretEnc: null,
        mfaLastUsedStep: null,
      });
      expect(
        (
          await testApp.prisma.session.findUniqueOrThrow({
            where: { id: targetSession.sessionId },
          })
        ).revokedReason,
      ).toBe(SessionRevokeReason.MFA_RESET);

      const rows = await auditRowsFor(testApp.prisma, target.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        action: 'auth.mfa.reset',
        actorId: superAdmin.user.id,
        oldValue: { secondFactorEnrolled: true },
        newValue: { secondFactorEnrolled: false, revokedSessions: 1 },
      });
    });

    it('ADMIN may not reset MFA (403)', async () => {
      const { user: target } = await createUser(testApp.prisma, {
        role: VET,
        mfaEnabled: true,
      });
      await http()
        .post(`${USERS_URL}/${target.id}/mfa/reset`)
        .set(admin.auth.authHeader)
        .expect(403);
      expect(
        (
          await testApp.prisma.user.findUniqueOrThrow({
            where: { id: target.id },
          })
        ).mfaEnabled,
      ).toBe(true);
    });
  });

  describe('demo isolation', () => {
    it('a demo actor sees and acts only on demo users', async () => {
      const demoAdmin = await actorWithRole(testApp, ADMIN, { isDemo: true });
      const { user: real } = await createUser(testApp.prisma);
      const { user: demo } = await createUser(testApp.prisma, { isDemo: true });

      for (const query of [
        { phone: real.phone },
        { phone: real.phone, isDemo: 'false' },
      ]) {
        const res = await http()
          .get(USERS_URL)
          .query(query)
          .set(demoAdmin.auth.authHeader)
          .expect(200);
        expect(res.body.total).toBe(0);
      }
      const listed = await http()
        .get(USERS_URL)
        .query({ phone: demo.phone })
        .set(demoAdmin.auth.authHeader)
        .expect(200);
      expect(listed.body.items.map((u: { id: string }) => u.id)).toEqual([
        demo.id,
      ]);

      await http()
        .get(`${USERS_URL}/${real.id}`)
        .set(demoAdmin.auth.authHeader)
        .expect(404);
      await http()
        .post(`${USERS_URL}/${real.id}/block`)
        .set(demoAdmin.auth.authHeader)
        .send({ reason: 'Demo urinish' })
        .expect(404);
      expect(
        (
          await testApp.prisma.user.findUniqueOrThrow({
            where: { id: real.id },
          })
        ).status,
      ).toBe(UserStatus.ACTIVE);

      await http()
        .post(`${USERS_URL}/${demo.id}/block`)
        .set(demoAdmin.auth.authHeader)
        .send({ reason: 'Demo blok' })
        .expect(200);
    });

    it('a demo actor cannot create users, so it cannot probe real phones', async () => {
      const demoAdmin = await actorWithRole(testApp, ADMIN, { isDemo: true });
      const { user: real } = await createUser(testApp.prisma);
      const freshPhone = await uniquePhone();

      const responses = [];
      for (const phone of [real.phone, freshPhone]) {
        const res = await http()
          .post(USERS_URL)
          .set(demoAdmin.auth.authHeader)
          .send({
            phone,
            fullName: 'Demo xodim',
            role: VET,
            password: 'Staff-pass-2026',
          })
          .expect(403);
        responses.push({ code: res.body.code, message: res.body.message });
      }
      // Identical answers for a taken real phone and a free one.
      expect(responses[0]).toEqual(responses[1]);
      expect(responses[0].code).toBe('DEMO_ACTION_FORBIDDEN');
      expect(
        await testApp.prisma.user.count({ where: { phone: freshPhone } }),
      ).toBe(0);
    });

    it('a non-demo staff member may open a demo user by id (an explicit request)', async () => {
      const { user: demo } = await createUser(testApp.prisma, { isDemo: true });
      const res = await http()
        .get(`${USERS_URL}/${demo.id}`)
        .set(support.auth.authHeader)
        .expect(200);
      expect(res.body).toMatchObject({ id: demo.id, isDemo: true });
    });
  });
});
