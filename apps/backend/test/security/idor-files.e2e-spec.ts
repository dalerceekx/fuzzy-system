import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { UserRole } from '../../src/generated/prisma/enums.js';
import { STORAGE_DRIVER } from '../../src/storage/storage.types.js';
import { plainPng } from '../fixtures/files/fixtures.js';
import {
  createLoggedInUser,
  FILES_URL,
  storedFilesOf,
  TestStorageDriver,
  uploadDir,
  uploadFile,
} from '../files/support.js';
import { createTestApp, type TestApp } from '../utils/app.js';
import { createAnimal, createFarm } from '../utils/factories.js';

// Knowing a file id grants nothing: every read and mutation is scoped to the
// owner inside the query, and a foreign file is indistinguishable from a
// missing one (404, same body).

describe('Security: IDOR on files', () => {
  let testApp: TestApp;
  // Signs URLs, so the signed-url route is reachable for the owner and the
  // 404 for others is meaningful.
  const storage = new TestStorageDriver();

  beforeAll(async () => {
    testApp = await createTestApp({
      features: ['files'],
      configure: (builder) =>
        builder.overrideProvider(STORAGE_DRIVER).useValue(storage),
    });
  });

  afterAll(async () => {
    await testApp.close();
  });

  const withoutRequestId = (body: Record<string, unknown>) => {
    const { requestId: _ignored, ...rest } = body;
    return rest;
  };

  it.each([
    UserRole.FARMER,
    UserRole.VET,
    UserRole.SUPPORT,
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
  ])(
    'another %s gets 404 on metadata, content, signed URL and delete',
    async (attackerRole) => {
      const owner = await createLoggedInUser(testApp);
      const attacker = await createLoggedInUser(testApp, attackerRole);
      const up = await uploadFile(testApp, owner.auth, plainPng(), {
        filename: 'maxfiy.png',
        contentType: 'image/png',
      }).expect(201);
      const id = up.body.id as string;
      const missing = await testApp
        .http()
        .get(`${FILES_URL}/${randomUUID()}`)
        .set(attacker.auth.authHeader)
        .expect(404);

      const signedBefore = storage.signed.length;
      for (const path of ['', '/content', '/signed-url']) {
        const res = await testApp
          .http()
          .get(`${FILES_URL}/${id}${path}`)
          .set(attacker.auth.authHeader)
          .expect(404);
        expect(withoutRequestId(res.body)).toEqual(
          withoutRequestId(missing.body),
        );
        expect(JSON.stringify(res.body)).not.toContain('maxfiy');
      }
      expect(storage.signed.length).toBe(signedBefore);
      await testApp
        .http()
        .delete(`${FILES_URL}/${id}`)
        .set(attacker.auth.authHeader)
        .expect(404);

      const list = await testApp
        .http()
        .get(FILES_URL)
        .set(attacker.auth.authHeader)
        .expect(200);
      // Staff roles get no bypass either: the attacker (a fresh user) sees
      // only its own files, and the total does not count the victim's.
      expect(list.body).toMatchObject({ items: [], total: 0 });

      // The file is untouched and still fully available to its owner.
      const row = await testApp.prisma.storedFile.findUniqueOrThrow({
        where: { id },
      });
      expect(row.deletedAt).toBeNull();
      expect(existsSync(join(uploadDir(), row.storageKey))).toBe(true);
      expect(
        await testApp.prisma.auditLog.count({
          where: { action: 'file.deleted', resourceId: id },
        }),
      ).toBe(0);
      for (const path of ['', '/content', '/signed-url']) {
        await testApp
          .http()
          .get(`${FILES_URL}/${id}${path}`)
          .set(owner.auth.authHeader)
          .expect(200);
      }
    },
  );

  it('cannot attach an upload to another farmer’s animal', async () => {
    const victim = await createLoggedInUser(testApp);
    const farm = await createFarm(testApp.prisma, { ownerId: victim.user.id });
    const animal = await createAnimal(testApp.prisma, { farmId: farm.id });
    const attacker = await createLoggedInUser(testApp);

    const res = await uploadFile(testApp, attacker.auth, plainPng(), {
      filename: 'a.png',
      contentType: 'image/png',
      fields: { animalId: animal.id },
    }).expect(404);

    expect(res.body.code).toBe('NOT_FOUND');
    expect(await storedFilesOf(testApp, attacker.user.id)).toHaveLength(0);
    expect(
      await testApp.prisma.storedFile.count({ where: { animalId: animal.id } }),
    ).toBe(0);
  });

  it('cannot filter the list by another farmer’s animal to see its files', async () => {
    const victim = await createLoggedInUser(testApp);
    const farm = await createFarm(testApp.prisma, { ownerId: victim.user.id });
    const animal = await createAnimal(testApp.prisma, { farmId: farm.id });
    await uploadFile(testApp, victim.auth, plainPng(), {
      filename: 'a.png',
      contentType: 'image/png',
      fields: { animalId: animal.id },
    }).expect(201);
    const attacker = await createLoggedInUser(testApp);

    const res = await testApp
      .http()
      .get(`${FILES_URL}?animalId=${animal.id}`)
      .set(attacker.auth.authHeader)
      .expect(200);
    expect(res.body).toMatchObject({ items: [], total: 0 });
  });
});
