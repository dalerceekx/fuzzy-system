import { randomUUID } from 'node:crypto';
import { UserRole } from '../../src/generated/prisma/enums.js';
import { createTestApp, type TestApp } from '../utils/app.js';
import { createUser } from '../utils/factories.js';
import { actorWithRole, AUDIT_LOGS_URL, type Actor } from './support.js';

const { SUPER_ADMIN, ADMIN, SUPPORT, VET, FARMER } = UserRole;

describe('Audit log read API (/api/v1/admin/audit-logs)', () => {
  let testApp: TestApp;
  let superAdmin: Actor;
  let admin: Actor;

  beforeAll(async () => {
    testApp = await createTestApp({
      features: ['users'],
      env: { DEMO_ACCOUNTS_ENABLED: 'true' },
    });
    superAdmin = await actorWithRole(testApp, SUPER_ADMIN);
    admin = await actorWithRole(testApp, ADMIN);
  });

  afterAll(async () => {
    await testApp.close();
  });

  const http = () => testApp.http();

  /** Inserts audit rows for a fresh resource id. */
  async function seedRows(
    rows: Array<{ actorId?: string | null; action?: string; at?: Date }>,
  ) {
    const resourceId = randomUUID();
    for (const [index, row] of rows.entries()) {
      await testApp.prisma.auditLog.create({
        data: {
          action: row.action ?? 'user.viewed',
          resourceType: 'user',
          resourceId,
          actorId: row.actorId ?? null,
          oldValue: { index },
          newValue: { note: 'saqlangan qiymat' },
          ip: '192.0.2.1',
          userAgent: 'vitest',
          requestId: `req-${index}-${resourceId.slice(0, 8)}`,
          timestamp: row.at ?? new Date(Date.now() + index),
        },
      });
    }
    return resourceId;
  }

  it('returns rows exactly as stored, paginated, newest first by default', async () => {
    const resourceId = await seedRows([
      { actorId: superAdmin.user.id },
      { actorId: admin.user.id, action: 'user.blocked' },
    ]);
    const res = await http()
      .get(AUDIT_LOGS_URL)
      .query({ resourceId })
      .set(admin.auth.authHeader)
      .expect(200);

    const stored = await testApp.prisma.auditLog.findMany({
      where: { resourceId },
      orderBy: { timestamp: 'desc' },
    });
    expect(res.body).toEqual({
      items: stored.map((row) => ({
        ...row,
        timestamp: row.timestamp.toISOString(),
      })),
      page: 1,
      limit: 20,
      total: 2,
    });
  });

  it('supports ascending sort and every filter', async () => {
    const base = Date.now();
    const resourceId = await seedRows([
      { actorId: admin.user.id, at: new Date(base - 60_000) },
      { actorId: superAdmin.user.id, at: new Date(base - 30_000) },
      {
        actorId: superAdmin.user.id,
        action: 'user.blocked',
        at: new Date(base),
      },
    ]);
    const list = async (query: Record<string, string>) =>
      (
        await http()
          .get(AUDIT_LOGS_URL)
          .query({ resourceId, ...query })
          .set(superAdmin.auth.authHeader)
          .expect(200)
      ).body as {
        items: Array<{ oldValue: { index: number } }>;
        total: number;
      };
    const indexes = (body: Awaited<ReturnType<typeof list>>) =>
      body.items.map((item) => item.oldValue.index);

    expect(indexes(await list({ sort: 'timestamp' }))).toEqual([0, 1, 2]);
    expect(indexes(await list({ sort: '-timestamp' }))).toEqual([2, 1, 0]);
    expect(indexes(await list({ actorId: superAdmin.user.id }))).toEqual([
      2, 1,
    ]);
    expect(indexes(await list({ action: 'user.blocked' }))).toEqual([2]);
    expect(indexes(await list({ resourceType: 'animal' }))).toEqual([]);
    expect(
      indexes(
        await list({
          from: new Date(base - 45_000).toISOString(),
          to: new Date(base - 15_000).toISOString(),
        }),
      ),
    ).toEqual([1]);
    expect(
      indexes(await list({ from: '2099-01-01', sort: 'timestamp' })),
    ).toEqual([]);
    expect((await list({ limit: '1' })).total).toBe(3);
  });

  it.each([
    [{ limit: '101' }],
    [{ sort: 'action' }],
    [{ sort: 'timestamp,id' }],
    [{ actorId: 'not-a-uuid' }],
    [{ action: 'DROP TABLE' }],
    [{ resourceType: 'User' }],
    [{ resourceId: '../x' }],
    [{ from: '2026-13-01' }],
    [{ from: '2026-10-16T10:00:00' }],
    [{ to: 'yesterday' }],
    [{ where: '{}' }],
  ])('400 for invalid query %o', async (query) => {
    await http()
      .get(AUDIT_LOGS_URL)
      .query(query)
      .set(admin.auth.authHeader)
      .expect(400);
  });

  it('a date-only "to" includes the whole of that UTC day', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const resourceId = await seedRows([
      { actorId: admin.user.id, at: new Date(`${today}T00:00:00Z`) },
      { actorId: admin.user.id, at: new Date(`${today}T23:59:59.999Z`) },
      {
        actorId: admin.user.id,
        at: new Date(new Date(`${today}T00:00:00Z`).getTime() + 86_400_000),
      },
    ]);
    const res = await http()
      .get(AUDIT_LOGS_URL)
      .query({ resourceId, from: today, to: today, sort: 'timestamp' })
      .set(admin.auth.authHeader)
      .expect(200);
    expect(
      res.body.items.map(
        (item: { oldValue: { index: number } }) => item.oldValue.index,
      ),
    ).toEqual([0, 1]);
  });

  it('every read of the audit log is itself audited', async () => {
    const reader = await actorWithRole(testApp, ADMIN);
    const resourceId = randomUUID();
    await http()
      .get(AUDIT_LOGS_URL)
      .query({ resourceId, from: '2026-01-01', limit: '7' })
      .set(reader.auth.authHeader)
      .expect(200);
    const rows = await testApp.prisma.auditLog.findMany({
      where: { actorId: reader.user.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'audit.logs_viewed',
      actorRole: ADMIN,
      resourceType: 'audit_log',
      resourceId: null,
      newValue: {
        filters: { resourceId, from: '2026-01-01', to: null },
        page: 1,
        limit: 7,
        returned: 0,
      },
    });
  });

  it('400 INVALID_DATE_RANGE when from is after to', async () => {
    const res = await http()
      .get(AUDIT_LOGS_URL)
      .query({ from: '2026-10-02', to: '2026-10-01' })
      .set(admin.auth.authHeader)
      .expect(400);
    expect(res.body.code).toBe('INVALID_DATE_RANGE');
  });

  it.each([SUPPORT, VET, FARMER])('403 for %s', async (role) => {
    const actor = await actorWithRole(testApp, role);
    await http().get(AUDIT_LOGS_URL).set(actor.auth.authHeader).expect(403);
  });

  it('401 without a token', async () => {
    await http().get(AUDIT_LOGS_URL).expect(401);
  });

  it('demo actors only see rows written by demo users', async () => {
    const demoAdmin = await actorWithRole(testApp, ADMIN, { isDemo: true });
    const { user: demoFarmer } = await createUser(testApp.prisma, {
      isDemo: true,
    });
    const resourceId = await seedRows([
      { actorId: demoFarmer.id },
      { actorId: superAdmin.user.id },
      { actorId: null },
    ]);

    const demoView = await http()
      .get(AUDIT_LOGS_URL)
      .query({ resourceId })
      .set(demoAdmin.auth.authHeader)
      .expect(200);
    expect(demoView.body.total).toBe(1);
    expect(demoView.body.items[0].actorId).toBe(demoFarmer.id);

    const realView = await http()
      .get(AUDIT_LOGS_URL)
      .query({ resourceId })
      .set(admin.auth.authHeader)
      .expect(200);
    expect(realView.body.total).toBe(3);
  });

  describe('immutability', () => {
    it('has no mutation routes', async () => {
      const resourceId = await seedRows([{ actorId: admin.user.id }]);
      const row = await testApp.prisma.auditLog.findFirstOrThrow({
        where: { resourceId },
      });
      for (const method of ['post', 'put', 'patch', 'delete'] as const) {
        for (const path of [AUDIT_LOGS_URL, `${AUDIT_LOGS_URL}/${row.id}`]) {
          await http()
            [method](path)
            .set(superAdmin.auth.authHeader)
            .send({ action: 'user.deleted' })
            .expect(404);
        }
      }
      await http()
        .get(`${AUDIT_LOGS_URL}/${row.id}`)
        .set(superAdmin.auth.authHeader)
        .expect(404);
      expect(
        await testApp.prisma.auditLog.findUniqueOrThrow({
          where: { id: row.id },
        }),
      ).toEqual(row);
    });

    it('the database rejects UPDATE and DELETE on audit rows', async () => {
      const resourceId = await seedRows([{ actorId: admin.user.id }]);
      const row = await testApp.prisma.auditLog.findFirstOrThrow({
        where: { resourceId },
      });
      await expect(
        testApp.prisma.auditLog.update({
          where: { id: row.id },
          data: { action: 'user.tampered' },
        }),
      ).rejects.toThrow();
      await expect(
        testApp.prisma.auditLog.delete({ where: { id: row.id } }),
      ).rejects.toThrow();
      await expect(
        testApp.prisma
          .$executeRaw`DELETE FROM audit_logs WHERE id = ${row.id}::uuid`,
      ).rejects.toThrow();
      expect(
        await testApp.prisma.auditLog.findUniqueOrThrow({
          where: { id: row.id },
        }),
      ).toEqual(row);
    });
  });
});
