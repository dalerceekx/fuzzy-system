import { createTestApp, type TestApp } from '../utils/app.js';
import { UserRole } from '../../src/generated/prisma/enums.js';
import { createInventoryItem } from '../utils/factories.js';
import {
  createFarmer,
  itemQuantity,
  movementAuditCount,
  movementCount,
  movementsUrl,
  newKey,
  postMovement,
  storedKeyCount,
  type Farmer,
} from './inventory-helpers.js';

describe('Stock movements', () => {
  let testApp: TestApp;
  let farmer: Farmer;

  beforeAll(async () => {
    testApp = await createTestApp({ features: ['inventory'] });
    farmer = await createFarmer(testApp);
  });

  afterAll(async () => {
    await testApp.close();
  });

  const newItem = (quantity = '0') =>
    createInventoryItem(testApp.prisma, { farmId: farmer.farm.id, quantity });

  const auditFor = (movementId: string) =>
    testApp.prisma.auditLog.findMany({
      where: { resourceType: 'stock_movement', resourceId: movementId },
    });

  it('IN adds stock and writes the movement + audit row', async () => {
    const item = await newItem('1.5');
    const res = await postMovement(testApp, farmer.auth, item.id, {
      type: 'IN',
      quantity: '10.25',
      unitCost: '15000.50',
      currency: 'UZS',
    }).expect(201);
    expect(res.headers['idempotent-replayed']).toBeUndefined();
    expect(res.body).toMatchObject({
      itemId: item.id,
      farmId: farmer.farm.id,
      type: 'IN',
      quantity: '10.250',
      balanceAfter: '11.750',
      unitCost: '15000.50',
      currency: 'UZS',
      reason: null,
      actorId: farmer.user.id,
      rationIssueId: null,
    });
    expect(await itemQuantity(testApp, item.id)).toBe('11.750');

    const audit = await auditFor(res.body.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'inventory.stock.in',
      actorId: farmer.user.id,
      actorRole: 'FARMER',
      oldValue: { itemId: item.id, quantity: '1.500' },
      newValue: {
        itemId: item.id,
        type: 'IN',
        quantity: '10.250',
        balanceAfter: '11.750',
        unitCost: '15000.50',
        currency: 'UZS',
      },
    });
    expect(audit[0].requestId).toEqual(expect.any(String));
  });

  it('a priced IN becomes the item’s unit price; other movements keep it', async () => {
    const item = await newItem('0');
    const unitPrice = async () =>
      (
        await testApp.prisma.inventoryItem.findUniqueOrThrow({
          where: { id: item.id },
        })
      ).unitPrice?.toFixed(2) ?? null;

    const unpriced = await postMovement(testApp, farmer.auth, item.id, {
      type: 'IN',
      quantity: '10',
    }).expect(201);
    expect(unpriced.body.rationIssueId).toBeNull();
    expect(await unitPrice()).toBeNull();

    await postMovement(testApp, farmer.auth, item.id, {
      type: 'IN',
      quantity: '5',
      unitCost: '3400',
      currency: 'UZS',
    }).expect(201);
    expect(await unitPrice()).toBe('3400.00');

    // Only IN sets the price: an unpriced IN, an OUT and a priced
    // adjustment leave it alone.
    await postMovement(testApp, farmer.auth, item.id, {
      type: 'IN',
      quantity: '1',
    }).expect(201);
    await postMovement(testApp, farmer.auth, item.id, {
      type: 'OUT',
      quantity: '1',
    }).expect(201);
    await postMovement(testApp, farmer.auth, item.id, {
      type: 'ADJUSTMENT_IN',
      quantity: '1',
      unitCost: '1',
      currency: 'UZS',
      reason: 'Inventarizatsiya',
    }).expect(201);
    expect(await unitPrice()).toBe('3400.00');

    // The latest priced IN wins, even a cheaper one.
    await postMovement(testApp, farmer.auth, item.id, {
      type: 'IN',
      quantity: '1',
      unitCost: '0',
      currency: 'UZS',
    }).expect(201);
    expect(await unitPrice()).toBe('0.00');

    const read = await testApp
      .http()
      .get(`/api/v1/inventory/items/${item.id}`)
      .set(farmer.auth.authHeader)
      .expect(200);
    expect(read.body.unitPrice).toBe('0.00');
  });

  it('OUT subtracts stock and is audited as inventory.stock.out', async () => {
    const item = await newItem('5');
    const res = await postMovement(testApp, farmer.auth, item.id, {
      type: 'OUT',
      quantity: '0.001',
    }).expect(201);
    expect(res.body.balanceAfter).toBe('4.999');
    const [audit] = await auditFor(res.body.id);
    expect(audit.action).toBe('inventory.stock.out');
  });

  it.each(['ADJUSTMENT_IN', 'ADJUSTMENT_OUT'])(
    '%s requires a reason and is audited as inventory.stock.adjusted',
    async (type) => {
      const item = await newItem('5');
      const missing = await postMovement(testApp, farmer.auth, item.id, {
        type,
        quantity: '1',
      }).expect(400);
      expect(missing.body.code).toBe('VALIDATION_FAILED');

      const res = await postMovement(testApp, farmer.auth, item.id, {
        type,
        quantity: '1',
        reason: '  Inventarizatsiya natijasi  ',
      }).expect(201);
      expect(res.body).toMatchObject({
        reason: 'Inventarizatsiya natijasi',
        balanceAfter: type === 'ADJUSTMENT_IN' ? '6.000' : '4.000',
      });
      const [audit] = await auditFor(res.body.id);
      expect(audit).toMatchObject({
        action: 'inventory.stock.adjusted',
        newValue: { type, reason: 'Inventarizatsiya natijasi' },
      });
    },
  );

  it('refuses OUT beyond stock with 409 INSUFFICIENT_STOCK and changes nothing', async () => {
    const item = await newItem('2');
    const res = await postMovement(testApp, farmer.auth, item.id, {
      type: 'ADJUSTMENT_OUT',
      quantity: '2.001',
      reason: 'Yo‘qotish',
    }).expect(409);
    expect(res.body).toMatchObject({
      code: 'INSUFFICIENT_STOCK',
      message: 'Omborda yetarli qoldiq yo‘q',
    });
    expect(await itemQuantity(testApp, item.id)).toBe('2.000');
    expect(await movementCount(testApp, item.id)).toBe(0);
  });

  it('refuses balances beyond the column range with 409 STOCK_LIMIT_EXCEEDED', async () => {
    const item = await newItem('99999999999.000');
    const res = await postMovement(testApp, farmer.auth, item.id, {
      type: 'IN',
      quantity: '1',
    }).expect(409);
    expect(res.body.code).toBe('STOCK_LIMIT_EXCEEDED');
    expect(await movementCount(testApp, item.id)).toBe(0);
  });

  it('re-checks the actor inside the transaction (demoted after the guard)', async () => {
    const actor = await createFarmer(testApp);
    const item = await createInventoryItem(testApp.prisma, {
      farmId: actor.farm.id,
      quantity: '5',
    });
    const key = newKey();
    let pending: Promise<{ status: number; body: { code?: string } }>;
    // Hold the user row so the request passes the guard and then waits on
    // the service's FOR SHARE; demote the user before releasing it.
    await testApp.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`
          SELECT id FROM users WHERE id = ${actor.user.id}::uuid
          FOR NO KEY UPDATE`;
        pending = postMovement(
          testApp,
          actor.auth,
          item.id,
          { type: 'OUT', quantity: '1' },
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
    expect(await itemQuantity(testApp, item.id)).toBe('5.000');
    expect(await movementCount(testApp, item.id)).toBe(0);
    expect(await movementAuditCount(testApp, item.id)).toBe(0);
    expect(await storedKeyCount(testApp, actor.user.id, [key])).toBe(0);
  });

  it('404s for an archived item', async () => {
    const item = await newItem('5');
    await testApp.prisma.inventoryItem.update({
      where: { id: item.id },
      data: { archivedAt: new Date() },
    });
    await postMovement(testApp, farmer.auth, item.id, {
      type: 'OUT',
      quantity: '1',
    }).expect(404);
    expect(await movementCount(testApp, item.id)).toBe(0);
  });

  describe('decimal validation', () => {
    let itemId: string;

    beforeAll(async () => {
      itemId = (await newItem('100')).id;
    });

    it.each([
      ['number', { quantity: 1 }],
      ['float', { quantity: 0.1 }],
      ['null', { quantity: null }],
      ['missing', {}],
      ['"NaN"', { quantity: 'NaN' }],
      ['"Infinity"', { quantity: 'Infinity' }],
      ['"-Infinity"', { quantity: '-Infinity' }],
      ['exponent', { quantity: '1e2' }],
      ['negative', { quantity: '-1' }],
      ['zero', { quantity: '0' }],
      ['too many decimals', { quantity: '1.0001' }],
      ['too many integer digits', { quantity: '100000000000' }],
      ['plus sign', { quantity: '+1' }],
      ['leading dot', { quantity: '.5' }],
      ['whitespace', { quantity: ' 1' }],
      ['comma', { quantity: '1,5' }],
      ['unitCost number', { quantity: '1', unitCost: 1, currency: 'UZS' }],
      ['unitCost 3dp', { quantity: '1', unitCost: '1.001', currency: 'UZS' }],
      ['unitCost negative', { quantity: '1', unitCost: '-1', currency: 'UZS' }],
      ['unitCost without currency', { quantity: '1', unitCost: '1' }],
      ['currency without unitCost', { quantity: '1', currency: 'UZS' }],
      ['bad currency', { quantity: '1', unitCost: '1', currency: 'so‘m' }],
      ['client balanceAfter', { quantity: '1', balanceAfter: '0' }],
    ])('rejects %s (400)', async (_label, body) => {
      const res = await postMovement(testApp, farmer.auth, itemId, {
        type: 'IN',
        ...body,
      }).expect(400);
      expect(res.body.statusCode).toBe(400);
    });

    it.each([
      '{"type":"IN","quantity":NaN}',
      '{"type":"IN","quantity":Infinity}',
    ])('rejects non-JSON literals %s', async (raw) => {
      const res = await postMovement(testApp, farmer.auth, itemId, raw).expect(
        400,
      );
      expect(res.body.code).toBe('INVALID_JSON');
    });

    it('changed nothing for any rejected request', async () => {
      expect(await itemQuantity(testApp, itemId)).toBe('100.000');
      expect(await movementCount(testApp, itemId)).toBe(0);
    });
  });

  describe('GET /inventory/items/:id/movements', () => {
    it('lists the ledger with pagination and createdAt sort', async () => {
      const item = await newItem('0');
      for (const quantity of ['1', '2', '3']) {
        await postMovement(testApp, farmer.auth, item.id, {
          type: 'IN',
          quantity,
        }).expect(201);
      }
      const asc = await testApp
        .http()
        .get(movementsUrl(item.id))
        .query({ sort: 'createdAt', limit: '2' })
        .set(farmer.auth.authHeader)
        .expect(200);
      expect(asc.body).toMatchObject({ page: 1, limit: 2, total: 3 });
      expect(
        asc.body.items.map((m: { balanceAfter: string }) => m.balanceAfter),
      ).toEqual(['1.000', '3.000']);

      const desc = await testApp
        .http()
        .get(movementsUrl(item.id))
        .set(farmer.auth.authHeader)
        .expect(200);
      expect(desc.body.items[0].balanceAfter).toBe('6.000');

      for (const query of [{ sort: 'quantity' }, { limit: '1000' }]) {
        await testApp
          .http()
          .get(movementsUrl(item.id))
          .query(query)
          .set(farmer.auth.authHeader)
          .expect(400);
      }
    });
  });
});
