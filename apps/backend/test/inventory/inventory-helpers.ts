import { randomUUID } from 'node:crypto';
import type { Farm, User } from '../../src/generated/prisma/client.js';
import { UserRole } from '../../src/generated/prisma/enums.js';
import type { TestApp } from '../utils/app.js';
import { loginAs, type LoggedIn } from '../utils/auth.js';
import { createFarm, createUser } from '../utils/factories.js';

export const ITEMS = '/api/v1/inventory/items';
export const movementsUrl = (itemId: string) => `${ITEMS}/${itemId}/movements`;
export const newKey = () => `inv-${randomUUID()}`;

export interface Farmer {
  user: User;
  farm: Farm;
  auth: LoggedIn;
}

/** A fresh ACTIVE farmer with one farm and a real session. */
export async function createFarmer(testApp: TestApp): Promise<Farmer> {
  const { user } = await createUser(testApp.prisma, { role: UserRole.FARMER });
  const farm = await createFarm(testApp.prisma, { ownerId: user.id });
  return { user, farm, auth: await loginAs(testApp, user) };
}

export function postMovement(
  testApp: TestApp,
  auth: LoggedIn,
  itemId: string,
  body: object | string,
  key: string = newKey(),
) {
  const req = testApp
    .http()
    .post(movementsUrl(itemId))
    .set(auth.authHeader)
    .set('Idempotency-Key', key);
  return typeof body === 'string'
    ? req.set('Content-Type', 'application/json').send(body)
    : req.send(body);
}

export async function itemQuantity(
  testApp: TestApp,
  itemId: string,
): Promise<string> {
  const item = await testApp.prisma.inventoryItem.findUniqueOrThrow({
    where: { id: itemId },
    select: { quantity: true },
  });
  return item.quantity.toFixed(3);
}

export function movementCount(testApp: TestApp, itemId: string) {
  return testApp.prisma.stockMovement.count({ where: { itemId } });
}

/** Audit rows of stock movements on one item (refused requests add none). */
export function movementAuditCount(testApp: TestApp, itemId: string) {
  return testApp.prisma.auditLog.count({
    where: {
      resourceType: 'stock_movement',
      oldValue: { path: ['itemId'], equals: itemId },
    },
  });
}

/** Stored idempotency keys (a refused request must not keep its key). */
export function storedKeyCount(
  testApp: TestApp,
  userId: string,
  keys: string[],
) {
  return testApp.prisma.idempotencyKey.count({
    where: { userId, scope: 'inventory.movement.create', key: { in: keys } },
  });
}
