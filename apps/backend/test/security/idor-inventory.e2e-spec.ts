import { randomUUID } from 'node:crypto';
import { createTestApp, type TestApp } from '../utils/app.js';
import { createInventoryItem } from '../utils/factories.js';
import {
  createFarmer,
  ITEMS,
  itemQuantity,
  movementAuditCount,
  movementCount,
  movementsUrl,
  newKey,
  postMovement,
  storedKeyCount,
  type Farmer,
} from '../inventory/inventory-helpers.js';
import type { InventoryItem } from '../../src/generated/prisma/client.js';

// Another farmer's inventory must be indistinguishable from a missing one
// (404, same body) on every route, and never reachable through filters.
describe('Security: IDOR on inventory', () => {
  let testApp: TestApp;
  let victim: Farmer;
  let attacker: Farmer;
  let victimItem: InventoryItem;

  beforeAll(async () => {
    testApp = await createTestApp({ features: ['inventory'] });
    victim = await createFarmer(testApp);
    attacker = await createFarmer(testApp);
    victimItem = await createInventoryItem(testApp.prisma, {
      farmId: victim.farm.id,
      quantity: '10',
      name: `Victim ${randomUUID()}`,
    });
    await postMovement(testApp, victim.auth, victimItem.id, {
      type: 'IN',
      quantity: '1',
    }).expect(201);
  });

  afterAll(async () => {
    await testApp.close();
  });

  const as = (farmer: Farmer) => ({
    get: (url: string) => testApp.http().get(url).set(farmer.auth.authHeader),
    post: (url: string, body?: object) =>
      testApp.http().post(url).set(farmer.auth.authHeader).send(body),
    patch: (url: string, body: object) =>
      testApp.http().patch(url).set(farmer.auth.authHeader).send(body),
  });

  function expectNotFound(res: {
    status: number;
    body: Record<string, unknown>;
  }) {
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND', message: 'Topilmadi' });
    expect(JSON.stringify(res.body)).not.toContain(victimItem.id);
    expect(JSON.stringify(res.body)).not.toContain(victimItem.name);
  }

  /** Foreign and unknown ids must produce the same body (bar requestId). */
  async function expectSameAsUnknown(
    send: (id: string) => Promise<{
      status: number;
      body: Record<string, unknown>;
    }>,
    foreignId = victimItem.id,
  ) {
    const foreign = await send(foreignId);
    const unknown = await send(randomUUID());
    expectNotFound(foreign);
    expect(unknown.status).toBe(404);
    expect({ ...foreign.body, requestId: null }).toEqual({
      ...unknown.body,
      requestId: null,
    });
  }

  it('foreign item and unknown id answer identically on reads', async () => {
    await expectSameAsUnknown((id) => as(attacker).get(`${ITEMS}/${id}`));
    await expectSameAsUnknown((id) => as(attacker).get(movementsUrl(id)));
  });

  it('cannot change, open or archive a foreign item', async () => {
    await expectSameAsUnknown((id) =>
      as(attacker).patch(`${ITEMS}/${id}`, { name: 'Pwned' }),
    );
    await expectSameAsUnknown((id) => as(attacker).post(`${ITEMS}/${id}/open`));
    await expectSameAsUnknown((id) =>
      as(attacker).post(`${ITEMS}/${id}/archive`),
    );
    const stored = await testApp.prisma.inventoryItem.findUniqueOrThrow({
      where: { id: victimItem.id },
    });
    expect(stored).toMatchObject({
      name: victimItem.name,
      openedAt: null,
      archivedAt: null,
    });
    expect(
      await testApp.prisma.auditLog.count({
        where: { actorId: attacker.user.id },
      }),
    ).toBe(0);
  });

  it.each(['IN', 'OUT', 'ADJUSTMENT_OUT'])(
    'cannot post a %s movement to a foreign item',
    async (type) => {
      const keys: string[] = [];
      await expectSameAsUnknown((id) => {
        const key = newKey();
        keys.push(key);
        return postMovement(
          testApp,
          attacker.auth,
          id,
          { type, quantity: '1', reason: 'test' },
          key,
        );
      });
      expect(await itemQuantity(testApp, victimItem.id)).toBe('11.000');
      expect(await movementCount(testApp, victimItem.id)).toBe(1);
      expect(await movementAuditCount(testApp, victimItem.id)).toBe(1);
      expect(await storedKeyCount(testApp, attacker.user.id, keys)).toBe(0);
      expect(
        await testApp.prisma.auditLog.count({
          where: { actorId: attacker.user.id },
        }),
      ).toBe(0);
    },
  );

  it('cannot create items on a foreign farm', async () => {
    const name = `Attack ${randomUUID()}`;
    await expectSameAsUnknown(
      (farmId) =>
        as(attacker).post(ITEMS, {
          farmId,
          name,
          category: 'FEED',
          unit: 'KG',
        }),
      victim.farm.id,
    );
    expect(await testApp.prisma.inventoryItem.count({ where: { name } })).toBe(
      0,
    );
  });

  it('list filters cannot reach foreign items', async () => {
    const byFarm = await as(attacker)
      .get(ITEMS)
      .query({ farmId: victim.farm.id, includeArchived: 'true' })
      .expect(200);
    expect(byFarm.body).toMatchObject({ items: [], total: 0 });

    const all = await as(attacker)
      .get(ITEMS)
      .query({ includeArchived: 'true', limit: '100' })
      .expect(200);
    const ids = all.body.items.map((i: { id: string }) => i.id);
    expect(ids).not.toContain(victimItem.id);
    for (const item of all.body.items) {
      expect(item.farmId).toBe(attacker.farm.id);
    }
  });

  it('list query cannot inject ownership or where clauses', async () => {
    for (const query of [
      { ownerId: victim.user.id },
      { 'farm[ownerId]': victim.user.id },
      { where: '{}' },
      { id: victimItem.id },
    ]) {
      await as(attacker).get(ITEMS).query(query).expect(400);
    }
  });

  it('the owner still sees everything', async () => {
    await as(victim).get(`${ITEMS}/${victimItem.id}`).expect(200);
    const res = await as(victim).get(movementsUrl(victimItem.id)).expect(200);
    expect(res.body.total).toBe(1);
  });
});
