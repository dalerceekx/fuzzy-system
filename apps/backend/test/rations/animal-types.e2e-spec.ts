import { randomUUID } from 'node:crypto';
import { UserRole } from '../../src/generated/prisma/enums.js';
import { createFarmer, type Farmer } from '../inventory/inventory-helpers.js';
import { createTestApp, type TestApp } from '../utils/app.js';
import { loginAs } from '../utils/auth.js';
import { createFarm, createUser } from '../utils/factories.js';
import {
  ANIMAL_TYPES,
  createFeed,
  defaultTypes,
  postRation,
  rationBody,
  rationUrl,
  type AnimalTypeBody,
} from './rations-helpers.js';

describe('Ration animal types', () => {
  let testApp: TestApp;
  let farmer: Farmer;

  beforeAll(async () => {
    testApp = await createTestApp({ features: ['rations'] });
    farmer = await createFarmer(testApp);
  });

  afterAll(async () => {
    await testApp.close();
  });

  const list = (who: Farmer, query: Record<string, string>) =>
    testApp.http().get(ANIMAL_TYPES).query(query).set(who.auth.authHeader);
  const create = (who: Farmer, body: object) =>
    testApp.http().post(ANIMAL_TYPES).set(who.auth.authHeader).send(body);
  const archive = (who: Farmer, id: string) =>
    testApp
      .http()
      .post(`${ANIMAL_TYPES}/${id}/archive`)
      .set(who.auth.authHeader);
  const defaultCount = (farmId: string) =>
    testApp.prisma.rationAnimalType.count({
      where: { farmId, isDefault: true },
    });

  describe('GET /rations/animal-types', () => {
    it('creates the four defaults on first listing, in order', async () => {
      const fresh = await createFarmer(testApp);
      expect(await defaultCount(fresh.farm.id)).toBe(0);
      const res = await list(fresh, { farmId: fresh.farm.id }).expect(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(
        (res.body as AnimalTypeBody[]).map((t) => [
          t.name,
          t.profile,
          t.species,
          t.sex,
          t.isDefault,
        ]),
      ).toEqual([
        ['Buqa', 'BULL', 'CATTLE', 'MALE', true],
        ['Sigir', 'COW', 'CATTLE', 'FEMALE', true],
        ['Qo‘chqor', 'RAM', 'SHEEP', 'MALE', true],
        ['Qo‘y', 'EWE', 'SHEEP', 'FEMALE', true],
      ]);
      expect(res.body[0]).toEqual({
        id: expect.any(String),
        farmId: fresh.farm.id,
        name: 'Buqa',
        profile: 'BULL',
        species: 'CATTLE',
        sex: 'MALE',
        isDefault: true,
        archivedAt: null,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
    });

    it('never duplicates the defaults (repeated and concurrent listings)', async () => {
      const fresh = await createFarmer(testApp);
      const results = await Promise.all(
        [1, 2, 3, 4].map(() => list(fresh, { farmId: fresh.farm.id })),
      );
      for (const res of results) {
        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(4);
      }
      const again = await list(fresh, { farmId: fresh.farm.id }).expect(200);
      expect(again.body).toHaveLength(4);
      expect((again.body as AnimalTypeBody[]).map((t) => t.id).sort()).toEqual(
        (results[0].body as AnimalTypeBody[]).map((t) => t.id).sort(),
      );
      expect(await defaultCount(fresh.farm.id)).toBe(4);
    });

    it('lists custom types after the defaults, by name', async () => {
      const fresh = await createFarmer(testApp);
      for (const name of ['Tana', 'Buzoq', 'Echki']) {
        await create(fresh, {
          farmId: fresh.farm.id,
          name,
          species: 'CATTLE',
        }).expect(201);
      }
      const res = await list(fresh, { farmId: fresh.farm.id }).expect(200);
      expect((res.body as AnimalTypeBody[]).map((t) => t.name)).toEqual([
        'Buqa',
        'Sigir',
        'Qo‘chqor',
        'Qo‘y',
        'Buzoq',
        'Echki',
        'Tana',
      ]);
    });

    it('lists an archived farm without creating defaults', async () => {
      const fresh = await createFarmer(testApp);
      await testApp.prisma.farm.update({
        where: { id: fresh.farm.id },
        data: { archivedAt: new Date() },
      });
      const res = await list(fresh, { farmId: fresh.farm.id }).expect(200);
      expect(res.body).toEqual([]);
      expect(await defaultCount(fresh.farm.id)).toBe(0);
    });

    it('404s for another farmer’s or an unknown farm, creating nothing', async () => {
      const victim = await createFarmer(testApp);
      const res = await list(farmer, { farmId: victim.farm.id }).expect(404);
      expect(res.body.code).toBe('NOT_FOUND');
      expect(await defaultCount(victim.farm.id)).toBe(0);
      await list(farmer, { farmId: randomUUID() }).expect(404);
    });

    it.each([
      {},
      { farmId: 'x' },
      { farmId: randomUUID(), includeArchived: 'yes' },
      { farmId: randomUUID(), page: '1' },
    ])('rejects query %o (400)', async (query) => {
      await list(farmer, query as Record<string, string>).expect(400);
    });
  });

  describe('POST /rations/animal-types', () => {
    it('creates a custom type (default profile OTHER, any sex) with an audit row', async () => {
      const res = await create(farmer, {
        farmId: farmer.farm.id,
        name: '  Buzoqlar  ',
        species: 'CATTLE',
      }).expect(201);
      expect(res.body).toMatchObject({
        farmId: farmer.farm.id,
        name: 'Buzoqlar',
        profile: 'OTHER',
        species: 'CATTLE',
        sex: null,
        isDefault: false,
        archivedAt: null,
      });
      const audit = await testApp.prisma.auditLog.findMany({
        where: {
          resourceId: res.body.id,
          action: 'ration.animal_type.created',
        },
      });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        actorId: farmer.user.id,
        resourceType: 'ration_animal_type',
      });
    });

    it('accepts a profile and a sex', async () => {
      const res = await create(farmer, {
        farmId: farmer.farm.id,
        name: 'Sog‘in sigirlar',
        species: 'CATTLE',
        profile: 'COW',
        sex: 'FEMALE',
      }).expect(201);
      expect(res.body).toMatchObject({
        profile: 'COW',
        sex: 'FEMALE',
        isDefault: false,
      });
    });

    it('refuses a duplicate name case-insensitively, defaults included (409)', async () => {
      const fresh = await createFarmer(testApp);
      // Defaults not listed yet: creation ensures them first.
      const asDefault = await create(fresh, {
        farmId: fresh.farm.id,
        name: 'BUQA',
        species: 'CATTLE',
      }).expect(409);
      expect(asDefault.body.code).toBe('RATION_ANIMAL_TYPE_EXISTS');
      await create(fresh, {
        farmId: fresh.farm.id,
        name: 'Tana',
        species: 'CATTLE',
      }).expect(201);
      const dup = await create(fresh, {
        farmId: fresh.farm.id,
        name: 'tANA',
        species: 'SHEEP',
      }).expect(409);
      expect(dup.body.code).toBe('RATION_ANIMAL_TYPE_EXISTS');
      // Another farm may use the same name.
      const other = await createFarm(testApp.prisma, {
        ownerId: fresh.user.id,
      });
      await create(fresh, {
        farmId: other.id,
        name: 'Tana',
        species: 'CATTLE',
      }).expect(201);
    });

    it('404s for another farmer’s, an unknown or an archived farm', async () => {
      const victim = await createFarmer(testApp);
      for (const farmId of [victim.farm.id, randomUUID()]) {
        await create(farmer, { farmId, name: 'X', species: 'CATTLE' }).expect(
          404,
        );
      }
      const archived = await createFarm(testApp.prisma, {
        ownerId: farmer.user.id,
      });
      await testApp.prisma.farm.update({
        where: { id: archived.id },
        data: { archivedAt: new Date() },
      });
      await create(farmer, {
        farmId: archived.id,
        name: 'X',
        species: 'CATTLE',
      }).expect(404);
      expect(
        await testApp.prisma.rationAnimalType.count({
          where: { farmId: { in: [victim.farm.id, archived.id] } },
        }),
      ).toBe(0);
    });

    it.each([
      { name: '' },
      { name: 'x'.repeat(61) },
      { species: 'DRAGON' },
      { profile: 'CALF' },
      { sex: 'UNKNOWN' },
      { isDefault: true },
    ])('validates %o (400)', async (patch) => {
      await create(farmer, {
        farmId: farmer.farm.id,
        name: `T ${randomUUID().slice(0, 6)}`,
        species: 'CATTLE',
        ...patch,
      }).expect(400);
    });
  });

  describe('POST /rations/animal-types/:id/archive', () => {
    it('archives a custom type once; its name becomes free again', async () => {
      const fresh = await createFarmer(testApp);
      const type = await create(fresh, {
        farmId: fresh.farm.id,
        name: 'Qo‘zilar',
        species: 'SHEEP',
      }).expect(201);
      const res = await archive(fresh, type.body.id).expect(200);
      expect(res.body.archivedAt).toEqual(expect.any(String));
      const audit = await testApp.prisma.auditLog.findMany({
        where: {
          resourceId: type.body.id,
          action: 'ration.animal_type.archived',
        },
      });
      expect(audit).toHaveLength(1);

      const again = await archive(fresh, type.body.id).expect(409);
      expect(again.body.code).toBe('RATION_ANIMAL_TYPE_ARCHIVED');

      const listed = await list(fresh, { farmId: fresh.farm.id }).expect(200);
      expect(
        (listed.body as AnimalTypeBody[]).some((t) => t.id === type.body.id),
      ).toBe(false);
      const withArchived = await list(fresh, {
        farmId: fresh.farm.id,
        includeArchived: 'true',
      }).expect(200);
      expect(
        (withArchived.body as AnimalTypeBody[]).find(
          (t) => t.id === type.body.id,
        ),
      ).toMatchObject({ archivedAt: expect.any(String) });

      await create(fresh, {
        farmId: fresh.farm.id,
        name: 'qo‘zilar',
        species: 'SHEEP',
      }).expect(201);
    });

    it('refuses to archive a default type (409)', async () => {
      const types = await defaultTypes(testApp, farmer);
      const res = await archive(farmer, types.COW.id).expect(409);
      expect(res.body.code).toBe('RATION_ANIMAL_TYPE_DEFAULT');
    });

    it('refuses a type used by an active ration until it is archived', async () => {
      const type = await create(farmer, {
        farmId: farmer.farm.id,
        name: `Band ${randomUUID().slice(0, 6)}`,
        species: 'GOAT',
      }).expect(201);
      const feed = await createFeed(testApp, farmer.farm.id);
      const ration = await postRation(
        testApp,
        farmer.auth,
        rationBody(farmer.farm.id, type.body.id, [
          { inventoryItemId: feed.id, dailyPerAnimal: '1' },
        ]),
      ).expect(201);

      const res = await archive(farmer, type.body.id).expect(409);
      expect(res.body).toMatchObject({
        code: 'RATION_ANIMAL_TYPE_IN_USE',
        details: { rations: 1 },
      });

      await testApp
        .http()
        .post(`${rationUrl(ration.body.id)}/archive`)
        .set(farmer.auth.authHeader)
        .expect(200);
      await archive(farmer, type.body.id).expect(200);
    });

    it('404s for another farmer’s or an unknown type; 400 for a bad id', async () => {
      const victim = await createFarmer(testApp);
      const theirs = await defaultTypes(testApp, victim);
      const custom = await create(victim, {
        farmId: victim.farm.id,
        name: 'Ularniki',
        species: 'CATTLE',
      }).expect(201);
      for (const id of [theirs.BULL.id, custom.body.id, randomUUID()]) {
        const res = await archive(farmer, id).expect(404);
        expect(res.body.code).toBe('NOT_FOUND');
      }
      expect(
        await testApp.prisma.rationAnimalType.findUniqueOrThrow({
          where: { id: custom.body.id },
        }),
      ).toMatchObject({ archivedAt: null });
      await archive(farmer, 'not-a-uuid').expect(400);
    });
  });

  describe('roles', () => {
    it.each([UserRole.VET, UserRole.SUPPORT, UserRole.ADMIN])(
      '%s cannot use ration routes (403)',
      async (role) => {
        const { user } = await createUser(testApp.prisma, { role });
        const auth = await loginAs(testApp, user);
        await testApp
          .http()
          .get(ANIMAL_TYPES)
          .query({ farmId: farmer.farm.id })
          .set(auth.authHeader)
          .expect(403);
        await testApp
          .http()
          .get('/api/v1/rations/profiles')
          .set(auth.authHeader)
          .expect(403);
      },
    );

    it('anonymous callers get 401', async () => {
      await testApp.http().get('/api/v1/rations/profiles').expect(401);
    });
  });
});
