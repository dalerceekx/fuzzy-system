import { Prisma } from '../../src/generated/prisma/client.js';
import { createTestApp, type TestApp } from '../utils/app.js';
import { createInventoryItem } from '../utils/factories.js';
import {
  createFarmer,
  itemQuantity,
  movementAuditCount,
  newKey,
  postMovement,
  storedKeyCount,
  type Farmer,
} from '../inventory/inventory-helpers.js';

// Concurrent stock movements must never oversell or drive stock negative:
// the item row lock serializes them and the DB CHECK is the backstop.
describe('Security: negative stock under concurrency', () => {
  let testApp: TestApp;
  let farmer: Farmer;

  beforeAll(async () => {
    testApp = await createTestApp({ features: ['inventory'] });
    farmer = await createFarmer(testApp);
  });

  afterAll(async () => {
    await testApp.close();
  });

  const ledger = (itemId: string) =>
    testApp.prisma.stockMovement.findMany({
      where: { itemId },
      select: { balanceAfter: true, quantity: true },
    });

  it('20 concurrent OUT of 1 on stock 10: exactly 10 succeed', async () => {
    const item = await createInventoryItem(testApp.prisma, {
      farmId: farmer.farm.id,
      quantity: '10',
    });

    const keys = Array.from({ length: 20 }, () => newKey());
    const responses = await Promise.all(
      keys.map((key) =>
        postMovement(
          testApp,
          farmer.auth,
          item.id,
          { type: 'OUT', quantity: '1' },
          key,
        ),
      ),
    );

    const statuses = responses.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(10);
    expect(statuses.filter((s) => s === 409)).toHaveLength(10);
    for (const r of responses.filter((x) => x.status === 409)) {
      expect(r.body.code).toBe('INSUFFICIENT_STOCK');
    }

    expect(await itemQuantity(testApp, item.id)).toBe('0.000');
    const movements = await ledger(item.id);
    expect(movements).toHaveLength(10);
    const balances = movements
      .map((m) => m.balanceAfter.toFixed(0))
      .sort((a, b) => Number(a) - Number(b));
    expect(balances).toEqual([
      '0',
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
    ]);
    const returned = responses
      .filter((r) => r.status === 201)
      .map((r) => r.body.balanceAfter as string)
      .sort();
    expect(new Set(returned).size).toBe(10);

    // Only the successful movements left audit rows and stored keys.
    expect(await movementAuditCount(testApp, item.id)).toBe(10);
    const refusedKeys = keys.filter((_, i) => responses[i].status === 409);
    expect(await storedKeyCount(testApp, farmer.user.id, refusedKeys)).toBe(0);
    expect(await storedKeyCount(testApp, farmer.user.id, keys)).toBe(10);
  });

  it('two concurrent OUT 7 on stock 10: exactly one succeeds', async () => {
    const item = await createInventoryItem(testApp.prisma, {
      farmId: farmer.farm.id,
      quantity: '10',
    });
    const responses = await Promise.all(
      [0, 1].map(() =>
        postMovement(testApp, farmer.auth, item.id, {
          type: 'OUT',
          quantity: '7',
        }),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(responses.find((r) => r.status === 409)?.body.code).toBe(
      'INSUFFICIENT_STOCK',
    );
    expect(await itemQuantity(testApp, item.id)).toBe('3.000');
    const movements = await ledger(item.id);
    expect(movements).toHaveLength(1);
    expect(movements[0].balanceAfter.toFixed(3)).toBe('3.000');
  });

  it('mixed concurrent IN/OUT keep the ledger consistent and never negative', async () => {
    const item = await createInventoryItem(testApp.prisma, {
      farmId: farmer.farm.id,
      quantity: '1',
    });
    const bodies = Array.from({ length: 16 }, (_, i) =>
      i % 2 === 0
        ? { type: 'IN', quantity: '0.5' }
        : { type: 'OUT', quantity: '1.25' },
    );
    const responses = await Promise.all(
      bodies.map((body) => postMovement(testApp, farmer.auth, item.id, body)),
    );
    for (const r of responses) expect([201, 409]).toContain(r.status);

    const movements = await testApp.prisma.stockMovement.findMany({
      where: { itemId: item.id },
      select: { type: true, quantity: true, balanceAfter: true },
    });
    let expected = new Prisma.Decimal(1);
    for (const m of movements) {
      expected =
        m.type === 'IN'
          ? expected.plus(m.quantity)
          : expected.minus(m.quantity);
    }
    expect(await itemQuantity(testApp, item.id)).toBe(expected.toFixed(3));
    expect(movements).toHaveLength(
      responses.filter((r) => r.status === 201).length,
    );
    for (const m of movements) {
      expect(m.balanceAfter.isNegative()).toBe(false);
    }
  });

  it('the database itself refuses a negative quantity (CHECK backstop)', async () => {
    const item = await createInventoryItem(testApp.prisma, {
      farmId: farmer.farm.id,
      quantity: '1',
    });
    await expect(
      testApp.prisma.inventoryItem.update({
        where: { id: item.id },
        data: { quantity: '-0.001' },
      }),
    ).rejects.toThrow();
    expect(await itemQuantity(testApp, item.id)).toBe('1.000');
  });
});
