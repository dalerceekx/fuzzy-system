import { randomUUID } from 'node:crypto';
import { AuditAction } from '../../src/audit/audit-actions.js';
import {
  addDays,
  dateOnlyToDate,
  todayInTashkent,
} from '../../src/common/time.js';
import type { Animal } from '../../src/generated/prisma/client.js';
import {
  Species,
  TreatmentStatus,
  UserRole,
} from '../../src/generated/prisma/enums.js';
import { actor, animalRow, whileLocked, type Actor } from '../farms/support.js';
import { createTestApp, type TestApp } from '../utils/app.js';
import {
  createAnimal,
  createFarm,
  createProtocolWithVersion,
  uniqueSuffix,
} from '../utils/factories.js';

describe('Animals API', () => {
  let testApp: TestApp;
  let farmer: Actor;
  let farmId: string;

  beforeAll(async () => {
    testApp = await createTestApp({ features: ['farms', 'animals'] });
    farmer = await actor(testApp);
    farmId = (await createFarm(testApp.prisma, { ownerId: farmer.id })).id;
  });

  afterAll(async () => {
    await testApp.close();
  });

  const http = () => testApp.http();
  const tag = () => `T-${uniqueSuffix().toUpperCase()}`;
  const post = (body: object, auth = farmer.auth) =>
    http().post('/api/v1/animals').set(auth).send(body);
  const valid = () => ({ farmId, tagNumber: tag(), species: Species.CATTLE });

  async function insertTreatment(
    animal: Animal,
    startedById: string,
    versionId: string,
    opts: {
      startedDaysAgo: number;
      endsOn: string;
      meat: string;
      milk: string;
      status?: TreatmentStatus;
    },
  ) {
    const status = opts.status ?? TreatmentStatus.ACTIVE;
    await testApp.prisma.treatment.create({
      data: {
        farmId: animal.farmId,
        animalId: animal.id,
        protocolVersionId: versionId,
        startedById,
        status,
        startedAt: new Date(Date.now() - opts.startedDaysAgo * 86_400_000),
        endsOn: dateOnlyToDate(opts.endsOn),
        animalWeightKg: '450.00',
        protocolSnapshot: { test: true },
        withdrawalMeatUntil: dateOnlyToDate(opts.meat),
        withdrawalMilkUntil: dateOnlyToDate(opts.milk),
        completedAt: status === TreatmentStatus.COMPLETED ? new Date() : null,
        cancelledAt: status === TreatmentStatus.CANCELLED ? new Date() : null,
      },
    });
  }

  describe('authorization', () => {
    it('requires authentication', async () => {
      await http().get('/api/v1/animals').expect(401);
      await http().post('/api/v1/animals').send(valid()).expect(401);
    });

    it.each([UserRole.VET, UserRole.SUPPORT, UserRole.SUPER_ADMIN])(
      'denies %s',
      async (role) => {
        const staff = await actor(testApp, role);
        await http().get('/api/v1/animals').set(staff.auth).expect(403);
        await post(valid(), staff.auth).expect(403);
      },
    );
  });

  describe('POST /animals', () => {
    it('creates an animal with normalized decimal and date fields', async () => {
      const body = {
        ...valid(),
        sex: 'FEMALE',
        name: ' Oqbosh ',
        birthDate: '2024-02-29',
        weightKg: '452.5',
        notes: 'Sog‘lom',
      };
      const res = await post(body).expect(201);
      expect(res.body).toStrictEqual({
        id: expect.any(String),
        farmId,
        tagNumber: body.tagNumber,
        name: 'Oqbosh',
        species: 'CATTLE',
        sex: 'FEMALE',
        birthDate: '2024-02-29',
        weightKg: '452.50',
        notes: 'Sog‘lom',
        archivedAt: null,
        archivedReason: null,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
    });

    it('applies defaults for optional fields', async () => {
      const res = await post(valid()).expect(201);
      expect(res.body).toMatchObject({
        sex: 'UNKNOWN',
        name: null,
        birthDate: null,
        weightKg: null,
        notes: null,
      });
    });

    it.each(['0.01', '5000', '5000.00', '1', '999.9'])(
      'accepts the weight %s',
      async (weightKg) => {
        await post({ ...valid(), weightKg }).expect(201);
      },
    );

    it.each([
      ['a JSON number', 452.5],
      ['an integer number', 450],
      ['null', null],
      ['NaN', 'NaN'],
      ['Infinity', 'Infinity'],
      ['exponent', '1e3'],
      ['negative', '-5'],
      ['zero', '0'],
      ['zero with decimals', '0.00'],
      ['above 5000', '5000.01'],
      ['too many decimals', '1.234'],
      ['plus sign', '+5'],
      ['leading dot', '.5'],
      ['trailing dot', '5.'],
      ['whitespace', ' 5'],
      ['empty', ''],
      ['comma', '5,5'],
      ['hex', '0x10'],
      ['leading zeros', '007'],
      ['object', { value: '5' }],
    ])('rejects a weight given as %s', async (_label, weightKg) => {
      const body = { ...valid(), weightKg };
      const res = await post(body).expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(
        await testApp.prisma.animal.count({
          where: { farmId, tagNumber: body.tagNumber },
        }),
      ).toBe(0);
    });

    it('accepts today in Tashkent as a birth date', async () => {
      const res = await post({
        ...valid(),
        birthDate: todayInTashkent(),
      }).expect(201);
      expect(res.body.birthDate).toBe(todayInTashkent());
    });

    it.each([
      ['tomorrow in Tashkent', () => addDays(todayInTashkent(), 1)],
      ['far future', () => '2999-01-01'],
      ['impossible date', () => '2023-02-29'],
      ['month 13', () => '2023-13-01'],
      ['non-padded', () => '2023-1-5'],
      ['timestamp', () => '2023-01-05T00:00:00Z'],
      ['too old', () => '1900-01-01'],
      ['null', () => null],
      ['number', () => 20230105],
    ])('rejects a birth date that is %s', async (_label, value) => {
      await post({ ...valid(), birthDate: value() }).expect(400);
    });

    it.each([
      ['tag over 50 chars', { tagNumber: 't'.repeat(51) }],
      ['blank tag', { tagNumber: '   ' }],
      ['tag with markup', { tagNumber: '<script>' }],
      ['tag with newline', { tagNumber: 'A\nB' }],
      ['Cyrillic look-alike tag', { tagNumber: '\u0410\u0412-1' }],
      ['tag with non-Latin letters', { tagNumber: '\u00C4-1' }],
      ['zero-width-only name', { name: '\u200B\u2060' }],
      ['name over 100 chars', { name: 'n'.repeat(101) }],
      ['blank name', { name: ' ' }],
      ['null name', { name: null }],
      ['notes over 1000 chars', { notes: 'n'.repeat(1001) }],
      ['unknown species', { species: 'DRAGON' }],
      ['lower-case species', { species: 'cattle' }],
      ['unknown sex', { sex: 'X' }],
      ['malformed farmId', { farmId: 'abc' }],
      ['UUID v1 farmId', { farmId: 'a8098c1a-f86e-11da-bd1a-00112444be1e' }],
      ['missing farmId', { farmId: undefined }],
    ])('rejects %s with 400', async (_label, patch) => {
      await post({ ...valid(), ...patch }).expect(400);
    });

    it('stores tags canonically: upper-case ASCII, compatibility forms folded', async () => {
      const suffix = uniqueSuffix().toUpperCase();
      const res = await post({
        ...valid(),
        tagNumber: ` uz-\u200B${suffix}\uFF11\uFF12 `,
      }).expect(201);
      expect(res.body.tagNumber).toBe(`UZ-${suffix}12`);
    });

    it.each([
      ['a case variant', (t: string) => t.toLowerCase()],
      ['a fullwidth variant', (t: string) => t.replace('7', '\uFF17')],
      ['a variant with invisible characters', (t: string) => `\u200E${t}`],
    ])(
      'treats %s of an active tag as a duplicate (409)',
      async (_l, variant) => {
        const tagNumber = `AB-7${uniqueSuffix().toUpperCase()}`;
        await post({ ...valid(), tagNumber }).expect(201);
        const res = await post({
          ...valid(),
          tagNumber: variant(tagNumber),
        }).expect(409);
        expect(res.body.code).toBe('TAG_NUMBER_TAKEN');
      },
    );

    it('accepts fields at their maximum length', async () => {
      await post({
        ...valid(),
        tagNumber: `${uniqueSuffix()}${'t'.repeat(50)}`.slice(0, 50),
        name: 'n'.repeat(100),
        notes: 'n'.repeat(1000),
      }).expect(201);
    });

    it.each([
      ['archivedAt', new Date().toISOString()],
      ['archivedReason', 'x'],
      ['id', randomUUID()],
      ['ownerId', randomUUID()],
      ['createdAt', new Date().toISOString()],
    ])('rejects the unknown field %s', async (field, value) => {
      const body = { ...valid(), [field]: value };
      const res = await post(body).expect(400);
      expect(res.body.message).toEqual(['Ruxsat etilmagan maydon yuborildi']);
      expect(
        await testApp.prisma.animal.count({
          where: { farmId, tagNumber: body.tagNumber },
        }),
      ).toBe(0);
    });

    it('returns 404 for an unknown farm and 409 for an archived one', async () => {
      await post({ ...valid(), farmId: randomUUID() }).expect(404);
      const archived = await createFarm(testApp.prisma, {
        ownerId: farmer.id,
      });
      await testApp.prisma.farm.update({
        where: { id: archived.id },
        data: { archivedAt: new Date() },
      });
      const res = await post({ ...valid(), farmId: archived.id }).expect(409);
      expect(res.body.code).toBe('FARM_ARCHIVED');
    });

    it('rejects a duplicate active tag in the same farm (409 TAG_NUMBER_TAKEN)', async () => {
      const tagNumber = tag();
      const first = await post({ ...valid(), tagNumber }).expect(201);
      const dup = await post({ ...valid(), tagNumber }).expect(409);
      expect(dup.body).toMatchObject({
        statusCode: 409,
        code: 'TAG_NUMBER_TAKEN',
      });
      expect(JSON.stringify(dup.body)).not.toMatch(
        /animals_|tag_number|farm_id/,
      );

      // Same tag in another farm of the same owner is fine.
      const otherFarm = await createFarm(testApp.prisma, {
        ownerId: farmer.id,
      });
      await post({ ...valid(), farmId: otherFarm.id, tagNumber }).expect(201);

      // Once the first animal is archived its tag can be reused.
      await http()
        .post(`/api/v1/animals/${first.body.id}/archive`)
        .set(farmer.auth)
        .send({ reason: 'sotildi' })
        .expect(200);
      await post({ ...valid(), tagNumber }).expect(201);
    });

    it('creates exactly one animal when the same tag is posted concurrently', async () => {
      const tagNumber = tag();
      const results = await Promise.all(
        Array.from({ length: 5 }, () => post({ ...valid(), tagNumber })),
      );
      expect(results.map((r) => r.status).sort()).toEqual([
        201, 409, 409, 409, 409,
      ]);
      for (const res of results.filter((r) => r.status === 409)) {
        expect(res.body.code).toBe('TAG_NUMBER_TAKEN');
      }
      expect(
        await testApp.prisma.animal.count({
          where: { farmId, tagNumber, archivedAt: null },
        }),
      ).toBe(1);
    });
  });

  describe('GET /animals', () => {
    let owner: Actor;
    let farmA: string;
    let farmB: string;
    let animals: Record<string, Animal>;

    beforeAll(async () => {
      owner = await actor(testApp);
      farmA = (await createFarm(testApp.prisma, { ownerId: owner.id })).id;
      farmB = (await createFarm(testApp.prisma, { ownerId: owner.id })).id;
      const make = (
        farm: string,
        tagNumber: string,
        species: Species,
        name?: string,
      ) =>
        createAnimal(testApp.prisma, {
          farmId: farm,
          tagNumber,
          species,
          name,
        });
      animals = {
        a1: await make(farmA, 'A-01', Species.CATTLE, 'Bo‘ri'),
        a2: await make(farmA, 'A-02', Species.SHEEP, 'Anor'),
        a3: await make(farmA, 'A-03', Species.CATTLE),
        b1: await make(farmB, 'B-01', Species.GOAT, 'Chinor'),
        gone: await make(farmA, 'A-00', Species.CATTLE),
      };
      await testApp.prisma.animal.update({
        where: { id: animals.gone.id },
        data: { archivedAt: new Date(), archivedReason: 'sotildi' },
      });
    });

    const list = (query = '') =>
      http().get(`/api/v1/animals${query}`).set(owner.auth).expect(200);
    const tags = (body: { items: { tagNumber: string }[] }) =>
      body.items.map((a) => a.tagNumber);

    it('lists own active animals with pagination defaults', async () => {
      const res = await list();
      expect(res.body).toMatchObject({ page: 1, limit: 20, total: 4 });
      expect(tags(res.body).sort()).toEqual(['A-01', 'A-02', 'A-03', 'B-01']);
      expect(res.body.items[0]).not.toHaveProperty('activeWithdrawal');
    });

    it('filters by farm, species and archived state', async () => {
      expect(tags((await list(`?farmId=${farmB}`)).body)).toEqual(['B-01']);
      expect(
        tags(
          (await list(`?farmId=${farmA}&species=CATTLE&sort=tagNumber`)).body,
        ),
      ).toEqual(['A-01', 'A-03']);
      const all = await list(
        `?farmId=${farmA}&includeArchived=true&sort=tagNumber`,
      );
      expect(tags(all.body)).toEqual(['A-00', 'A-01', 'A-02', 'A-03']);
      expect((await list('?includeArchived=false')).body.total).toBe(4);
    });

    it('sorts by allowlisted fields and pages through results', async () => {
      expect(tags((await list('?sort=-tagNumber')).body)).toEqual([
        'B-01',
        'A-03',
        'A-02',
        'A-01',
      ]);
      // Animals without a name sort last.
      expect(tags((await list('?sort=name')).body)).toEqual([
        'A-02',
        'A-01',
        'B-01',
        'A-03',
      ]);
      const page2 = await list('?sort=tagNumber&limit=3&page=2');
      expect(page2.body).toMatchObject({ page: 2, limit: 3, total: 4 });
      expect(tags(page2.body)).toEqual(['B-01']);
    });

    it.each([
      'sort=weightKg',
      'sort=farm.ownerId',
      'sort=-',
      'limit=1000',
      'page=-1',
      'farmId=abc',
      'species=DRAGON',
      'includeArchived=TRUE',
      'where[farmId]=x',
      'tagNumber=A-01',
    ])('rejects the query %s with 400', async (query) => {
      await http().get(`/api/v1/animals?${query}`).set(owner.auth).expect(400);
    });
  });

  describe('GET /animals/:id', () => {
    it('returns activeWithdrawal: null without treatments', async () => {
      const animal = await createAnimal(testApp.prisma, { farmId });
      const res = await http()
        .get(`/api/v1/animals/${animal.id}`)
        .set(farmer.auth)
        .expect(200);
      expect(res.body).toMatchObject({
        id: animal.id,
        weightKg: '450.00',
        activeWithdrawal: null,
      });
    });

    it('computes activeWithdrawal from non-cancelled, still-running treatments', async () => {
      const animal = await createAnimal(testApp.prisma, { farmId });
      const { version } = await createProtocolWithVersion(testApp.prisma, {
        approved: true,
      });
      const today = todayInTashkent();
      const day = (n: number) => addDays(today, n);
      // Ended long ago: ignored.
      await insertTreatment(animal, farmer.id, version.id, {
        startedDaysAgo: 40,
        endsOn: day(-35),
        meat: day(-30),
        milk: day(-1),
        status: TreatmentStatus.COMPLETED,
      });
      // Cancelled: ignored even though its dates are in the future.
      await insertTreatment(animal, farmer.id, version.id, {
        startedDaysAgo: 0,
        endsOn: today,
        meat: day(100),
        milk: day(100),
        status: TreatmentStatus.CANCELLED,
      });
      await insertTreatment(animal, farmer.id, version.id, {
        startedDaysAgo: 0,
        endsOn: today,
        meat: day(10),
        milk: day(2),
      });
      await insertTreatment(animal, farmer.id, version.id, {
        startedDaysAgo: 3,
        endsOn: day(-1),
        meat: day(3),
        milk: day(5),
        status: TreatmentStatus.COMPLETED,
      });

      const res = await http()
        .get(`/api/v1/animals/${animal.id}`)
        .set(farmer.auth)
        .expect(200);
      expect(res.body.activeWithdrawal).toEqual({
        meatUntil: day(10),
        milkUntil: day(5),
      });
    });

    it('reports a withdrawal ending today and null for an ended product', async () => {
      const animal = await createAnimal(testApp.prisma, { farmId });
      const { version } = await createProtocolWithVersion(testApp.prisma, {
        approved: true,
      });
      const today = todayInTashkent();
      await insertTreatment(animal, farmer.id, version.id, {
        startedDaysAgo: 5,
        endsOn: addDays(today, -2),
        meat: addDays(today, -1),
        milk: today,
        status: TreatmentStatus.COMPLETED,
      });
      const res = await http()
        .get(`/api/v1/animals/${animal.id}`)
        .set(farmer.auth)
        .expect(200);
      expect(res.body.activeWithdrawal).toEqual({
        meatUntil: null,
        milkUntil: today,
      });
    });

    it('returns archived animals to their owner', async () => {
      const animal = await createAnimal(testApp.prisma, { farmId });
      await testApp.prisma.animal.update({
        where: { id: animal.id },
        data: { archivedAt: new Date(), archivedReason: 'o‘ldi' },
      });
      const res = await http()
        .get(`/api/v1/animals/${animal.id}`)
        .set(farmer.auth)
        .expect(200);
      expect(res.body).toMatchObject({
        archivedReason: 'o‘ldi',
        archivedAt: expect.any(String),
      });
    });

    it('returns 404 for unknown ids and 400 for malformed ones', async () => {
      await http()
        .get(`/api/v1/animals/${randomUUID()}`)
        .set(farmer.auth)
        .expect(404);
      const bad = await http()
        .get('/api/v1/animals/1%27%20OR%201=1')
        .set(farmer.auth)
        .expect(400);
      expect(bad.body.code).toBe('INVALID_ID');
    });
  });

  describe('PATCH /animals/:id', () => {
    const patch = (id: string, body: object) =>
      http().patch(`/api/v1/animals/${id}`).set(farmer.auth).send(body);

    it('updates fields and clears nullable ones with null', async () => {
      const animal = await createAnimal(testApp.prisma, {
        farmId,
        name: 'Eski',
        birthDate: dateOnlyToDate('2022-01-01'),
      });
      const res = await patch(animal.id, {
        tagNumber: ' NEW-1 '.replace('1', uniqueSuffix()),
        species: 'GOAT',
        sex: 'MALE',
        weightKg: '61.25',
        name: null,
        birthDate: null,
        notes: 'Emlangan',
      }).expect(200);
      expect(res.body).toMatchObject({
        species: 'GOAT',
        sex: 'MALE',
        weightKg: '61.25',
        name: null,
        birthDate: null,
        notes: 'Emlangan',
        farmId,
      });
      expect(res.body.tagNumber).toMatch(/^NEW-/);
    });

    it.each([
      { weightKg: null },
      { weightKg: 12 },
      { weightKg: '1e3' },
      { weightKg: '-1' },
      { weightKg: 'NaN' },
      { tagNumber: null },
      { tagNumber: 't'.repeat(51) },
      { species: null },
      { birthDate: '2999-12-31' },
      { notes: 'n'.repeat(1001) },
      { farmId: randomUUID() },
      { archivedAt: null },
      { archivedReason: 'x' },
    ])('rejects %o with 400 and changes nothing', async (body) => {
      const animal = await createAnimal(testApp.prisma, { farmId });
      const before = await animalRow(testApp, animal.id);
      await patch(animal.id, body).expect(400);
      expect(await animalRow(testApp, animal.id)).toEqual(before);
    });

    it('rejects a tag already used by an active animal of the farm', async () => {
      // Canonical tags: the factory writes rows directly, bypassing the DTO.
      const first = await createAnimal(testApp.prisma, {
        farmId,
        tagNumber: tag(),
      });
      const second = await createAnimal(testApp.prisma, {
        farmId,
        tagNumber: tag(),
      });
      const res = await patch(second.id, { tagNumber: first.tagNumber }).expect(
        409,
      );
      expect(res.body.code).toBe('TAG_NUMBER_TAKEN');
      expect((await animalRow(testApp, second.id))?.tagNumber).toBe(
        second.tagNumber,
      );
    });

    it('refuses to edit an archived animal (409 ANIMAL_ARCHIVED)', async () => {
      const animal = await createAnimal(testApp.prisma, { farmId });
      await testApp.prisma.animal.update({
        where: { id: animal.id },
        data: { archivedAt: new Date(), archivedReason: 'sotildi' },
      });
      const res = await patch(animal.id, { name: 'Yangi' }).expect(409);
      expect(res.body.code).toBe('ANIMAL_ARCHIVED');
    });

    it('returns 404 for an unknown animal', async () => {
      await patch(randomUUID(), { name: 'Yangi' }).expect(404);
    });
  });

  describe('POST /animals/:id/archive', () => {
    const archive = (id: string, body: object = { reason: 'Sotildi' }) =>
      http().post(`/api/v1/animals/${id}/archive`).set(farmer.auth).send(body);

    it('archives the animal and writes an audit row with old/new values', async () => {
      const animal = await createAnimal(testApp.prisma, { farmId });
      const res = await archive(animal.id, {
        reason: '  Go‘shtga topshirildi ',
      }).expect(200);
      expect(res.body).toMatchObject({
        id: animal.id,
        archivedAt: expect.any(String),
        archivedReason: 'Go‘shtga topshirildi',
      });

      const logs = await testApp.prisma.auditLog.findMany({
        where: { resourceType: 'animal', resourceId: animal.id },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        action: AuditAction.ANIMAL_ARCHIVED,
        actorId: farmer.id,
        actorRole: UserRole.FARMER,
        oldValue: {
          farmId,
          tagNumber: animal.tagNumber,
          archivedAt: null,
          archivedReason: null,
        },
        newValue: {
          farmId,
          tagNumber: animal.tagNumber,
          archivedAt: res.body.archivedAt,
          archivedReason: 'Go‘shtga topshirildi',
          activeWithdrawal: null,
          activeTreatments: 0,
        },
        requestId: res.headers['x-request-id'],
      });
      expect(logs[0].ip).toEqual(expect.any(String));
    });

    it('records a running treatment and withdrawal in the audit row', async () => {
      const animal = await createAnimal(testApp.prisma, { farmId });
      const { version } = await createProtocolWithVersion(testApp.prisma, {
        approved: true,
      });
      const today = todayInTashkent();
      await insertTreatment(animal, farmer.id, version.id, {
        startedDaysAgo: 0,
        endsOn: addDays(today, 2),
        meat: addDays(today, 20),
        milk: addDays(today, 5),
      });
      await archive(animal.id, { reason: 'O‘ldi' }).expect(200);
      const log = await testApp.prisma.auditLog.findFirstOrThrow({
        where: { resourceType: 'animal', resourceId: animal.id },
      });
      expect(log.newValue).toMatchObject({
        activeWithdrawal: {
          meatUntil: addDays(today, 20),
          milkUntil: addDays(today, 5),
        },
        activeTreatments: 1,
      });
    });

    it('audits the real pre-archive state when an edit commits first', async () => {
      const animal = await createAnimal(testApp.prisma, { farmId });
      const edited = `${animal.tagNumber}-EDIT`;
      const res = await whileLocked(
        testApp,
        (tx) =>
          tx.animal.update({
            where: { id: animal.id },
            data: { tagNumber: edited },
          }),
        () => archive(animal.id),
      );
      expect(res.status).toBe(200);
      const log = await testApp.prisma.auditLog.findFirstOrThrow({
        where: { resourceType: 'animal', resourceId: animal.id },
      });
      expect(log.oldValue).toMatchObject({
        tagNumber: edited,
        archivedAt: null,
      });
      expect(log.newValue).toMatchObject({ tagNumber: edited });
    });

    it('refuses a second archive (409) without another audit row', async () => {
      const animal = await createAnimal(testApp.prisma, { farmId });
      await archive(animal.id).expect(200);
      const res = await archive(animal.id).expect(409);
      expect(res.body.code).toBe('ANIMAL_ARCHIVED');
      expect(
        await testApp.prisma.auditLog.count({
          where: { resourceType: 'animal', resourceId: animal.id },
        }),
      ).toBe(1);
    });

    it('archives exactly once under concurrent requests', async () => {
      const animal = await createAnimal(testApp.prisma, { farmId });
      const results = await Promise.all(
        Array.from({ length: 4 }, () => archive(animal.id)),
      );
      expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409, 409]);
      for (const res of results.filter((r) => r.status === 409)) {
        expect(res.body.code).toBe('ANIMAL_ARCHIVED');
      }
      expect(
        await testApp.prisma.auditLog.count({
          where: { resourceType: 'animal', resourceId: animal.id },
        }),
      ).toBe(1);
    });

    it.each([
      {},
      { reason: '' },
      { reason: '   ' },
      { reason: '\u202E\u200B' },
      { reason: null },
      { reason: 'r'.repeat(501) },
      { reason: 'ok', archivedAt: '2020-01-01' },
    ])('rejects %o with 400 and changes nothing', async (body) => {
      const animal = await createAnimal(testApp.prisma, { farmId });
      await archive(animal.id, body).expect(400);
      expect((await animalRow(testApp, animal.id))?.archivedAt).toBeNull();
    });

    it('returns 404 for an unknown animal', async () => {
      await archive(randomUUID()).expect(404);
    });
  });
});
