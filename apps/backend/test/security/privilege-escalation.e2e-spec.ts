import { vi } from 'vitest';
import { UserRole, UserStatus } from '../../src/generated/prisma/enums.js';
import { countOtherActiveSuperAdmins } from '../../src/users/super-admin-lock.js';
import { createTestApp, type TestApp } from '../utils/app.js';
import { loginAs } from '../utils/auth.js';
import { createUser, uniquePhone } from '../utils/factories.js';
import {
  actorWithRole,
  archiveOtherActiveSuperAdmins,
  auditRowsFor,
  userSnapshot,
  USERS_URL,
  type Actor,
} from '../users/support.js';

// Wrapped (real behaviour by default) so one test can simulate the state
// "no other ACTIVE SUPER_ADMIN" that the API itself can never produce.
vi.mock('../../src/users/super-admin-lock.js', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('../../src/users/super-admin-lock.js')
    >();
  return {
    ...actual,
    countOtherActiveSuperAdmins: vi.fn(actual.countOtherActiveSuperAdmins),
  };
});

const { SUPER_ADMIN, ADMIN, SUPPORT, VET, FARMER } = UserRole;

interface Mutation {
  name: string;
  method: 'post' | 'patch';
  path: string;
  body?: object;
}

const MUTATIONS: Mutation[] = [
  { name: 'change role', method: 'patch', path: 'role', body: { role: VET } },
  { name: 'block', method: 'post', path: 'block', body: { reason: 'Sinov' } },
  { name: 'unblock', method: 'post', path: 'unblock' },
  {
    name: 'archive',
    method: 'post',
    path: 'archive',
    body: { reason: 'Sinov' },
  },
  { name: 'revoke sessions', method: 'post', path: 'sessions/revoke' },
  { name: 'reset MFA', method: 'post', path: 'mfa/reset' },
];

