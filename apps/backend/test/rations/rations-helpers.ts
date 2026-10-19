import { randomUUID } from 'node:crypto';
import type { InventoryItem } from '../../src/generated/prisma/client.js';
import {
  InventoryCategory,
  type RationProfile,
} from '../../src/generated/prisma/enums.js';
import type { Farmer } from '../inventory/inventory-helpers.js';
import type { TestApp } from '../utils/app.js';
import type { LoggedIn } from '../utils/auth.js';
import { createInventoryItem } from '../utils/factories.js';

export const RATIONS = '/api/v1/rations';
export const ANIMAL_TYPES = `${RATIONS}/animal-types`;
export const rationUrl = (id: string) => `${RATIONS}/${id}`;
export const issueUrl = (id: string) => `${RATIONS}/${id}/issue`;
export const issuesUrl = (id: string) => `${RATIONS}/${id}/issues`;
export const newIssueKey = () => `ration-${randomUUID()}`;
export const ISSUE_SCOPE = 'rations.issue.create';

export interface AnimalTypeBody {
  id: string;
  farmId: string;
  name: string;
  profile: RationProfile;
  species: string;
  sex: string | null;
  isDefault: boolean;
  archivedAt: string | null;
}

/** Lists (and so creates) the farm's default types, keyed by profile. */
export async function defaultTypes(
  testApp: TestApp,
  farmer: Farmer,
): Promise<Record<'BULL' | 'COW' | 'RAM' | 'EWE', AnimalTypeBody>> {
  const res = await testApp
    .http()
    .get(ANIMAL_TYPES)
    .query({ farmId: farmer.farm.id })
    .set(farmer.auth.authHeader)
    .expect(200);
  const types = res.body as AnimalTypeBody[];
  const byProfile = (profile: string) => {
    const found = types.find((t) => t.isDefault && t.profile === profile);
    if (!found) throw new Error(`default type ${profile} missing`);
    return found;
  };
  return {
    BULL: byProfile('BULL'),
    COW: byProfile('COW'),
    RAM: byProfile('RAM'),
    EWE: byProfile('EWE'),
  };
}

/** A FEED item (KG) with stock set directly for test setup. */
export function createFeed(
  testApp: TestApp,
  farmId: string,
  quantity = '1000',
  options: { name?: string; category?: InventoryCategory } = {},
): Promise<InventoryItem> {
  return createInventoryItem(testApp.prisma, {
    farmId,
    quantity,
    category: options.category ?? InventoryCategory.FEED,
    name: options.name,
  });
}

export function rationBody(
  farmId: string,
  animalTypeId: string,
  items: Array<{ inventoryItemId: string; dailyPerAnimal: string }>,
  overrides: Record<string, unknown> = {},
) {
  return {
    farmId,
    animalTypeId,
    name: `Ratsion ${randomUUID().slice(0, 8)}`,
    animalCount: 10,
    purpose: 'FATTENING',
    days: 30,
    items,
    ...overrides,
  };
}

export function postRation(testApp: TestApp, auth: LoggedIn, body: object) {
  return testApp.http().post(RATIONS).set(auth.authHeader).send(body);
}

export function postIssue(
  testApp: TestApp,
  auth: LoggedIn,
  rationId: string,
  body: object,
  key: string = newIssueKey(),
) {
  return testApp
    .http()
    .post(issueUrl(rationId))
    .set(auth.authHeader)
    .set('Idempotency-Key', key)
    .send(body);
}

/** Everything an issue writes for these items (refused issues write none). */
export async function issueFootprint(
  testApp: TestApp,
  rationId: string,
  itemIds: string[],
) {
  const [issues, movements, audits, quantities] = await Promise.all([
    testApp.prisma.rationIssue.count({ where: { rationId } }),
    testApp.prisma.stockMovement.count({ where: { itemId: { in: itemIds } } }),
    testApp.prisma.auditLog.count({
      where: {
        OR: [
          {
            resourceType: 'stock_movement',
            oldValue: { path: ['itemId'], equals: itemIds[0] },
          },
          {
            resourceType: 'ration_issue',
            newValue: { path: ['rationId'], equals: rationId },
          },
        ],
      },
    }),
    testApp.prisma.inventoryItem.findMany({
      where: { id: { in: itemIds } },
      orderBy: { id: 'asc' },
      select: { id: true, quantity: true },
    }),
  ]);
  return {
    issues,
    movements,
    audits,
    quantities: quantities.map((q) => `${q.id}:${q.quantity.toFixed(3)}`),
  };
}
