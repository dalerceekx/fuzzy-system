import { randomUUID } from 'node:crypto';
import { InventoryCategory } from '../../src/generated/prisma/enums.js';
import { createFarmer, type Farmer } from '../inventory/inventory-helpers.js';
import { createTestApp, type TestApp } from '../utils/app.js';
import { createFarm } from '../utils/factories.js';
import {
  ANIMAL_TYPES,
  createFeed,
  defaultTypes,
  postRation,
  RATIONS,
  rationBody,
  rationUrl,
  type AnimalTypeBody,
} from './rations-helpers.js';

type Types = Awaited<ReturnType<typeof defaultTypes>>;

interface RationBody {
  id: string;
  name: string;
  items: Array<{ inventoryItemId: string; dailyPerAnimal: string }>;
  [key: string]: unknown;
}

describe('Rations', () => {
  let testApp: TestApp;
  let farmer: Farmer;
  let types: Types;

  beforeAll(async () => {
    testApp = await createTestApp({ features: ['rations'] });
    farmer = await createFarmer(testApp);
    types = await defaultTypes(testApp, farmer);
  });

  afterAll(async () => {
    await testApp.close();
  });

  const feed = (quantity = '1000', name?: string) =>
    createFeed(testApp, farmer.farm.id, quantity, { name });
  const create = (body: object) => postRation(testApp, farmer.auth, body);
  const patch = (id: string, body: object, who: Farmer = farmer) =>
    testApp.http().patch(rationUrl(id)).set(who.auth.authHeader).send(body);
  const copy = (id: string, body?: object, who: Farmer = farmer) => {
    const req = testApp
      .http()
      .post(`${rationUrl(id)}/copy`)
      .set(who.auth.authHeader);
    return body === undefined ? req : req.send(body);
  };
  const archive = (id: string, who: Farmer = farmer) =>
    testApp
      .http()
      .post(`${rationUrl(id)}/archive`)
      .set(who.auth.authHeader);
  const auditsFor = (rationId: string, action: string) =>
    testApp.prisma.auditLog.findMany({
      where: { resourceType: 'ration', resourceId: rationId, action },
    });

  async function bullRation(overrides: Record<string, unknown> = {}) {
    const a = await feed();
    const b = await feed();
    const res = await create(
      rationBody(
        farmer.farm.id,
        types.BULL.id,
        [
          { inventoryItemId: a.id, dailyPerAnimal: '8' },
          { inventoryItemId: b.id, dailyPerAnimal: '0.5' },
        ],
        overrides,
      ),
    ).expect(201);
    return { ration: res.body as RationBody, a, b };
  }

  describe('GET /rations/profiles', () => {
    it('serves the static profile configuration', async () => {
      const res = await testApp
        .http()
        .get(`${RATIONS}/profiles`)
        .set(farmer.auth.authHeader)
        .expect(200);
      expect(res.body).toEqual([
        {
          profile: 'BULL',
          purposes: ['FATTENING', 'MAINTENANCE', 'BREEDING'],
          states: [],
          fields: ['averageWeightKg', 'ageMonths'],
        },
        {
          profile: 'COW',
          purposes: ['MILK', 'MAINTENANCE', 'FATTENING'],
          states: ['NORMAL', 'PREGNANT', 'LACTATING', 'DRY'],
          fields: ['averageWeightKg', 'ageMonths', 'milkYieldLiters'],
        },
        {
          profile: 'RAM',
          purposes: ['MAINTENANCE', 'BREEDING', 'FATTENING'],
          states: [],
          fields: ['averageWeightKg', 'ageMonths'],
        },
        {
          profile: 'EWE',
          purposes: ['MAINTENANCE', 'BREEDING', 'FATTENING'],
          states: ['NORMAL', 'PREGNANT', 'LACTATING'],
          fields: ['averageWeightKg', 'ageMonths'],
        },
        {
          profile: 'OTHER',
          purposes: ['FATTENING', 'MAINTENANCE', 'MILK', 'BREEDING'],
          states: ['NORMAL', 'PREGNANT', 'LACTATING', 'DRY'],
          fields: ['averageWeightKg', 'ageMonths', 'milkYieldLiters'],
        },
      ]);
    });
  });

  describe('POST /rations', () => {
    it('creates a ration (items in client order) without touching stock', async () => {
      const arpa = await createFeed(testApp, farmer.farm.id, '1250', {
        name: 'Arpa',
      });
      await testApp.prisma.inventoryItem.update({
        where: { id: arpa.id },
        data: { unitPrice: '3400', minQuantity: null },
      });
      const beda = await feed('300');
      const res = await create(
        rationBody(
          farmer.farm.id,
          types.BULL.id,
          // Not in id order: the response keeps this order.
          [
            { inventoryItemId: beda.id, dailyPerAnimal: '2.5' },
            { inventoryItemId: arpa.id, dailyPerAnimal: '8' },
          ],
          {
            name: '  Semirtirish 1-bosqich  ',
            averageWeightKg: '450',
            ageMonths: 18,
            notes: '',
          },
        ),
      ).expect(201);
      expect(res.body).toEqual({
        id: expect.any(String),
        farmId: farmer.farm.id,
        animalTypeId: types.BULL.id,
        animalType: {
          id: types.BULL.id,
          name: 'Buqa',
          profile: 'BULL',
          species: 'CATTLE',
          sex: 'MALE',
        },
        name: 'Semirtirish 1-bosqich',
        animalCount: 10,
        averageWeightKg: '450.00',
        ageMonths: 18,
        purpose: 'FATTENING',
        physiologicalState: null,
        milkYieldLiters: null,
        days: 30,
        notes: null,
        items: [
          {
            inventoryItemId: beda.id,
            dailyPerAnimal: '2.500',
            position: 0,
            item: {
              id: beda.id,
              name: beda.name,
              unit: 'KG',
              category: 'FEED',
              quantity: '300.000',
              unitPrice: null,
              minQuantity: null,
              archivedAt: null,
            },
          },
          {
            inventoryItemId: arpa.id,
            dailyPerAnimal: '8.000',
            position: 1,
            item: expect.objectContaining({
              name: 'Arpa',
              quantity: '1250.000',
              unitPrice: '3400.00',
            }),
          },
        ],
        lastIssue: null,
        archivedAt: null,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });

      const audit = await auditsFor(res.body.id, 'ration.created');
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        actorId: farmer.user.id,
        newValue: {
          name: 'Semirtirish 1-bosqich',
          items: [
            { inventoryItemId: beda.id, dailyPerAnimal: '2.500' },
            { inventoryItemId: arpa.id, dailyPerAnimal: '8.000' },
          ],
        },
      });
      // Saving a ration never changes stock.
      expect(
        await testApp.prisma.stockMovement.count({
          where: { itemId: { in: [arpa.id, beda.id] } },
        }),
      ).toBe(0);
      const stored = await testApp.prisma.inventoryItem.findUniqueOrThrow({
        where: { id: arpa.id },
      });
      expect(stored.quantity.toFixed(3)).toBe('1250.000');
    });

    it('accepts the COW profile with a state and a milk yield', async () => {
      const item = await feed();
      const res = await create(
        rationBody(
          farmer.farm.id,
          types.COW.id,
          [{ inventoryItemId: item.id, dailyPerAnimal: '12' }],
          {
            purpose: 'MILK',
            physiologicalState: 'LACTATING',
            milkYieldLiters: '18.5',
          },
        ),
      ).expect(201);
      expect(res.body).toMatchObject({
        purpose: 'MILK',
        physiologicalState: 'LACTATING',
        milkYieldLiters: '18.50',
      });
    });

    it.each([
      ['BULL', { physiologicalState: 'PREGNANT' }, 'physiologicalState'],
      ['BULL', { purpose: 'MILK' }, 'purpose'],
      ['RAM', { milkYieldLiters: '1.5' }, 'milkYieldLiters'],
      ['RAM', { physiologicalState: 'NORMAL' }, 'physiologicalState'],
      ['EWE', { physiologicalState: 'DRY' }, 'physiologicalState'],
      ['EWE', { purpose: 'MILK' }, 'purpose'],
    ] as const)(
      '%s with %o → 422 RATION_PARAMETER_INVALID (%s)',
      async (profile, params, field) => {
        const item = await feed();
        const name = `Profil ${randomUUID()}`;
        const res = await create(
          rationBody(
            farmer.farm.id,
            types[profile].id,
            [{ inventoryItemId: item.id, dailyPerAnimal: '1' }],
            { purpose: 'MAINTENANCE', ...params, name },
          ),
        ).expect(422);
        expect(res.body).toMatchObject({
          code: 'RATION_PARAMETER_INVALID',
          details: { field },
        });
        expect(await testApp.prisma.ration.count({ where: { name } })).toBe(0);
      },
    );

    it('refuses a duplicate feed (400 RATION_ITEM_DUPLICATE)', async () => {
      const item = await feed();
      const res = await create(
        rationBody(farmer.farm.id, types.BULL.id, [
          { inventoryItemId: item.id, dailyPerAnimal: '1' },
          { inventoryItemId: item.id, dailyPerAnimal: '2' },
        ]),
      ).expect(400);
      expect(res.body).toMatchObject({
        code: 'RATION_ITEM_DUPLICATE',
        details: { inventoryItemId: item.id },
      });
    });

    it('refuses non-FEED, other farm, archived and unknown items (422)', async () => {
      const ok = await feed();
      const tool = await createFeed(testApp, farmer.farm.id, '5', {
        category: InventoryCategory.EQUIPMENT,
      });
      const otherFarm = await createFarm(testApp.prisma, {
        ownerId: farmer.user.id,
      });
      const elsewhere = await createFeed(testApp, otherFarm.id);
      const victim = await createFarmer(testApp);
      const theirs = await createFeed(testApp, victim.farm.id);
      const archived = await feed();
      await testApp.prisma.inventoryItem.update({
        where: { id: archived.id },
        data: { archivedAt: new Date() },
      });
      for (const badId of [
        tool.id,
        elsewhere.id,
        theirs.id,
        archived.id,
        randomUUID(),
      ]) {
        const res = await create(
          rationBody(farmer.farm.id, types.BULL.id, [
            { inventoryItemId: ok.id, dailyPerAnimal: '1' },
            { inventoryItemId: badId, dailyPerAnimal: '1' },
          ]),
        ).expect(422);
        expect(res.body).toMatchObject({
          code: 'RATION_ITEM_INVALID',
          details: { inventoryItemId: badId },
        });
      }
    });

    it('refuses another farm’s or an archived animal type (422)', async () => {
      const item = await feed();
      const victim = await createFarmer(testApp);
      const theirTypes = await defaultTypes(testApp, victim);
      const custom = await testApp
        .http()
        .post(ANIMAL_TYPES)
        .set(farmer.auth.authHeader)
        .send({ farmId: farmer.farm.id, name: 'Eski', species: 'CATTLE' })
        .expect(201);
      await testApp
        .http()
        .post(`${ANIMAL_TYPES}/${custom.body.id}/archive`)
        .set(farmer.auth.authHeader)
        .expect(200);
      for (const typeId of [
        theirTypes.BULL.id,
        (custom.body as AnimalTypeBody).id,
        randomUUID(),
      ]) {
        const res = await create(
          rationBody(farmer.farm.id, typeId, [
            { inventoryItemId: item.id, dailyPerAnimal: '1' },
          ]),
        ).expect(422);
        expect(res.body.code).toBe('RATION_ANIMAL_TYPE_INVALID');
      }
    });

    it('404s for another farmer’s, an unknown or an archived farm', async () => {
      const item = await feed();
      const victim = await createFarmer(testApp);
      const archivedFarm = await createFarm(testApp.prisma, {
        ownerId: farmer.user.id,
      });
      await testApp.prisma.farm.update({
        where: { id: archivedFarm.id },
        data: { archivedAt: new Date() },
      });
      for (const farmId of [victim.farm.id, randomUUID(), archivedFarm.id]) {
        const res = await create(
          rationBody(farmId, types.BULL.id, [
            { inventoryItemId: item.id, dailyPerAnimal: '1' },
          ]),
        ).expect(404);
        expect(res.body.code).toBe('NOT_FOUND');
      }
    });

    it.each([
      { animalCount: 0 },
      { animalCount: '10' },
      { days: 3651 },
      { averageWeightKg: 450 },
      { milkYieldLiters: '1.234' },
      { items: [] },
      { name: '' },
      { quantity: '5' },
    ])('validates %o (400)', async (overrides) => {
      const item = await feed();
      await create(
        rationBody(
          farmer.farm.id,
          types.BULL.id,
          [{ inventoryItemId: item.id, dailyPerAnimal: '1' }],
          overrides,
        ),
      ).expect(400);
    });
  });

  describe('GET /rations and /rations/:id', () => {
    let owner: Farmer;
    let ownerTypes: Types;
    let secondFarmId: string;
    const ids: Record<string, string> = {};

    beforeAll(async () => {
      owner = await createFarmer(testApp);
      ownerTypes = await defaultTypes(testApp, owner);
      secondFarmId = (
        await createFarm(testApp.prisma, { ownerId: owner.user.id })
      ).id;
      const secondTypes = await testApp
        .http()
        .get(ANIMAL_TYPES)
        .query({ farmId: secondFarmId })
        .set(owner.auth.authHeader)
        .expect(200);
      const secondBull = (secondTypes.body as AnimalTypeBody[])[0];
      const item = await createFeed(testApp, owner.farm.id);
      const item2 = await createFeed(testApp, secondFarmId);
      const make = async (
        name: string,
        typeId: string,
        farmId = owner.farm.id,
        itemId = item.id,
        overrides: Record<string, unknown> = {},
      ) => {
        const res = await postRation(
          testApp,
          owner.auth,
          rationBody(
            farmId,
            typeId,
            [{ inventoryItemId: itemId, dailyPerAnimal: '1' }],
            { name, purpose: 'MAINTENANCE', ...overrides },
          ),
        ).expect(201);
        ids[name] = res.body.id;
      };
      await make('B ratsion', ownerTypes.BULL.id);
      await make('A ratsion', ownerTypes.COW.id);
      await make('C ratsion', secondBull.id, secondFarmId, item2.id);
      await make('D arxiv', ownerTypes.BULL.id);
      await archive(ids['D arxiv'], owner).expect(200);
    });

    const list = (query: Record<string, string>) =>
      testApp.http().get(RATIONS).query(query).set(owner.auth.authHeader);
    const names = (body: { items: RationBody[] }) =>
      body.items.map((r) => r.name);

    it('paginates own non-archived rations, newest update first by default', async () => {
      const res = await list({}).expect(200);
      expect(res.body).toMatchObject({ page: 1, limit: 20, total: 3 });
      expect(names(res.body)).toEqual(['C ratsion', 'A ratsion', 'B ratsion']);
      const page = await list({ sort: 'name', limit: '2', page: '2' }).expect(
        200,
      );
      expect(names(page.body)).toEqual(['C ratsion']);
    });

    it('filters by farm, animal type and archived state', async () => {
      expect(names((await list({ farmId: secondFarmId })).body)).toEqual([
        'C ratsion',
      ]);
      expect(
        names(
          (await list({ animalTypeId: ownerTypes.BULL.id, sort: 'name' })).body,
        ),
      ).toEqual(['B ratsion']);
      const all = await list({ includeArchived: 'true', sort: '-name' });
      expect(names(all.body)).toEqual([
        'D arxiv',
        'C ratsion',
        'B ratsion',
        'A ratsion',
      ]);
    });

    it('never lists another farmer’s rations', async () => {
      const res = await testApp
        .http()
        .get(RATIONS)
        .query({ farmId: owner.farm.id })
        .set(farmer.auth.authHeader)
        .expect(200);
      expect(res.body.total).toBe(0);
    });

    it('reads one ration (archived too); others’ and unknown ids are 404', async () => {
      const res = await testApp
        .http()
        .get(rationUrl(ids['D arxiv']))
        .set(owner.auth.authHeader)
        .expect(200);
      expect(res.body).toMatchObject({
        name: 'D arxiv',
        archivedAt: expect.any(String),
      });
      for (const id of [ids['A ratsion'], randomUUID()]) {
        await testApp
          .http()
          .get(rationUrl(id))
          .set(farmer.auth.authHeader)
          .expect(404);
      }
      await testApp
        .http()
        .get(rationUrl('not-a-uuid'))
        .set(owner.auth.authHeader)
        .expect(400);
    });

    it.each<Record<string, string>>([
      { sort: 'days' },
      { limit: '101' },
      { includeArchived: '1' },
      { farmId: 'x' },
      { animalTypeId: 'x' },
    ])('rejects query %o (400)', async (query) => {
      await list(query).expect(400);
    });
  });

  describe('PATCH /rations/:id', () => {
    it('updates fields and replaces the whole feed list', async () => {
      const { ration, a, b } = await bullRation({
        averageWeightKg: '400',
        notes: 'Eski izoh',
      });
      const c = await feed();
      const res = await patch(ration.id, {
        name: 'Yangi nom',
        animalCount: 12,
        averageWeightKg: null,
        notes: null,
        days: 45,
        items: [
          { inventoryItemId: c.id, dailyPerAnimal: '3' },
          { inventoryItemId: a.id, dailyPerAnimal: '9.125' },
        ],
      }).expect(200);
      expect(res.body).toMatchObject({
        name: 'Yangi nom',
        animalCount: 12,
        averageWeightKg: null,
        notes: null,
        days: 45,
      });
      expect(
        (res.body as RationBody).items.map((i) => [
          i.inventoryItemId,
          i.dailyPerAnimal,
        ]),
      ).toEqual([
        [c.id, '3.000'],
        [a.id, '9.125'],
      ]);
      expect(
        await testApp.prisma.rationItem.count({
          where: { rationId: ration.id, inventoryItemId: b.id },
        }),
      ).toBe(0);

      const [audit] = await auditsFor(ration.id, 'ration.updated');
      expect(audit).toMatchObject({
        oldValue: { name: ration.name, averageWeightKg: '400.00' },
        newValue: { name: 'Yangi nom', averageWeightKg: null },
      });
    });

    it('keeps the items when they are not sent', async () => {
      const { ration } = await bullRation();
      const res = await patch(ration.id, { name: 'Faqat nom' }).expect(200);
      expect(res.body.items).toEqual(ration.items);
    });

    it('re-validates the merged parameters against the new type', async () => {
      const item = await feed();
      const cow = await create(
        rationBody(
          farmer.farm.id,
          types.COW.id,
          [{ inventoryItemId: item.id, dailyPerAnimal: '1' }],
          {
            purpose: 'MAINTENANCE',
            physiologicalState: 'PREGNANT',
            milkYieldLiters: '5',
          },
        ),
      ).expect(201);
      const res = await patch(cow.body.id, {
        animalTypeId: types.BULL.id,
      }).expect(422);
      expect(res.body).toMatchObject({
        code: 'RATION_PARAMETER_INVALID',
        details: { field: 'physiologicalState' },
      });
      const milk = await patch(cow.body.id, {
        animalTypeId: types.BULL.id,
        physiologicalState: null,
      }).expect(422);
      expect(milk.body.details).toEqual({ field: 'milkYieldLiters' });
      const ok = await patch(cow.body.id, {
        animalTypeId: types.BULL.id,
        physiologicalState: null,
        milkYieldLiters: null,
      }).expect(200);
      expect(ok.body.animalType.profile).toBe('BULL');
    });

    it('applies the item rules to a replaced list', async () => {
      const { ration, a } = await bullRation();
      const dup = await patch(ration.id, {
        items: [
          { inventoryItemId: a.id, dailyPerAnimal: '1' },
          { inventoryItemId: a.id, dailyPerAnimal: '1' },
        ],
      }).expect(400);
      expect(dup.body.code).toBe('RATION_ITEM_DUPLICATE');
      const unknown = randomUUID();
      const bad = await patch(ration.id, {
        items: [{ inventoryItemId: unknown, dailyPerAnimal: '1' }],
      }).expect(422);
      expect(bad.body).toMatchObject({
        code: 'RATION_ITEM_INVALID',
        details: { inventoryItemId: unknown },
      });
      // Nothing changed.
      const stored = await testApp
        .http()
        .get(rationUrl(ration.id))
        .set(farmer.auth.authHeader)
        .expect(200);
      expect(stored.body.items).toEqual(ration.items);
    });

    it('refuses an archived ration (409) and others’ rations (404)', async () => {
      const { ration } = await bullRation();
      const victim = await createFarmer(testApp);
      await patch(ration.id, { name: 'X' }, victim).expect(404);
      await archive(ration.id).expect(200);
      const res = await patch(ration.id, { name: 'X' }).expect(409);
      expect(res.body.code).toBe('RATION_ARCHIVED');
      await patch(ration.id, { farmId: farmer.farm.id }).expect(400);
    });
  });

  describe('POST /rations/:id/copy', () => {
    it('copies parameters and feeds under "<name> (nusxa)"', async () => {
      const { ration } = await bullRation({
        averageWeightKg: '420.5',
        ageMonths: 14,
        notes: 'Izoh',
      });
      const res = await copy(ration.id).expect(201);
      expect(res.body.id).not.toBe(ration.id);
      expect(res.body).toMatchObject({
        name: `${ration.name} (nusxa)`,
        animalTypeId: types.BULL.id,
        animalCount: 10,
        averageWeightKg: '420.50',
        ageMonths: 14,
        purpose: 'FATTENING',
        days: 30,
        notes: 'Izoh',
        lastIssue: null,
        archivedAt: null,
      });
      expect(res.body.items).toEqual(ration.items);
      const [audit] = await auditsFor(res.body.id, 'ration.created');
      expect(audit.newValue).toMatchObject({ copiedFromId: ration.id });

      const named = await copy(ration.id, { name: 'Boshqa nom' }).expect(201);
      expect(named.body.name).toBe('Boshqa nom');
    });

    it('cuts the default name to 100 characters', async () => {
      const { ration } = await bullRation({ name: 'x'.repeat(96) });
      const res = await copy(ration.id, {}).expect(201);
      expect(res.body.name).toBe(`${'x'.repeat(96)} (nu`);
      const { ration: full } = await bullRation({ name: 'y'.repeat(100) });
      expect((await copy(full.id).expect(201)).body.name).toBe('y'.repeat(100));
    });

    it('skips archived feeds; none left → 422 RATION_ITEM_INVALID', async () => {
      const { ration, a, b } = await bullRation();
      await testApp.prisma.inventoryItem.update({
        where: { id: a.id },
        data: { archivedAt: new Date() },
      });
      const res = await copy(ration.id).expect(201);
      expect(
        (res.body as RationBody).items.map((i) => [
          i.inventoryItemId,
          (i as { position?: number }).position,
        ]),
      ).toEqual([[b.id, 0]]);

      await testApp.prisma.inventoryItem.update({
        where: { id: b.id },
        data: { archivedAt: new Date() },
      });
      const before = await testApp.prisma.ration.count({
        where: { farmId: farmer.farm.id },
      });
      const none = await copy(ration.id).expect(422);
      expect(none.body.code).toBe('RATION_ITEM_INVALID');
      expect(
        await testApp.prisma.ration.count({
          where: { farmId: farmer.farm.id },
        }),
      ).toBe(before);
    });

    it('refuses an archived source (409) and others’ rations (404)', async () => {
      const { ration } = await bullRation();
      const victim = await createFarmer(testApp);
      await copy(ration.id, {}, victim).expect(404);
      await archive(ration.id).expect(200);
      const res = await copy(ration.id).expect(409);
      expect(res.body.code).toBe('RATION_ARCHIVED');
      await copy(ration.id, { name: '' }).expect(400);
    });
  });

  describe('POST /rations/:id/archive', () => {
    it('soft-deletes once, with an audit row', async () => {
      const { ration } = await bullRation();
      const res = await archive(ration.id).expect(200);
      expect(res.body).toMatchObject({
        id: ration.id,
        archivedAt: expect.any(String),
      });
      expect(await auditsFor(ration.id, 'ration.archived')).toHaveLength(1);
      const again = await archive(ration.id).expect(409);
      expect(again.body.code).toBe('RATION_ARCHIVED');
      const listed = await testApp
        .http()
        .get(RATIONS)
        .query({ farmId: farmer.farm.id, limit: '100' })
        .set(farmer.auth.authHeader)
        .expect(200);
      expect(
        (listed.body.items as RationBody[]).some((r) => r.id === ration.id),
      ).toBe(false);
    });

    it('404s for another farmer’s or an unknown ration', async () => {
      const { ration } = await bullRation();
      const victim = await createFarmer(testApp);
      for (const id of [ration.id, randomUUID()]) {
        await archive(id, victim).expect(404);
      }
      expect(
        await testApp.prisma.ration.findUniqueOrThrow({
          where: { id: ration.id },
        }),
      ).toMatchObject({ archivedAt: null });
    });
  });
});