describe('Privilege escalation via the admin API', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp({ features: ['users'] });
  });

  afterAll(async () => {
    await testApp.close();
  });

  function send(actor: Actor, mutation: Mutation, targetId: string) {
    return testApp
      .http()
      [mutation.method](`${USERS_URL}/${targetId}/${mutation.path}`)
      .set(actor.auth.authHeader)
      .send(mutation.body);
  }

  /** A target with a live session, so "sessions untouched" is observable. */
  async function targetWithSession(role: UserRole) {
    const { user } = await createUser(testApp.prisma, {
      role,
      mfaEnabled: true,
    });
    await loginAs(testApp, user);
    return user;
  }

  async function expectRefusedWithoutChange(
    actor: Actor,
    mutation: Mutation,
    targetId: string,
    status: number,
    code?: string,
  ) {
    const before = await userSnapshot(testApp.prisma, targetId);
    const res = await send(actor, mutation, targetId);
    expect(res.status).toBe(status);
    if (code) expect(res.body.code).toBe(code);
    expect(await userSnapshot(testApp.prisma, targetId)).toEqual(before);
    expect(
      (await auditRowsFor(testApp.prisma, targetId)).filter(
        (row) => row.action !== 'user.viewed',
      ),
    ).toEqual([]);
  }

  describe.each([FARMER, VET, SUPPORT])('%s actor', (role) => {
    let actor: Actor;

    beforeAll(async () => {
      actor = await actorWithRole(testApp, role);
    });

    it.each(MUTATIONS.map((m) => [m.name, m] as const))(
      '%s → 403, nothing changes',
      async (_name, mutation) => {
        const target = await targetWithSession(FARMER);
        await expectRefusedWithoutChange(actor, mutation, target.id, 403);
      },
    );

    it('create user → 403, nothing is created', async () => {
      const phone = await uniquePhone();
      await testApp
        .http()
        .post(USERS_URL)
        .set(actor.auth.authHeader)
        .send({
          phone,
          fullName: 'Yangi admin',
          role: SUPER_ADMIN,
          password: 'Escalate-2026',
        })
        .expect(403);
      expect(
        await testApp.prisma.user.findUnique({ where: { phone } }),
      ).toBeNull();
    });
  });

  it.each([FARMER, VET])(
    '%s cannot read the user directory (403)',
    async (role) => {
      const actor = await actorWithRole(testApp, role);
      const { user: target } = await createUser(testApp.prisma);
      await testApp
        .http()
        .get(USERS_URL)
        .set(actor.auth.authHeader)
        .expect(403);
      await testApp
        .http()
        .get(`${USERS_URL}/${target.id}`)
        .set(actor.auth.authHeader)
        .expect(403);
      expect(await auditRowsFor(testApp.prisma, target.id)).toEqual([]);
    },
  );

  describe('ADMIN actor', () => {
    let admin: Actor;

    beforeAll(async () => {
      admin = await actorWithRole(testApp, ADMIN);
    });

    it.each([ADMIN, SUPER_ADMIN])('cannot grant %s (403)', async (role) => {
      const target = await targetWithSession(FARMER);
      await expectRefusedWithoutChange(
        admin,
        { name: 'grant', method: 'patch', path: 'role', body: { role } },
        target.id,
        403,
      );
    });

    for (const targetRole of [ADMIN, SUPER_ADMIN]) {
      it.each(MUTATIONS.map((m) => [m.name, m] as const))(
        `cannot act on a ${targetRole}: %s → 403`,
        async (_name, mutation) => {
          const target = await targetWithSession(targetRole);
          await expectRefusedWithoutChange(admin, mutation, target.id, 403);
        },
      );
    }

    it.each([ADMIN, SUPER_ADMIN])('cannot create an %s (403)', async (role) => {
      const phone = await uniquePhone();
      await testApp
        .http()
        .post(USERS_URL)
        .set(admin.auth.authHeader)
        .send({ phone, fullName: 'Yangi', role, password: 'Escalate-2026' })
        .expect(403);
      expect(
        await testApp.prisma.user.findUnique({ where: { phone } }),
      ).toBeNull();
    });

    it.each(MUTATIONS.map((m) => [m.name, m] as const))(
      'cannot act on itself: %s → 403',
      async (_name, mutation) => {
        const self = await actorWithRole(testApp, ADMIN);
        const expectedCode =
          mutation.path === 'mfa/reset' ? 'FORBIDDEN' : 'SELF_ACTION_FORBIDDEN';
        await expectRefusedWithoutChange(
          self,
          mutation,
          self.user.id,
          403,
          expectedCode,
        );
      },
    );
  });

  describe('SUPER_ADMIN actor', () => {
    it.each([
      ...[ADMIN, SUPPORT, VET, FARMER].map((role): [string, Mutation] => [
        `demote itself to ${role}`,
        { name: 'demote', method: 'patch', path: 'role', body: { role } },
      ]),
      ...MUTATIONS.filter((m) => m.path !== 'role').map(
        (m): [string, Mutation] => [m.name, m],
      ),
    ])('cannot %s (403 SELF_ACTION_FORBIDDEN)', async (_name, mutation) => {
      const self = await actorWithRole(testApp, SUPER_ADMIN);
      await expectRefusedWithoutChange(
        self,
        mutation,
        self.user.id,
        403,
        'SELF_ACTION_FORBIDDEN',
      );
    });

    it('the service refuses with 409 LAST_SUPER_ADMIN when no other ACTIVE SUPER_ADMIN would remain', async () => {
      const superAdmin = await actorWithRole(testApp, SUPER_ADMIN);
      for (const mutation of MUTATIONS.filter((m) =>
        ['role', 'block', 'archive'].includes(m.path),
      )) {
        const target = await targetWithSession(SUPER_ADMIN);
        vi.mocked(countOtherActiveSuperAdmins).mockResolvedValueOnce(0);
        await expectRefusedWithoutChange(
          superAdmin,
          mutation,
          target.id,
          409,
          'LAST_SUPER_ADMIN',
        );
      }
    });

    it('the database refuses to lose its last ACTIVE SUPER_ADMIN even if the API check were bypassed', async () => {
      const { user: last } = await createUser(testApp.prisma, {
        role: SUPER_ADMIN,
      });
      await archiveOtherActiveSuperAdmins(testApp.prisma, [last.id]);

      for (const data of [
        { role: ADMIN },
        { status: UserStatus.BLOCKED, blockedAt: new Date() },
        { status: UserStatus.ARCHIVED, archivedAt: new Date() },
      ]) {
        await expect(
          testApp.prisma.user.update({ where: { id: last.id }, data }),
        ).rejects.toThrow();
      }
      expect(
        await testApp.prisma.user.findUniqueOrThrow({
          where: { id: last.id },
          select: { role: true, status: true },
        }),
      ).toEqual({ role: SUPER_ADMIN, status: UserStatus.ACTIVE });
    });

    // These archive every other ACTIVE SUPER_ADMIN, so the pair under test
    // are the last two.
    it.each([
      ['demote', { method: 'patch', path: 'role', body: { role: ADMIN } }],
      ['block', { method: 'post', path: 'block', body: { reason: 'Poyga' } }],
      [
        'archive',
        { method: 'post', path: 'archive', body: { reason: 'Poyga' } },
      ],
    ] as const)(
      'two last SUPER_ADMINs that %s each other concurrently leave one ACTIVE',
      async (name, partial) => {
        const mutation: Mutation = { name, ...partial };
        const a = await actorWithRole(testApp, SUPER_ADMIN);
        const b = await actorWithRole(testApp, SUPER_ADMIN);
        await archiveOtherActiveSuperAdmins(testApp.prisma, [
          a.user.id,
          b.user.id,
        ]);

        const statuses = (
          await Promise.all([
            send(a, mutation, b.user.id),
            send(b, mutation, a.user.id),
          ])
        ).map((res) => res.status);

        // The loser is refused: its role is re-read under the lock (403), or
        // its session was already revoked by the winner (401).
        expect(statuses.filter((s) => s === 200)).toHaveLength(1);
        expect(statuses.filter((s) => s === 403 || s === 401)).toHaveLength(1);
        const remaining = await testApp.prisma.user.count({
          where: {
            id: { in: [a.user.id, b.user.id] },
            role: SUPER_ADMIN,
            status: UserStatus.ACTIVE,
          },
        });
        expect(remaining).toBe(1);
      },
    );
  });
});
