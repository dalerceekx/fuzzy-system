import { createTestApp, type TestApp } from '../utils/app.js';
import { createInventoryItem } from '../utils/factories.js';
import {
  createFarmer,
  itemQuantity,
  movementCount,
  movementsUrl,
  newKey,
  postMovement,
  storedKeyCount,
  type Farmer,
} from '../inventory/inventory-helpers.js';

describe('Security: idempotency key collisions on stock movements', () => {
  let testApp: TestApp;
  let farmer: Farmer;

  beforeAll(async () => {
    testApp = await createTestApp({ features: ['inventory'] });
    farmer = await createFarmer(testApp);
  });

  afterAll(async () => {
    await testApp.close();
  });

  const newItem = (quantity = '100') =>
    createInventoryItem(testApp.prisma, { farmId: farmer.farm.id, quantity });

  it('same key + same body: replays the identical response, one movement', async () => {
    const item = await newItem();
    const key = newKey();
    const body = { type: 'OUT', quantity: '2.5' };
    const first = await postMovement(testApp, farmer.auth, item.id, body, key);
    expect(first.status).toBe(201);
    expect(first.headers['idempotent-replayed']).toBeUndefined();

    const second = await postMovement(testApp, farmer.auth, item.id, body, key);
    expect(second.status).toBe(201);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.body).toStrictEqual(first.body);

    expect(await movementCount(testApp, item.id)).toBe(1);
    expect(await itemQuantity(testApp, item.id)).toBe('97.500');
    expect(
      await testApp.prisma.auditLog.count({
        where: { resourceId: first.body.id },
      }),
    ).toBe(1);
  });

  it('same key + different quantity: 409 IDEMPOTENCY_KEY_REUSED, no movement', async () => {
    const item = await newItem();
    const key = newKey();
    await postMovement(
      testApp,
      farmer.auth,
      item.id,
      { type: 'OUT', quantity: '1' },
      key,
    ).expect(201);
    const res = await postMovement(
      testApp,
      farmer.auth,
      item.id,
      { type: 'OUT', quantity: '50' },
      key,
    ).expect(409);
    expect(res.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(res.headers['idempotent-replayed']).toBeUndefined();
    expect(await movementCount(testApp, item.id)).toBe(1);
    expect(await itemQuantity(testApp, item.id)).toBe('99.000');
  });

  it('same key on a different item: 409, nothing recorded on the second item', async () => {
    const a = await newItem();
    const b = await newItem();
    const key = newKey();
    const body = { type: 'IN', quantity: '1' };
    await postMovement(testApp, farmer.auth, a.id, body, key).expect(201);
    const res = await postMovement(
      testApp,
      farmer.auth,
      b.id,
      body,
      key,
    ).expect(409);
    expect(res.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await movementCount(testApp, b.id)).toBe(0);
    expect(await itemQuantity(testApp, b.id)).toBe('100.000');
  });

  it('same key by a different user is independent', async () => {
    const other = await createFarmer(testApp);
    const mine = await newItem();
    const theirs = await createInventoryItem(testApp.prisma, {
      farmId: other.farm.id,
      quantity: '100',
    });
    const key = newKey();
    const body = { type: 'OUT', quantity: '1' };
    const a = await postMovement(testApp, farmer.auth, mine.id, body, key);
    const b = await postMovement(testApp, other.auth, theirs.id, body, key);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(b.headers['idempotent-replayed']).toBeUndefined();
    expect(b.body.id).not.toBe(a.body.id);
    expect(await movementCount(testApp, mine.id)).toBe(1);
    expect(await movementCount(testApp, theirs.id)).toBe(1);
  });

  it('a replay cannot leak another user’s response through a shared key', async () => {
    const other = await createFarmer(testApp);
    const mine = await newItem();
    const key = newKey();
    const body = { type: 'IN', quantity: '3' };
    await postMovement(testApp, farmer.auth, mine.id, body, key).expect(201);
    // Same key, same body, but another user targeting my item → 404, not a replay.
    const res = await postMovement(testApp, other.auth, mine.id, body, key);
    expect(res.status).toBe(404);
    expect(res.headers['idempotent-replayed']).toBeUndefined();
    expect(res.body).not.toHaveProperty('balanceAfter');
    expect(await movementCount(testApp, mine.id)).toBe(1);
  });

  it('10 concurrent identical requests with one key: one movement, identical responses', async () => {
    const item = await newItem();
    const key = newKey();
    const body = { type: 'OUT', quantity: '4' };
    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        postMovement(testApp, farmer.auth, item.id, body, key),
      ),
    );
    expect(responses.map((r) => r.status)).toEqual(Array(10).fill(201));
    expect(
      responses.filter((r) => r.headers['idempotent-replayed'] === 'true'),
    ).toHaveLength(9);
    // Same content (the stored replay is jsonb, so key order may differ).
    for (const r of responses) expect(r.body).toStrictEqual(responses[0].body);
    expect(await movementCount(testApp, item.id)).toBe(1);
    expect(await itemQuantity(testApp, item.id)).toBe('96.000');
  });

  it('a failed movement does not burn the key (errors are not cached)', async () => {
    const item = await newItem('1');
    const key = newKey();
    const body = { type: 'OUT', quantity: '2' };
    await postMovement(testApp, farmer.auth, item.id, body, key).expect(409);
    expect(await storedKeyCount(testApp, farmer.user.id, [key])).toBe(0);
    await testApp.prisma.inventoryItem.update({
      where: { id: item.id },
      data: { quantity: '5' },
    });
    const retry = await postMovement(testApp, farmer.auth, item.id, body, key);
    expect(retry.status).toBe(201);
    expect(retry.headers['idempotent-replayed']).toBeUndefined();
    expect(retry.body.balanceAfter).toBe('3.000');
    expect(await storedKeyCount(testApp, farmer.user.id, [key])).toBe(1);
  });

  it.each([
    [undefined, 'IDEMPOTENCY_KEY_REQUIRED'],
    ['', 'IDEMPOTENCY_KEY_REQUIRED'],
    ['short', 'IDEMPOTENCY_KEY_INVALID'],
    ['has spaces in it', 'IDEMPOTENCY_KEY_INVALID'],
    ['x'.repeat(129), 'IDEMPOTENCY_KEY_INVALID'],
    ['../../etc/passwd', 'IDEMPOTENCY_KEY_INVALID'],
  ])('missing/invalid key %j → 400 %s, no movement', async (key, code) => {
    const item = await newItem();
    let req = testApp
      .http()
      .post(movementsUrl(item.id))
      .set(farmer.auth.authHeader);
    if (key !== undefined) req = req.set('Idempotency-Key', key);
    const res = await req.send({ type: 'OUT', quantity: '1' }).expect(400);
    expect(res.body.code).toBe(code);
    expect(await movementCount(testApp, item.id)).toBe(0);
  });
});
