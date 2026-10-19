import { randomUUID } from 'node:crypto';
import { UserRole } from '../../src/generated/prisma/enums.js';
import {
  createFarmer,
  itemQuantity,
  movementsUrl,
  type Farmer,
} from '../inventory/inventory-helpers.js';
import { createTestApp, type TestApp } from '../utils/app.js';
import {
  createFeed,
  defaultTypes,
  ISSUE_SCOPE,
  issueFootprint,
  issuesUrl,
  issueUrl,
  newIssueKey,
  postIssue,
  postRation,
  RATIONS,
  rationBody,
  rationUrl,
} from './rations-helpers.js';

interface MovementBody {
  id: string;
  itemId: string;
  type: string;
  quantity: string;
  balanceAfter: string;
  reason: string | null;
  unitCost: string | null;
  rationIssueId: string | null;
}

describe('Ration issue (Sarfni ombordan chiqarish)', () => {
  let testApp: TestApp;
  let farmer: Farmer;
  let bullTypeId: string;

  beforeAll(async () => {
    testApp = await createTestApp({ features: ['rations'] });
    farmer = await createFarmer(testApp);
    bullTypeId = (await defaultTypes(testApp, farmer)).BULL.id;
  });

  afterAll(async () => {
    await testApp.close();
  });

  /** 10 bulls: 8 kg of A and 0.5 kg of B per animal and day. */
  async function setup(stockA = '1000', stockB = '100', who = farmer) {
    const typeId =
      who === farmer ? bullTypeId : (await defaultTypes(testApp, who)).BULL.id;
    const a = await createFeed(testApp, who.farm.id, stockA, {
      name: `Arpa ${randomUUID().slice(0, 6)}`,
    });
    const b = await createFeed(testApp, who.farm.id, stockB, {
      name: `Beda ${randomUUID().slice(0, 6)}`,
    });
    const res = await postRation(
      testApp,
      who.auth,
      rationBody(who.farm.id, typeId, [
        { inventoryItemId: a.id, dailyPerAnimal: '8' },
        { inventoryItemId: b.id, dailyPerAnimal: '0.5' },
      ]),
    ).expect(201);
    return { rationId: res.body.id as string, name: res.body.name, a, b };
  }

  it('writes one OUT movement per feed, with audits, and decrements stock exactly', async () => {
    const { rationId, name, a, b } = await setup('1000', '100');
    const res = await postIssue(testApp, farmer.auth, rationId, {
      days: 3,
    }).expect(201);
    expect(res.headers['idempotent-replayed']).toBeUndefined();
    expect(res.body).toEqual({
      id: expect.any(String),
      rationId,
      farmId: farmer.farm.id,
      days: 3,
      animalCount: 10,
      actorId: farmer.user.id,
      createdAt: expect.any(String),
      movements: expect.any(Array),
    });
    const movements = res.body.movements as MovementBody[];
    expect(movements).toHaveLength(2);
    const byItem = new Map(movements.map((m) => [m.itemId, m]));
    const reason = `Ratsion: ${name} — 3 kun`;
    expect(byItem.get(a.id)).toMatchObject({
      type: 'OUT',
      quantity: '240.000',
      balanceAfter: '760.000',
      unitCost: null,
      reason,
      rationIssueId: res.body.id,
    });
    expect(byItem.get(b.id)).toMatchObject({
      type: 'OUT',
      quantity: '15.000',
      balanceAfter: '85.000',
      rationIssueId: res.body.id,
    });
    expect(await itemQuantity(testApp, a.id)).toBe('760.000');
    expect(await itemQuantity(testApp, b.id)).toBe('85.000');

    const stored = await testApp.prisma.stockMovement.findMany({
      where: { rationIssueId: res.body.id },
    });
    expect(stored.map((m) => m.itemId).sort()).toEqual([a.id, b.id].sort());

    const stockAudits = await testApp.prisma.auditLog.findMany({
      where: {
        resourceType: 'stock_movement',
        resourceId: { in: movements.map((m) => m.id) },
      },
    });
    expect(stockAudits).toHaveLength(2);
    for (const audit of stockAudits) {
      expect(audit).toMatchObject({
        action: 'inventory.stock.out',
        actorId: farmer.user.id,
        newValue: { type: 'OUT', rationIssueId: res.body.id, reason },
      });
    }
    const [issued] = await testApp.prisma.auditLog.findMany({
      where: { resourceType: 'ration_issue', resourceId: res.body.id },
    });
    expect(issued).toMatchObject({
      action: 'ration.issued',
      actorId: farmer.user.id,
      newValue: { rationId, days: 3, animalCount: 10 },
    });

    // The item ledger shows the link to the issue.
    const ledger = await testApp
      .http()
      .get(movementsUrl(a.id))
      .set(farmer.auth.authHeader)
      .expect(200);
    expect(ledger.body.items[0]).toMatchObject({
      type: 'OUT',
      rationIssueId: res.body.id,
    });
  });

  it('refuses the whole issue when any feed is short: 409 with details, nothing written', async () => {
    // A needs 8 × 10 × 2 = 160 (has 1000); B needs 0.5 × 10 × 2 = 10 (has 9.999).
    const { rationId, a, b } = await setup('1000', '9.999');
    const before = await issueFootprint(testApp, rationId, [a.id, b.id]);
    const key = newIssueKey();
    const res = await postIssue(
      testApp,
      farmer.auth,
      rationId,
      { days: 2 },
      key,
    ).expect(409);
    expect(res.body).toMatchObject({
      statusCode: 409,
      code: 'INSUFFICIENT_STOCK',
      message: 'Omborda yetarli qoldiq yo‘q',
      details: {
        items: [
          {
            inventoryItemId: b.id,
            name: b.name,
            required: '10.000',
            available: '9.999',
          },
        ],
      },
    });
    expect(await issueFootprint(testApp, rationId, [a.id, b.id])).toEqual(
      before,
    );
    expect(before).toMatchObject({ issues: 0, movements: 0, audits: 0 });
    expect(
      await testApp.prisma.idempotencyKey.count({
        where: { userId: farmer.user.id, scope: ISSUE_SCOPE, key },
      }),
    ).toBe(0);
  });

  it('lists every short feed', async () => {
    const { rationId, a, b } = await setup('0', '0');
    const res = await postIssue(testApp, farmer.auth, rationId, {
      days: 1,
    }).expect(409);
    expect(res.body.details.items).toEqual([
      {
        inventoryItemId: a.id,
        name: a.name,
        required: '80.000',
        available: '0.000',
      },
      {
        inventoryItemId: b.id,
        name: b.name,
        required: '5.000',
        available: '0.000',
      },
    ]);
  });

  it('replays the same key with the same body; another body is 409', async () => {
    const { rationId, a, b } = await setup('1000', '100');
    const key = newIssueKey();
    const first = await postIssue(
      testApp,
      farmer.auth,
      rationId,
      { days: 1 },
      key,
    ).expect(201);
    const replay = await postIssue(
      testApp,
      farmer.auth,
      rationId,
      { days: 1 },
      key,
    ).expect(201);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body).toEqual(first.body);
    expect(await itemQuantity(testApp, a.id)).toBe('920.000');
    expect(await itemQuantity(testApp, b.id)).toBe('95.000');
    expect(
      await testApp.prisma.rationIssue.count({ where: { rationId } }),
    ).toBe(1);

    const reused = await postIssue(
      testApp,
      farmer.auth,
      rationId,
      { days: 2 },
      key,
    ).expect(409);
    expect(reused.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('requires an Idempotency-Key', async () => {
    const { rationId } = await setup();
    const res = await testApp
      .http()
      .post(issueUrl(rationId))
      .set(farmer.auth.authHeader)
      .send({ days: 1 })
      .expect(400);
    expect(res.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it.each([{ days: 0 }, { days: 3651 }, { days: '1' }, {}, { days: 1, x: 1 }])(
    'validates %o (400)',
    async (body) => {
      const { rationId, a, b } = await setup();
      await postIssue(testApp, farmer.auth, rationId, body).expect(400);
      expect(
        (await issueFootprint(testApp, rationId, [a.id, b.id])).movements,
      ).toBe(0);
    },
  );

  it('refuses an archived ration (409 RATION_ARCHIVED)', async () => {
    const { rationId, a, b } = await setup();
    await testApp
      .http()
      .post(`${rationUrl(rationId)}/archive`)
      .set(farmer.auth.authHeader)
      .expect(200);
    const res = await postIssue(testApp, farmer.auth, rationId, {
      days: 1,
    }).expect(409);
    expect(res.body.code).toBe('RATION_ARCHIVED');
    expect(
      (await issueFootprint(testApp, rationId, [a.id, b.id])).movements,
    ).toBe(0);
  });

  it('refuses a ration whose feed was archived (409 RATION_ITEM_ARCHIVED)', async () => {
    const { rationId, a, b } = await setup();
    await testApp.prisma.inventoryItem.update({
      where: { id: b.id },
      data: { archivedAt: new Date() },
    });
    const res = await postIssue(testApp, farmer.auth, rationId, {
      days: 1,
    }).expect(409);
    expect(res.body).toMatchObject({
      code: 'RATION_ITEM_ARCHIVED',
      details: { inventoryItemId: b.id },
    });
    expect(await itemQuantity(testApp, a.id)).toBe('1000.000');
  });

  it('404s for another farmer’s or an unknown ration, writing nothing', async () => {
    const victim = await createFarmer(testApp);
    const { rationId, a, b } = await setup('1000', '100', victim);
    for (const id of [rationId, randomUUID()]) {
      const res = await postIssue(testApp, farmer.auth, id, {
        days: 1,
      }).expect(404);
      expect(res.body.code).toBe('NOT_FOUND');
    }
    expect(await issueFootprint(testApp, rationId, [a.id, b.id])).toMatchObject(
      { issues: 0, movements: 0 },
    );
  });

  it('re-checks the actor inside the transaction (demoted after the guard)', async () => {
    const actor = await createFarmer(testApp);
    const { rationId, a, b } = await setup('1000', '100', actor);
    const key = newIssueKey();
    let pending: Promise<{ status: number; body: { code?: string } }>;
    await testApp.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`
          SELECT id FROM users WHERE id = ${actor.user.id}::uuid
          FOR NO KEY UPDATE`;
        pending = postIssue(
          testApp,
          actor.auth,
          rationId,
          { days: 1 },
          key,
        ).then((r) => r);
        await new Promise((r) => setTimeout(r, 500));
        await tx.user.update({
          where: { id: actor.user.id },
          data: { role: UserRole.SUPPORT },
        });
      },
      { timeout: 10_000 },
    );
    const res = await pending!;
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
    expect(await issueFootprint(testApp, rationId, [a.id, b.id])).toMatchObject(
      { issues: 0, movements: 0 },
    );
  });

  it('serializes concurrent issues: stock never goes negative', async () => {
    // Enough of A for exactly one issue of 1 day (80 kg).
    const { rationId, a, b } = await setup('80', '100');
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        postIssue(testApp, farmer.auth, rationId, { days: 1 }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    for (const r of results.filter((x) => x.status === 409)) {
      expect(r.body.code).toBe('INSUFFICIENT_STOCK');
    }
    expect(await itemQuantity(testApp, a.id)).toBe('0.000');
    expect(await itemQuantity(testApp, b.id)).toBe('95.000');
    expect(
      await testApp.prisma.rationIssue.count({ where: { rationId } }),
    ).toBe(1);
  });

  describe('RationResponse.lastIssue', () => {
    const getRation = async (id: string) =>
      (
        await testApp
          .http()
          .get(rationUrl(id))
          .set(farmer.auth.authHeader)
          .expect(200)
      ).body;
    const listedRation = async (id: string) => {
      const res = await testApp
        .http()
        .get(RATIONS)
        .query({ farmId: farmer.farm.id, limit: '100' })
        .set(farmer.auth.authHeader)
        .expect(200);
      return (res.body.items as Array<{ id: string }>).find((r) => r.id === id);
    };

    it('is null before the first issue, then the newest issue', async () => {
      const { rationId } = await setup('10000', '1000');
      expect((await getRation(rationId)).lastIssue).toBeNull();
      expect(await listedRation(rationId)).toMatchObject({ lastIssue: null });

      const first = await postIssue(testApp, farmer.auth, rationId, {
        days: 2,
      }).expect(201);
      expect((await getRation(rationId)).lastIssue).toEqual({
        id: first.body.id,
        createdAt: first.body.createdAt,
        days: 2,
      });

      await new Promise((r) => setTimeout(r, 5));
      const second = await postIssue(testApp, farmer.auth, rationId, {
        days: 1,
      }).expect(201);
      const latest = {
        id: second.body.id,
        createdAt: second.body.createdAt,
        days: 1,
      };
      expect((await getRation(rationId)).lastIssue).toEqual(latest);
      expect(await listedRation(rationId)).toMatchObject({
        lastIssue: latest,
      });

      // Every endpoint returning the ration carries it.
      const patched = await testApp
        .http()
        .patch(rationUrl(rationId))
        .set(farmer.auth.authHeader)
        .send({ name: `Yangi ${randomUUID().slice(0, 6)}` })
        .expect(200);
      expect(patched.body.lastIssue).toEqual(latest);
      const copied = await testApp
        .http()
        .post(`${rationUrl(rationId)}/copy`)
        .set(farmer.auth.authHeader)
        .expect(201);
      expect(copied.body.lastIssue).toBeNull();
      const archived = await testApp
        .http()
        .post(`${rationUrl(rationId)}/archive`)
        .set(farmer.auth.authHeader)
        .expect(200);
      expect(archived.body.lastIssue).toEqual(latest);
    });

    it('is per ration in one list; a refused issue does not count', async () => {
      const given = await setup('10000', '1000');
      const short = await setup('0', '0');
      const issued = await postIssue(testApp, farmer.auth, given.rationId, {
        days: 7,
      }).expect(201);
      await postIssue(testApp, farmer.auth, short.rationId, {
        days: 1,
      }).expect(409);
      expect(await listedRation(given.rationId)).toMatchObject({
        lastIssue: { id: issued.body.id, days: 7 },
      });
      expect(await listedRation(short.rationId)).toMatchObject({
        lastIssue: null,
      });
    });
  });

  describe('GET /rations/:id/issues', () => {
    it('lists issues newest first with their movements', async () => {
      const { rationId } = await setup('10000', '1000');
      const ids: string[] = [];
      for (const days of [1, 2, 3]) {
        const res = await postIssue(testApp, farmer.auth, rationId, {
          days,
        }).expect(201);
        ids.push(res.body.id);
        await new Promise((r) => setTimeout(r, 5));
      }
      const res = await testApp
        .http()
        .get(issuesUrl(rationId))
        .set(farmer.auth.authHeader)
        .expect(200);
      expect(res.body).toMatchObject({ page: 1, limit: 20, total: 3 });
      expect(res.body.items.map((i: { id: string }) => i.id)).toEqual(
        [...ids].reverse(),
      );
      expect(res.body.items[0]).toMatchObject({
        days: 3,
        animalCount: 10,
        movements: [
          expect.objectContaining({ type: 'OUT', rationIssueId: ids[2] }),
          expect.objectContaining({ type: 'OUT', rationIssueId: ids[2] }),
        ],
      });
      const page = await testApp
        .http()
        .get(issuesUrl(rationId))
        .query({ limit: '1', page: '3' })
        .set(farmer.auth.authHeader)
        .expect(200);
      expect(page.body.items.map((i: { id: string }) => i.id)).toEqual([
        ids[0],
      ]);
    });

    it('returns an issue the same way as its creation response', async () => {
      const { rationId } = await setup();
      const created = await postIssue(testApp, farmer.auth, rationId, {
        days: 1,
      }).expect(201);
      const listed = await testApp
        .http()
        .get(issuesUrl(rationId))
        .set(farmer.auth.authHeader)
        .expect(200);
      expect(listed.body.items[0]).toEqual(created.body);
    });

    it('404s for another farmer’s ration and validates paging', async () => {
      const { rationId } = await setup();
      const victim = await createFarmer(testApp);
      await testApp
        .http()
        .get(issuesUrl(rationId))
        .set(victim.auth.authHeader)
        .expect(404);
      await testApp
        .http()
        .get(issuesUrl(rationId))
        .query({ limit: '101' })
        .set(farmer.auth.authHeader)
        .expect(400);
      await testApp
        .http()
        .get(issuesUrl(rationId))
        .query({ sort: 'days' })
        .set(farmer.auth.authHeader)
        .expect(400);
    });
  });
});
