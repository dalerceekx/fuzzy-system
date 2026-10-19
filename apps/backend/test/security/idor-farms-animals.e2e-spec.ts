import { randomUUID } from 'node:crypto';
import type { Test } from 'supertest';
import type { Animal, Farm } from '../../src/generated/prisma/client.js';
import { Species, UserRole } from '../../src/generated/prisma/enums.js';
import {
  actor,
  animalRow,
  errorBody,
  farmRow,
  type Actor,
} from '../farms/support.js';
import { createTestApp, type TestApp } from '../utils/app.js';
import { createAnimal, createFarm } from '../utils/factories.js';

/**
 * IDOR / ownership bypass: knowing the id of another farmer's farm or animal
 * must not give any access. Every miss is a 404 indistinguishable from a
 * random id, lists never include foreign rows, and nothing changes.
 */
describe('IDOR: farms and animals', () => {
  let testApp: TestApp;
  let alice: Actor;
  let bob: Actor;
  let aliceFarm: Farm;
  let aliceAnimal: Animal;
  let bobFarm: Farm;
  // Archived rows take the 409 paths (FARM_ARCHIVED / ANIMAL_ARCHIVED) for
  // their owner; for anyone else they must still be a plain 404.
  let aliceArchivedFarm: Farm;
  let aliceArchivedAnimal: Animal;

  beforeAll(async () => {
    testApp = await createTestApp({ features: ['farms', 'animals'] });
    alice = await actor(testApp);
    bob = await actor(testApp);
    aliceFarm = await createFarm(testApp.prisma, {
      ownerId: alice.id,
      name: 'Alice fermasi',
      region: 'Toshkent',
    });
    aliceAnimal = await createAnimal(testApp.prisma, {
      farmId: aliceFarm.id,
      tagNumber: 'ALICE-001',
      species: Species.CATTLE,
    });
    bobFarm = await createFarm(testApp.prisma, { ownerId: bob.id });
    aliceArchivedFarm = await createFarm(testApp.prisma, {
      ownerId: alice.id,
      name: 'Alice eski fermasi',
    });
    aliceArchivedAnimal = await createAnimal(testApp.prisma, {
      farmId: aliceArchivedFarm.id,
      tagNumber: 'ALICE-OLD',
    });
    await testApp.prisma.animal.update({
      where: { id: aliceArchivedAnimal.id },
      data: { archivedAt: new Date(), archivedReason: 'Alice sotdi' },
    });
    await testApp.prisma.farm.update({
      where: { id: aliceArchivedFarm.id },
      data: { archivedAt: new Date() },
    });
  });

  afterAll(async () => {
    await testApp.close();
  });

  const http = () => testApp.http();

  type Call = (id: string, auth: Actor['auth']) => Test;
  const farmCalls: Record<string, Call> = {
    'GET /farms/:id': (id, auth) => http().get(`/api/v1/farms/${id}`).set(auth),
    'PATCH /farms/:id': (id, auth) =>
      http().patch(`/api/v1/farms/${id}`).set(auth).send({ name: 'Bob edi' }),
    'POST /farms/:id/archive': (id, auth) =>
      http().post(`/api/v1/farms/${id}/archive`).set(auth),
  };
  const animalCalls: Record<string, Call> = {
    'GET /animals/:id': (id, auth) =>
      http().get(`/api/v1/animals/${id}`).set(auth),
    'PATCH /animals/:id': (id, auth) =>
      http()
        .patch(`/api/v1/animals/${id}`)
        .set(auth)
        .send({ name: 'Bob edi', weightKg: '1.00' }),
    'POST /animals/:id/archive': (id, auth) =>
      http()
        .post(`/api/v1/animals/${id}/archive`)
        .set(auth)
        .send({ reason: 'Bob arxivladi' }),
  };

  async function expectSame404(call: Call, foreignId: string) {
    const foreign = await call(foreignId, bob.auth).expect(404);
    const random = await call(randomUUID(), bob.auth).expect(404);
    expect(errorBody(foreign.body)).toStrictEqual(errorBody(random.body));
    expect(errorBody(foreign.body)).toStrictEqual({
      statusCode: 404,
      code: 'NOT_FOUND',
      message: 'Topilmadi',
    });
    expect(foreign.text).not.toContain(foreignId);
    expect(foreign.text).not.toContain('Alice');
  }

  it.each(Object.keys(farmCalls))(
    "%s on another farmer's farm → 404 like a random id, nothing changes",
    async (name) => {
      const before = await farmRow(testApp, aliceFarm.id);
      await expectSame404(farmCalls[name], aliceFarm.id);
      expect(await farmRow(testApp, aliceFarm.id)).toEqual(before);
    },
  );

  it.each(Object.keys(animalCalls))(
    "%s on another farmer's animal → 404 like a random id, nothing changes",
    async (name) => {
      const before = await animalRow(testApp, aliceAnimal.id);
      await expectSame404(animalCalls[name], aliceAnimal.id);
      expect(await animalRow(testApp, aliceAnimal.id)).toEqual(before);
      expect(
        await testApp.prisma.auditLog.count({
          where: { resourceType: 'animal', resourceId: aliceAnimal.id },
        }),
      ).toBe(0);
    },
  );

  it.each(Object.keys(farmCalls))(
    "%s on another farmer's archived farm → 404, never 409",
    async (name) => {
      const before = await farmRow(testApp, aliceArchivedFarm.id);
      await expectSame404(farmCalls[name], aliceArchivedFarm.id);
      expect(await farmRow(testApp, aliceArchivedFarm.id)).toEqual(before);
    },
  );

  it.each(Object.keys(animalCalls))(
    "%s on another farmer's archived animal → 404, never 409",
    async (name) => {
      const before = await animalRow(testApp, aliceArchivedAnimal.id);
      await expectSame404(animalCalls[name], aliceArchivedAnimal.id);
      expect(await animalRow(testApp, aliceArchivedAnimal.id)).toEqual(before);
      expect(
        await testApp.prisma.auditLog.count({
          where: { resourceType: 'animal', resourceId: aliceArchivedAnimal.id },
        }),
      ).toBe(0);
    },
  );

  it('the owner gets 409 on her archived rows (the path Bob must not see)', async () => {
    for (const [call, id, code] of [
      [farmCalls['PATCH /farms/:id'], aliceArchivedFarm.id, 'FARM_ARCHIVED'],
      [
        animalCalls['PATCH /animals/:id'],
        aliceArchivedAnimal.id,
        'ANIMAL_ARCHIVED',
      ],
    ] as const) {
      const res = await call(id, alice.auth).expect(409);
      expect(res.body.code).toBe(code);
    }
  });

  it('the owner is unaffected and still sees her data', async () => {
    const farm = await http()
      .get(`/api/v1/farms/${aliceFarm.id}`)
      .set(alice.auth)
      .expect(200);
    expect(farm.body).toMatchObject({
      name: 'Alice fermasi',
      archivedAt: null,
    });
    const animal = await http()
      .get(`/api/v1/animals/${aliceAnimal.id}`)
      .set(alice.auth)
      .expect(200);
    expect(animal.body).toMatchObject({ tagNumber: 'ALICE-001', name: null });
  });

  it("listing never includes another farmer's rows, even with her farmId filter", async () => {
    const farms = await http()
      .get('/api/v1/farms?includeArchived=true&limit=100')
      .set(bob.auth)
      .expect(200);
    expect(farms.body.items.map((f: { id: string }) => f.id)).toEqual([
      bobFarm.id,
    ]);
    expect(farms.body.total).toBe(1);

    for (const query of [
      `?farmId=${aliceFarm.id}`,
      `?farmId=${aliceFarm.id}&includeArchived=true`,
      `?farmId=${aliceArchivedFarm.id}&includeArchived=true`,
      '?includeArchived=true&limit=100',
      '?species=CATTLE&limit=100',
    ]) {
      const res = await http()
        .get(`/api/v1/animals${query}`)
        .set(bob.auth)
        .expect(200);
      expect(res.body.total).toBe(0);
      expect(res.body.items).toEqual([]);
      expect(res.text).not.toContain(aliceAnimal.id);
      expect(res.text).not.toContain(aliceArchivedAnimal.id);
    }
  });

  it("creating an animal in another farmer's farm → 404 and nothing is created", async () => {
    const res = await http()
      .post('/api/v1/animals')
      .set(bob.auth)
      .send({
        farmId: aliceFarm.id,
        tagNumber: 'BOB-INTRUDER',
        species: 'SHEEP',
      })
      .expect(404);
    const random = await http()
      .post('/api/v1/animals')
      .set(bob.auth)
      .send({
        farmId: randomUUID(),
        tagNumber: 'BOB-INTRUDER',
        species: 'SHEEP',
      })
      .expect(404);
    expect(errorBody(res.body)).toStrictEqual(errorBody(random.body));
    expect(
      await testApp.prisma.animal.count({ where: { farmId: aliceFarm.id } }),
    ).toBe(1);

    // Her archived farm must not answer 409 FARM_ARCHIVED to Bob.
    const archived = await http()
      .post('/api/v1/animals')
      .set(bob.auth)
      .send({
        farmId: aliceArchivedFarm.id,
        tagNumber: 'BOB-INTRUDER',
        species: 'SHEEP',
      })
      .expect(404);
    expect(errorBody(archived.body)).toStrictEqual(errorBody(random.body));
    expect(
      await testApp.prisma.animal.count({
        where: { farmId: aliceArchivedFarm.id },
      }),
    ).toBe(1);
  });

  it("a duplicate of another farmer's tag is not an oracle", async () => {
    // Same tag in Bob's own farm succeeds: tags are scoped per farm.
    await http()
      .post('/api/v1/animals')
      .set(bob.auth)
      .send({ farmId: bobFarm.id, tagNumber: 'ALICE-001', species: 'CATTLE' })
      .expect(201);
  });

  it.each([
    UserRole.VET,
    UserRole.SUPPORT,
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
  ])(
    '%s cannot read or change farmer data through these routes (403)',
    async (role) => {
      const staff = await actor(testApp, role);
      for (const [call, id] of [
        ...Object.values(farmCalls).map((c) => [c, aliceFarm.id] as const),
        ...Object.values(animalCalls).map((c) => [c, aliceAnimal.id] as const),
      ]) {
        const res = await call(id, staff.auth);
        expect(res.status).toBe(403);
        expect(res.text).not.toContain('Alice');
      }
      expect((await farmRow(testApp, aliceFarm.id))?.archivedAt).toBeNull();
      expect((await animalRow(testApp, aliceAnimal.id))?.archivedAt).toBeNull();
    },
  );

  it.each([
    'not-a-uuid',
    '123',
    `${'a'.repeat(8)}-aaaa-1aaa-8aaa-${'a'.repeat(12)}`, // UUID v1
    '00000000-0000-0000-0000-000000000000',
    '..%2F..%2Fetc%2Fpasswd',
    `${randomUUID()}x`,
  ])('rejects the malformed id %s with 400 on every route', async (bad) => {
    for (const call of [
      ...Object.values(farmCalls),
      ...Object.values(animalCalls),
    ]) {
      const res = await call(bad, bob.auth);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_ID');
    }
  });

  it('rejects malformed farm ids in bodies and filters with 400', async () => {
    await http()
      .post('/api/v1/animals')
      .set(bob.auth)
      .send({ farmId: 'abc', tagNumber: 'X-1', species: 'CATTLE' })
      .expect(400);
    await http().get('/api/v1/animals?farmId=abc').set(bob.auth).expect(400);
    await http()
      .get(`/api/v1/animals?farmId=${aliceFarm.id}&farmId=${bobFarm.id}`)
      .set(bob.auth)
      .expect(400);
  });
});
