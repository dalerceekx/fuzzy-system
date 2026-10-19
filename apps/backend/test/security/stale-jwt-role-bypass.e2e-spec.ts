import { vi } from 'vitest';
import { UserRole, UserStatus } from '../../src/generated/prisma/enums.js';
import { lockSuperAdminChanges } from '../../src/users/super-admin-lock.js';
import { createTestApp, type TestApp } from '../utils/app.js';
import { loginAs } from '../utils/auth.js';
import { createUser } from '../utils/factories.js';
import {
  actorWithRole,
  auditRowsFor,
  userSnapshot,
  USERS_URL,
  type Actor,
} from '../users/support.js';

// Wrapped (real behaviour by default) so one test can change the actor's
// row after the guard has run but before the service re-reads it.
vi.mock('../../src/users/super-admin-lock.js', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('../../src/users/super-admin-lock.js')
    >();
  return {
    ...actual,
    lockSuperAdminChanges: vi.fn(actual.lockSuperAdminChanges),
  };
});

const { SUPER_ADMIN, ADMIN, SUPPORT, FARMER, VET } = UserRole;

describe('Old access tokens cannot keep a removed role', () => {
  let testApp: TestApp;
  let superAdmin: Actor;

  beforeAll(async () => {
    testApp = await createTestApp({ features: ['users'] });
    superAdmin = await actorWithRole(testApp, SUPER_ADMIN);
  });

  afterAll(async () => {
    await testApp.close();
  });

  const http = () => testApp.http();

  it('an ADMIN demoted to FARMER through the API is logged out at once (401)', async () => {
    const admin = await actorWithRole(testApp, ADMIN);
    await http().get(USERS_URL).set(admin.auth.authHeader).expect(200);

    await http()
      .patch(`${USERS_URL}/${admin.user.id}/role`)
      .set(superAdmin.auth.authHeader)
      .send({ role: FARMER })
      .expect(200);

    await http().get(USERS_URL).set(admin.auth.authHeader).expect(401);
    const { user: victim } = await createUser(testApp.prisma);
    const before = await userSnapshot(testApp.prisma, victim.id);
    await http()
      .post(`${USERS_URL}/${victim.id}/block`)
      .set(admin.auth.authHeader)
      .send({ reason: 'Eski token' })
      .expect(401);
    expect(await userSnapshot(testApp.prisma, victim.id)).toEqual(before);
    expect(
      await testApp.prisma.session.count({
        where: { userId: admin.user.id, revokedAt: null },
      }),
    ).toBe(0);
  });

  it('a promoted user must sign in again: the pre-promotion token is revoked', async () => {
    const support = await actorWithRole(testApp, SUPPORT);
    await http()
      .patch(`${USERS_URL}/${support.user.id}/role`)
      .set(superAdmin.auth.authHeader)
      .send({ role: ADMIN })
      .expect(200);
    const { user: victim } = await createUser(testApp.prisma);
    await http()
      .patch(`${USERS_URL}/${victim.id}/role`)
      .set(support.auth.authHeader)
      .send({ role: VET })
      .expect(401);
    expect((await userSnapshot(testApp.prisma, victim.id)).role).toBe(FARMER);
  });

  describe('defense in depth: role/status changed in the DB without revoking sessions', () => {
    it('the guard uses the current DB role, so the old token gets 403 on admin routes', async () => {
      const admin = await actorWithRole(testApp, ADMIN);
      await testApp.prisma.user.update({
        where: { id: admin.user.id },
        data: { role: FARMER },
      });
      // The session itself is still valid…
      expect(
        await testApp.prisma.session.count({
          where: { userId: admin.user.id, revokedAt: null },
        }),
      ).toBe(1);

      // …but every admin route is refused and nothing changes.
      const { user: victim } = await createUser(testApp.prisma);
      const before = await userSnapshot(testApp.prisma, victim.id);
      await http().get(USERS_URL).set(admin.auth.authHeader).expect(403);
      await http()
        .get(`${USERS_URL}/${victim.id}`)
        .set(admin.auth.authHeader)
        .expect(403);
      await http()
        .patch(`${USERS_URL}/${victim.id}/role`)
        .set(admin.auth.authHeader)
        .send({ role: SUPPORT })
        .expect(403);
      await http()
        .post(`${USERS_URL}/${victim.id}/archive`)
        .set(admin.auth.authHeader)
        .send({ reason: 'Eski rol' })
        .expect(403);
      expect(await userSnapshot(testApp.prisma, victim.id)).toEqual(before);
      expect(await auditRowsFor(testApp.prisma, victim.id)).toEqual([]);
    });

    it('a SUPER_ADMIN lowered to ADMIN in the DB loses SUPER_ADMIN-only powers immediately', async () => {
      const formerSuper = await actorWithRole(testApp, SUPER_ADMIN);
      await testApp.prisma.user.update({
        where: { id: formerSuper.user.id },
        data: { role: ADMIN },
      });
      const { user: otherAdmin } = await createUser(testApp.prisma, {
        role: ADMIN,
        mfaEnabled: true,
      });
      const before = await userSnapshot(testApp.prisma, otherAdmin.id);
      await http()
        .post(`${USERS_URL}/${otherAdmin.id}/mfa/reset`)
        .set(formerSuper.auth.authHeader)
        .expect(403);
      await http()
        .post(`${USERS_URL}/${otherAdmin.id}/block`)
        .set(formerSuper.auth.authHeader)
        .send({ reason: 'Eski rol' })
        .expect(403);
      expect(await userSnapshot(testApp.prisma, otherAdmin.id)).toEqual(before);
    });

    it.each([
      ['demoted to FARMER', { role: FARMER }],
      ['blocked', { status: UserStatus.BLOCKED, blockedAt: new Date() }],
    ])(
      'the service re-checks the actor inside the transaction: ADMIN %s after the guard ran → 403, nothing changes',
      async (_label, change) => {
        const admin = await actorWithRole(testApp, ADMIN);
        const { user: victim } = await createUser(testApp.prisma);
        await loginAs(testApp, victim);
        const before = await userSnapshot(testApp.prisma, victim.id);
        const { lockSuperAdminChanges: realLock } = await vi.importActual<
          typeof import('../../src/users/super-admin-lock.js')
        >('../../src/users/super-admin-lock.js');

        // Runs inside the admin transaction, after RolesGuard accepted the
        // request as ADMIN and before the actor row is locked and re-read.
        // The change is committed on a separate connection.
        vi.mocked(lockSuperAdminChanges).mockImplementationOnce(async (tx) => {
          await realLock(tx);
          await testApp.prisma.user.update({
            where: { id: admin.user.id },
            data: change,
          });
        });

        await http()
          .post(`${USERS_URL}/${victim.id}/block`)
          .set(admin.auth.authHeader)
          .send({ reason: 'TOCTOU' })
          .expect(403);
        expect(vi.mocked(lockSuperAdminChanges)).toHaveBeenCalled();
        expect(await userSnapshot(testApp.prisma, victim.id)).toEqual(before);
        expect(before.activeSessions).toBe(1);
        expect(await auditRowsFor(testApp.prisma, victim.id)).toEqual([]);
      },
    );

    it('a user blocked in the DB is rejected (401) with the old token', async () => {
      const admin = await actorWithRole(testApp, ADMIN);
      await testApp.prisma.user.update({
        where: { id: admin.user.id },
        data: { status: UserStatus.BLOCKED, blockedAt: new Date() },
      });
      await http().get(USERS_URL).set(admin.auth.authHeader).expect(401);
    });
  });
});
