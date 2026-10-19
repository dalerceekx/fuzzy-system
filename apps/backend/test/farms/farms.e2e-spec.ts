import { randomUUID } from 'node:crypto';
import {
  InventoryCategory,
  UserRole,
} from '../../src/generated/prisma/enums.js';
import { createTestApp, type TestApp } from '../utils/app.js';
import {
  createAnimal,
  createFarm,
  createInventoryItem,
  uniqueSuffix,
} from '../utils/factories.js';
import { actor, farmRow, whileLocked, type Actor } from './support.js';

describe('Farms API', () => {
  let testApp: TestApp;
  let farmer: Actor;

  beforeAll(async () => {
    testApp = await createTestApp({ features: ['farms', 'animals'] });
    farmer = await actor(testApp);
  });

  afterAll(async () => {
    await testApp.close();
  });

  const http = () => testApp.http();

  describe('authorization', () => {
    it('requires authentication', async () => {
      await http().get('/api/v1/farms').expect(401);
      await http().post('/api/v1/farms').send({ name: 'X' }).expect(401);
    });

    it.each([UserRole.VET, UserRole.SUPPORT, UserRole.ADMIN])(
      'denies %s (farmer-only routes)',
      async (role) => {
        const staff = await actor(testApp, role);
        const res = await http()
          .get('/api/v1/farms')
          .set(staff.auth)
          .expect(403);
        expect(res.body.code).toBe('FORBIDDEN');
        await http()
          .post('/api/v1/farms')
          .set(staff.auth)
          .send({ name: 'Staff ferma' })
          .expect(403);
      },
    );
  });

  describe('POST /farms', () => {
    it('creates a farm owned by the caller with sanitized text', async () => {
      const res = await http()
        .post('/api/v1/farms')
        .set(farmer.auth)
        .send({ name: '  Yangi\u0007 ferma  ', region: ' Samarqand ' })
        .expect(201);
      expect(res.body).toStrictEqual({
        id: expect.any(String),
        name: 'Yangi ferma',
        region: 'Samarqand',
        archivedAt: null,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
      const row = await farmRow(testApp, res.body.id);
      expect(row?.ownerId).toBe(farmer.id);
    });

    it('strips invisible format characters (bidi overrides, zero-width)', async () => {
      const res = await http()
        .post('/api/v1/farms')
        .set(farmer.auth)
        .send({ name: '\u202EOq\u200Bsoy', region: '\uFEFFJizzax\u200F' })
        .expect(201);
      expect(res.body).toMatchObject({ name: 'Oqsoy', region: 'Jizzax' });
    });

    it('creates a farm without a region', async () => {
      const res = await http()
        .post('/api/v1/farms')
        .set(farmer.auth)
        .send({ name: 'Regionsiz' })
        .expect(201);
      expect(res.body.region).toBeNull();
    });

    it.each([
      ['missing name', {}],
      ['blank name', { name: '   ' }],
      ['null name', { name: null }],
      ['numeric name', { name: 42 }],
      ['too long name', { name: 'x'.repeat(101) }],
      ['null region', { name: 'Ferma', region: null }],
      ['too long region', { name: 'Ferma', region: 'r'.repeat(101) }],
      ['array name', { name: ['a'] }],
      ['zero-width-only name', { name: '\u200B\u200D\uFEFF' }],
      ['bidi-control-only region', { name: 'Ferma', region: '\u202E\u2066' }],
    ])('rejects %s with 400', async (_label, body) => {
      const res = await http()
        .post('/api/v1/farms')
        .set(farmer.auth)
        .send(body)
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });

    it('accepts names at the maximum length', async () => {
      await http()
        .post('/api/v1/farms')
        .set(farmer.auth)
        .send({ name: 'x'.repeat(100), region: 'r'.repeat(100) })
        .expect(201);
    });

    it.each(['ownerId', 'archivedAt', 'id'])(
      'rejects the unknown field %s (no owner injection)',
      async (field) => {
        const other = await actor(testApp);
        const name = `Injected ${uniqueSuffix()}`;
        const res = await http()
          .post('/api/v1/farms')
          .set(farmer.auth)
          .send({
            name,
            [field]: field === 'archivedAt' ? new Date() : other.id,
          })
          .expect(400);
        expect(res.body.message).toEqual(['Ruxsat etilmagan maydon yuborildi']);
        expect(
          await testApp.prisma.farm.count({
            where: { name, ownerId: { in: [farmer.id, other.id] } },
          }),
        ).toBe(0);
      },
    );
  });

  describe('GET /farms', () => {
    let owner: Actor;
    let ids: Record<string, string>;

    beforeAll(async () => {
      owner = await actor(testApp);
      const [b, a, c, archived] = await Promise.all(
        ['Bravo', 'Alfa', 'Charli', 'Arxiv'].map((name) =>
          createFarm(testApp.prisma, { ownerId: owner.id, name }),
        ),
      );
      await testApp.prisma.farm.update({
        where: { id: archived.id },
        data: { archivedAt: new Date() },
      });
      ids = { a: a.id, b: b.id, c: c.id, archived: archived.id };
    });

    it('paginates with defaults and hides archived farms', async () => {
      const res = await http().get('/api/v1/farms').set(owner.auth).expect(200);
      expect(res.body).toMatchObject({ page: 1, limit: 20, total: 3 });
      expect(res.body.items.map((f: { id: string }) => f.id).sort()).toEqual(
        [ids.a, ids.b, ids.c].sort(),
      );
    });

    it('includes archived farms on request', async () => {
      const res = await http()
        .get('/api/v1/farms?includeArchived=true')
        .set(owner.auth)
        .expect(200);
      expect(res.body.total).toBe(4);
      expect(res.body.items.map((f: { id: string }) => f.id)).toContain(
        ids.archived,
      );
    });

    it('sorts by an allowlisted field in both directions', async () => {
      const asc = await http()
        .get('/api/v1/farms?sort=name')
        .set(owner.auth)
        .expect(200);
      expect(asc.body.items.map((f: { name: string }) => f.name)).toEqual([
        'Alfa',
        'Bravo',
        'Charli',
      ]);
      const desc = await http()
        .get('/api/v1/farms?sort=-name&limit=2&page=1')
        .set(owner.auth)
        .expect(200);
      expect(desc.body).toMatchObject({ page: 1, limit: 2, total: 3 });
      expect(desc.body.items.map((f: { name: string }) => f.name)).toEqual([
        'Charli',
        'Bravo',
      ]);
      const page2 = await http()
        .get('/api/v1/farms?sort=-name&limit=2&page=2')
        .set(owner.auth)
        .expect(200);
      expect(page2.body.items.map((f: { name: string }) => f.name)).toEqual([
        'Alfa',
      ]);
    });

    it.each([
      'sort=ownerId',
      'sort=name;DROP',
      'sort[name]=asc',
      'limit=101',
      'limit=0',
      'page=0',
      'page=abc',
      'includeArchived=yes',
      'includeArchived=1',
      'ownerId=00000000-0000-4000-8000-000000000000',
    ])('rejects the query %s with 400', async (query) => {
      await http().get(`/api/v1/farms?${query}`).set(owner.auth).expect(400);
    });
  });

  describe('GET /farms/:id', () => {
    it('returns an own farm, including an archived one', async () => {
      const farm = await createFarm(testApp.prisma, {
        ownerId: farmer.id,
        region: 'Buxoro',
      });
      const res = await http()
        .get(`/api/v1/farms/${farm.id}`)
        .set(farmer.auth)
        .expect(200);
      expect(res.body).toMatchObject({
        id: farm.id,
        name: farm.name,
        region: 'Buxoro',
      });
      expect(res.body).not.toHaveProperty('ownerId');
    });

    it('returns 404 for an unknown id and 400 for a malformed one', async () => {
      const missing = await http()
        .get(`/api/v1/farms/${randomUUID()}`)
        .set(farmer.auth)
        .expect(404);
      expect(missing.body).toMatchObject({
        code: 'NOT_FOUND',
        message: 'Topilmadi',
      });
      const bad = await http()
        .get('/api/v1/farms/not-a-uuid')
        .set(farmer.auth)
        .expect(400);
      expect(bad.body.code).toBe('INVALID_ID');
    });
  });

  describe('PATCH /farms/:id', () => {
    it('updates name and clears the region with null', async () => {
      const farm = await createFarm(testApp.prisma, {
        ownerId: farmer.id,
        region: 'Xorazm',
      });
      const res = await http()
        .patch(`/api/v1/farms/${farm.id}`)
        .set(farmer.auth)
        .send({ name: ' Yangi nom ', region: null })
        .expect(200);
      expect(res.body).toMatchObject({ name: 'Yangi nom', region: null });
      const kept = await http()
        .patch(`/api/v1/farms/${farm.id}`)
        .set(farmer.auth)
        .send({ region: 'Navoiy' })
        .expect(200);
      expect(kept.body).toMatchObject({ name: 'Yangi nom', region: 'Navoiy' });
    });

    it.each([
      { name: null },
      { name: '' },
      { name: 'x'.repeat(101) },
      { region: 'r'.repeat(101) },
      { ownerId: randomUUID() },
      { archivedAt: null },
    ])('rejects %o with 400 and changes nothing', async (body) => {
      const farm = await createFarm(testApp.prisma, { ownerId: farmer.id });
      const before = await farmRow(testApp, farm.id);
      await http()
        .patch(`/api/v1/farms/${farm.id}`)
        .set(farmer.auth)
        .send(body)
        .expect(400);
      expect(await farmRow(testApp, farm.id)).toEqual(before);
    });

    it('refuses to edit an archived farm (409 FARM_ARCHIVED)', async () => {
      const farm = await createFarm(testApp.prisma, { ownerId: farmer.id });
      await testApp.prisma.farm.update({
        where: { id: farm.id },
        data: { archivedAt: new Date() },
      });
      const res = await http()
        .patch(`/api/v1/farms/${farm.id}`)
        .set(farmer.auth)
        .send({ name: 'Boshqa' })
        .expect(409);
      expect(res.body.code).toBe('FARM_ARCHIVED');
    });

    it('returns 404 for an unknown farm', async () => {
      await http()
        .patch(`/api/v1/farms/${randomUUID()}`)
        .set(farmer.auth)
        .send({ name: 'Boshqa' })
        .expect(404);
    });
  });

  describe('POST /farms/:id/archive', () => {
    it('archives an empty farm once', async () => {
      const farm = await createFarm(testApp.prisma, { ownerId: farmer.id });
      const res = await http()
        .post(`/api/v1/farms/${farm.id}/archive`)
        .set(farmer.auth)
        .expect(200);
      expect(res.body.archivedAt).toEqual(expect.any(String));
      const again = await http()
        .post(`/api/v1/farms/${farm.id}/archive`)
        .set(farmer.auth)
        .expect(409);
      expect(again.body.code).toBe('FARM_ARCHIVED');
    });

    it('refuses while the farm has active animals', async () => {
      const farm = await createFarm(testApp.prisma, { ownerId: farmer.id });
      await createAnimal(testApp.prisma, { farmId: farm.id });
      const res = await http()
        .post(`/api/v1/farms/${farm.id}/archive`)
        .set(farmer.auth)
        .expect(409);
      expect(res.body).toMatchObject({
        code: 'FARM_NOT_EMPTY',
        details: { animals: 1, inventoryItems: 0 },
      });
      expect((await farmRow(testApp, farm.id))?.archivedAt).toBeNull();
    });

    it('refuses while the farm has active inventory items', async () => {
      const farm = await createFarm(testApp.prisma, { ownerId: farmer.id });
      await createInventoryItem(testApp.prisma, {
        farmId: farm.id,
        category: InventoryCategory.FEED,
      });
      const res = await http()
        .post(`/api/v1/farms/${farm.id}/archive`)
        .set(farmer.auth)
        .expect(409);
      expect(res.body).toMatchObject({
        code: 'FARM_NOT_EMPTY',
        details: { animals: 0, inventoryItems: 1 },
      });
    });

    it('allows archiving when everything in it is archived', async () => {
      const farm = await createFarm(testApp.prisma, { ownerId: farmer.id });
      const animal = await createAnimal(testApp.prisma, { farmId: farm.id });
      const item = await createInventoryItem(testApp.prisma, {
        farmId: farm.id,
      });
      await testApp.prisma.animal.update({
        where: { id: animal.id },
        data: { archivedAt: new Date(), archivedReason: 'sotildi' },
      });
      await testApp.prisma.inventoryItem.update({
        where: { id: item.id },
        data: { archivedAt: new Date() },
      });
      await http()
        .post(`/api/v1/farms/${farm.id}/archive`)
        .set(farmer.auth)
        .expect(200);
    });

    // Deterministic interleavings: the test holds the other side's locks and
    // only commits once the request is provably blocked on them.
    it('an animal create waiting on an archive in progress gets 409 FARM_ARCHIVED', async () => {
      const farm = await createFarm(testApp.prisma, { ownerId: farmer.id });
      const create = await whileLocked(
        testApp,
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM farms WHERE id = ${farm.id}::uuid FOR UPDATE`;
          await tx.farm.update({
            where: { id: farm.id },
            data: { archivedAt: new Date() },
          });
        },
        () =>
          http()
            .post('/api/v1/animals')
            .set(farmer.auth)
            .send({ farmId: farm.id, tagNumber: 'RACE-1', species: 'SHEEP' }),
      );
      expect(create.status).toBe(409);
      expect(create.body.code).toBe('FARM_ARCHIVED');
      expect(
        await testApp.prisma.animal.count({ where: { farmId: farm.id } }),
      ).toBe(0);
    });

    it('an archive waiting on an animal create in progress gets 409 FARM_NOT_EMPTY', async () => {
      const farm = await createFarm(testApp.prisma, { ownerId: farmer.id });
      const archive = await whileLocked(
        testApp,
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM farms WHERE id = ${farm.id}::uuid FOR SHARE`;
          await tx.animal.create({
            data: { farmId: farm.id, tagNumber: 'RACE-2', species: 'SHEEP' },
          });
        },
        () => http().post(`/api/v1/farms/${farm.id}/archive`).set(farmer.auth),
      );
      expect(archive.status).toBe(409);
      expect(archive.body).toMatchObject({
        code: 'FARM_NOT_EMPTY',
        details: { animals: 1, inventoryItems: 0 },
      });
      expect((await farmRow(testApp, farm.id))?.archivedAt).toBeNull();
    });
  });
});
