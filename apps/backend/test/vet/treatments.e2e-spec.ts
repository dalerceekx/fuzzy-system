import { addDays } from '../../src/common/time.js';
import {
  InventoryCategory,
  ProtocolVersionStatus,
  Species,
  UserRole,
} from '../../src/generated/prisma/enums.js';
import { createTestApp, type TestApp } from '../utils/app.js';
import {
  createFarm,
  createInventoryItem,
  createProtocolWithVersion,
} from '../utils/factories.js';
import {
  actor,
  approvedMedicine,
  approvedProtocol,
  auditRows,
  dayFromToday,
  farmer as createFarmer,
  medicineItem,
  newKey,
  postTreatment,
  PROTOCOLS,
  today,
  treatmentCount,
  TREATMENTS,
  type Actor,
  type Farmer,
} from './support.js';

describe('Vet treatments', () => {
  let testApp: TestApp;
  let vet: Actor;
  let farmer: Farmer;

  beforeAll(async () => {
    testApp = await createTestApp({ features: ['vet'] });
    vet = await actor(testApp, UserRole.VET);
    farmer = await createFarmer(testApp);
  });

  afterAll(async () => {
    await testApp.close();
  });

  const start = (body: object, who: Actor = farmer, key?: string) =>
    postTreatment(testApp, who.auth, body, key);

  it('starts a treatment with a full snapshot, dose rows and an audit row', async () => {
    const { protocol, version, medicineIds } = await approvedProtocol(testApp);
    const medicine = await testApp.prisma.medicine.findUniqueOrThrow({
      where: { id: medicineIds[0] },
    });
    const res = await start({
      animalId: farmer.animal.id,
      protocolVersionId: version.id,
      notes: 'Chap orqa yelin',
    }).expect(201);
    expect(res.headers['idempotent-replayed']).toBeUndefined();

    const endsOn = addDays(today(), 2);
    expect(res.body).toMatchObject({
      farmId: farmer.farm.id,
      animalId: farmer.animal.id,
      protocolVersionId: version.id,
      status: 'ACTIVE',
      endsOn,
      animalWeightKg: '450.00',
      withdrawalMeatUntil: addDays(endsOn, 7),
      withdrawalMilkUntil: addDays(endsOn, 3),
      notes: 'Chap orqa yelin',
      doses: [
        {
          medicineId: medicine.id,
          medicineName: medicine.name,
          inventoryItemId: null,
          dosePerKg: '0.2000',
          doseUnit: 'ML',
          singleDose: '90.0000',
          route: 'IM',
          frequencyPerDay: 1,
          durationDays: 3,
          withdrawalMeatDays: 7,
          withdrawalMilkDays: 3,
        },
      ],
    });
    expect(res.body.warning).toContain(addDays(endsOn, 7));
    expect(res.body.warning).toContain(addDays(endsOn, 3));
    expect(res.body.protocolSnapshot).toMatchObject({
      schemaVersion: 1,
      startsOn: today(),
      endsOn,
      protocol: {
        id: protocol.id,
        protocolCode: protocol.code,
        versionId: version.id,
        version: 1,
        title: version.title,
        condition: version.condition,
        instructions: version.instructions,
      },
      animal: {
        id: farmer.animal.id,
        tagNumber: farmer.animal.tagNumber,
        species: 'CATTLE',
        weightKg: '450.00',
        weightSource: 'animal',
      },
      drugs: [
        {
          medicineId: medicine.id,
          medicineName: medicine.name,
          singleDose: '90.0000',
          lastDay: endsOn,
          withdrawalMeatDays: 7,
          withdrawalMilkDays: 3,
        },
      ],
      withdrawal: {
        meatUntil: addDays(endsOn, 7),
        milkUntil: addDays(endsOn, 3),
      },
    });
    expect(res.body.protocolSnapshot.computedAt).toEqual(expect.any(String));

    const doses = await testApp.prisma.treatmentDose.findMany({
      where: { treatmentId: res.body.id },
    });
    expect(doses).toHaveLength(1);
    expect(doses[0].singleDose.toFixed(4)).toBe('90.0000');

    const audit = await auditRows(testApp, 'treatment', res.body.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'treatment.started',
      actorId: farmer.user.id,
      actorRole: 'FARMER',
      newValue: expect.objectContaining({
        animalId: farmer.animal.id,
        protocolVersionId: version.id,
        endsOn,
        animalWeightKg: '450.00',
      }),
    });
  });

  it('caps doses at maxSingleDose and takes the latest withdrawal over all drugs (Decimal math)', async () => {
    const [m1, m2] = await Promise.all([
      approvedMedicine(testApp, {
        withdrawalMeatDays: 28,
        withdrawalMilkDays: 4,
      }),
      approvedMedicine(testApp, {
        withdrawalMeatDays: 0,
        withdrawalMilkDays: 10,
      }),
    ]);
    const drug = { doseUnit: 'ML', route: 'IM', frequencyPerDay: 1 };
    const created = await testApp
      .http()
      .post(PROTOCOLS)
      .set(vet.auth)
      .send({
        code: `CAP-${Date.now()}`,
        species: 'CATTLE',
        version: {
          title: 'Ikki dorili',
          condition: 'pnevmoniya',
          isEmergency: false,
          instructions: 'Test',
          drugs: [
            {
              ...drug,
              medicineId: m1.id,
              dosePerKg: '0.5',
              maxSingleDose: '100',
              durationDays: 5,
            },
            { ...drug, medicineId: m2.id, dosePerKg: '0.01', durationDays: 1 },
          ],
        },
      })
      .expect(201);
    const versionId = created.body.versions[0].id;
    await testApp
      .http()
      .post(`${PROTOCOLS}/${created.body.id}/versions/${versionId}/approve`)
      .set(vet.auth)
      .expect(200);

    const res = await start({
      animalId: farmer.animal.id,
      protocolVersionId: versionId,
      animalWeightKg: '300.5',
    }).expect(201);
    expect(res.body).toMatchObject({
      animalWeightKg: '300.50',
      endsOn: addDays(today(), 4),
      withdrawalMeatUntil: addDays(today(), 32),
      withdrawalMilkUntil: addDays(today(), 10),
    });
    expect(
      res.body.doses.map((d: { singleDose: string }) => d.singleDose),
    ).toEqual(['100.0000', '3.0050']);
    expect(res.body.protocolSnapshot.animal.weightSource).toBe('request');
  });

  it('Idempotency-Key: replay returns the same treatment; other payload → 409; missing → 400', async () => {
    const { version } = await approvedProtocol(testApp);
    const body = { animalId: farmer.animal.id, protocolVersionId: version.id };
    const key = newKey();
    const before = await treatmentCount(testApp, farmer.animal.id);
    const first = await start(body, farmer, key).expect(201);
    const replay = await start(body, farmer, key).expect(201);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body).toEqual(first.body);
    expect(await treatmentCount(testApp, farmer.animal.id)).toBe(before + 1);

    const reused = await start(
      { ...body, notes: 'boshqa' },
      farmer,
      key,
    ).expect(409);
    expect(reused.body.code).toBe('IDEMPOTENCY_KEY_REUSED');

    const missing = await testApp
      .http()
      .post(TREATMENTS)
      .set(farmer.auth)
      .send(body)
      .expect(400);
    expect(missing.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(await treatmentCount(testApp, farmer.animal.id)).toBe(before + 1);
  });

  it('concurrent requests with one Idempotency-Key start exactly one treatment', async () => {
    const owner = await createFarmer(testApp);
    const { version } = await approvedProtocol(testApp);
    const key = newKey();
    const body = { animalId: owner.animal.id, protocolVersionId: version.id };
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => start(body, owner, key)),
    );
    expect(responses.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    expect(new Set(responses.map((r) => r.body.id)).size).toBe(1);
    expect(await treatmentCount(testApp, owner.animal.id)).toBe(1);
  });

  it('refuses a missing weight (WEIGHT_REQUIRED) and invalid weights', async () => {
    const noWeight = await createFarmer(testApp, { weightKg: null });
    const { version } = await approvedProtocol(testApp);
    const body = {
      animalId: noWeight.animal.id,
      protocolVersionId: version.id,
    };
    const res = await start(body, noWeight).expect(422);
    expect(res.body.code).toBe('WEIGHT_REQUIRED');
    for (const animalWeightKg of [450, '0', '-1', '5000.01', '1e3', null]) {
      await start({ ...body, animalWeightKg }, noWeight).expect(400);
    }
    await start({ ...body, animalWeightKg: '12.5' }, noWeight).expect(201);
  });

  it('refuses versions that are not the APPROVED one of a live protocol', async () => {
    const draft = await createProtocolWithVersion(testApp.prisma);
    const archived = await approvedProtocol(testApp);
    await testApp.prisma.protocol.update({
      where: { id: archived.protocol.id },
      data: { archivedAt: new Date() },
    });
    const superseded = await approvedProtocol(testApp);
    await testApp.prisma.protocolVersion.update({
      where: { id: superseded.version.id },
      data: { status: ProtocolVersionStatus.SUPERSEDED },
    });
    for (const protocolVersionId of [
      draft.version.id,
      archived.version.id,
      superseded.version.id,
      '0b7f1a0e-2a7b-4e0c-8a51-4f7d2f0d9e11',
    ]) {
      const res = await start({
        animalId: farmer.animal.id,
        protocolVersionId,
      }).expect(422);
      expect(res.body.code).toBe('PROTOCOL_NOT_APPROVED');
    }
  });

  it('refuses a protocol for another species (SPECIES_MISMATCH)', async () => {
    const { version } = await approvedProtocol(testApp, {
      species: Species.SHEEP,
    });
    const res = await start({
      animalId: farmer.animal.id,
      protocolVersionId: version.id,
    }).expect(422);
    expect(res.body.code).toBe('SPECIES_MISMATCH');
  });

  it('refuses when a protocol medicine was archived after approval', async () => {
    const { version, medicineIds } = await approvedProtocol(testApp);
    await testApp
      .http()
      .post(`/api/v1/vet/medicines/${medicineIds[0]}/archive`)
      .set(vet.auth)
      .expect(200);
    const res = await start({
      animalId: farmer.animal.id,
      protocolVersionId: version.id,
    }).expect(422);
    expect(res.body).toMatchObject({
      code: 'MEDICINE_NOT_APPROVED',
      details: { medicineIds },
    });
  });

  describe('inventory items', () => {
    it('snapshots the batch and expiry of a usable item', async () => {
      const { version, medicineIds } = await approvedProtocol(testApp);
      const item = await medicineItem(
        testApp,
        farmer.farm.id,
        medicineIds[0],
        // Usable exactly through the last treatment day.
        { expiresOn: dayFromToday(2) },
      );
      const res = await start({
        animalId: farmer.animal.id,
        protocolVersionId: version.id,
        items: [{ medicineId: medicineIds[0], inventoryItemId: item.id }],
      }).expect(201);
      expect(res.body.doses[0]).toMatchObject({
        inventoryItemId: item.id,
        batchNumber: item.batchNumber,
        itemExpiresOn: addDays(today(), 2),
      });
      expect(res.body.protocolSnapshot.drugs[0]).toMatchObject({
        inventoryItemId: item.id,
        batchNumber: item.batchNumber,
      });
    });

    it('an opened item usable through the last day is accepted', async () => {
      const { version, medicineIds } = await approvedProtocol(testApp);
      const item = await medicineItem(testApp, farmer.farm.id, medicineIds[0], {
        openedAt: new Date(),
        useWithinDaysAfterOpening: 2,
      });
      await start({
        animalId: farmer.animal.id,
        protocolVersionId: version.id,
        items: [{ medicineId: medicineIds[0], inventoryItemId: item.id }],
      }).expect(201);
    });

    it('refuses unusable items with specific codes', async () => {
      const { version, medicineIds } = await approvedProtocol(testApp);
      const medicineId = medicineIds[0];
      const other = await approvedMedicine(testApp);
      const before = await treatmentCount(testApp, farmer.animal.id);
      const cases: Array<[string, () => Promise<{ id: string }>]> = [
        [
          'INVENTORY_ITEM_MISMATCH',
          () =>
            createInventoryItem(testApp.prisma, {
              farmId: farmer.farm.id,
              category: InventoryCategory.FEED,
              expiresOn: dayFromToday(100),
            }),
        ],
        [
          'INVENTORY_ITEM_MISMATCH',
          () => medicineItem(testApp, farmer.farm.id, other.id),
        ],
        [
          'INVENTORY_ITEM_ARCHIVED',
          // archived below
          () => medicineItem(testApp, farmer.farm.id, medicineId),
        ],
        [
          'MEDICINE_EXPIRY_UNKNOWN',
          () =>
            medicineItem(testApp, farmer.farm.id, medicineId, {
              expiresOn: null,
            }),
        ],
        [
          'MEDICINE_EXPIRED',
          () =>
            medicineItem(testApp, farmer.farm.id, medicineId, {
              expiresOn: dayFromToday(1),
            }),
        ],
        [
          'MEDICINE_OPENED_EXPIRED',
          () =>
            medicineItem(testApp, farmer.farm.id, medicineId, {
              openedAt: new Date(),
              useWithinDaysAfterOpening: 1,
            }),
        ],
        [
          'MEDICINE_OPENED_EXPIRY_UNKNOWN',
          () =>
            medicineItem(testApp, farmer.farm.id, medicineId, {
              openedAt: new Date(),
              useWithinDaysAfterOpening: null,
            }),
        ],
        [
          'INVENTORY_ITEM_EMPTY',
          () =>
            medicineItem(testApp, farmer.farm.id, medicineId, {
              quantity: '0',
            }),
        ],
      ];
      for (const [code, makeItem] of cases) {
        const item = await makeItem();
        if (code === 'INVENTORY_ITEM_ARCHIVED') {
          await testApp.prisma.inventoryItem.update({
            where: { id: item.id },
            data: { archivedAt: new Date() },
          });
        }
        const res = await start({
          animalId: farmer.animal.id,
          protocolVersionId: version.id,
          items: [{ medicineId, inventoryItemId: item.id }],
        });
        expect([res.status, res.body.code]).toEqual([422, code]);
      }
      expect(await treatmentCount(testApp, farmer.animal.id)).toBe(before);
    });

    it('an item of the farmer’s other farm → 404', async () => {
      const { version, medicineIds } = await approvedProtocol(testApp);
      const otherFarm = await createFarm(testApp.prisma, {
        ownerId: farmer.user.id,
      });
      const item = await medicineItem(testApp, otherFarm.id, medicineIds[0]);
      await start({
        animalId: farmer.animal.id,
        protocolVersionId: version.id,
        items: [{ medicineId: medicineIds[0], inventoryItemId: item.id }],
      }).expect(404);
    });

    it('item medicines must be distinct and part of the protocol', async () => {
      const { version, medicineIds } = await approvedProtocol(testApp);
      const other = await approvedMedicine(testApp);
      const notIn = await start({
        animalId: farmer.animal.id,
        protocolVersionId: version.id,
        items: [{ medicineId: other.id }],
      }).expect(422);
      expect(notIn.body.code).toBe('MEDICINE_NOT_IN_PROTOCOL');
      const duplicate = await start({
        animalId: farmer.animal.id,
        protocolVersionId: version.id,
        items: [{ medicineId: medicineIds[0] }, { medicineId: medicineIds[0] }],
      }).expect(400);
      expect(duplicate.body.code).toBe('DUPLICATE_MEDICINE');
    });
  });

  it('list, get, complete and cancel (audited); finished treatments are final', async () => {
    const owner = await createFarmer(testApp);
    const { version } = await approvedProtocol(testApp);
    const body = { animalId: owner.animal.id, protocolVersionId: version.id };
    const a = await start(body, owner).expect(201);
    const b = await start(body, owner).expect(201);

    const list = await testApp
      .http()
      .get(TREATMENTS)
      .query({ animalId: owner.animal.id, sort: 'startedAt' })
      .set(owner.auth)
      .expect(200);
    expect(list.body).toMatchObject({ page: 1, limit: 20, total: 2 });
    expect(list.body.items.map((t: { id: string }) => t.id)).toEqual([
      a.body.id,
      b.body.id,
    ]);

    const completed = await testApp
      .http()
      .post(`${TREATMENTS}/${a.body.id}/complete`)
      .set(owner.auth)
      .expect(200);
    expect(completed.body).toMatchObject({
      status: 'COMPLETED',
      completedAt: expect.any(String),
      cancelledAt: null,
    });
    const cancelled = await testApp
      .http()
      .post(`${TREATMENTS}/${b.body.id}/cancel`)
      .set(owner.auth)
      .expect(200);
    expect(cancelled.body.status).toBe('CANCELLED');

    for (const [id, action] of [
      [a.body.id, 'treatment.completed'],
      [b.body.id, 'treatment.cancelled'],
    ]) {
      const audit = await auditRows(testApp, 'treatment', id);
      expect(audit.map((row) => row.action)).toEqual([
        'treatment.started',
        action,
      ]);
      expect(audit[1].oldValue).toEqual({ status: 'ACTIVE' });
      for (const verb of ['complete', 'cancel']) {
        const res = await testApp
          .http()
          .post(`${TREATMENTS}/${id}/${verb}`)
          .set(owner.auth)
          .expect(409);
        expect(res.body.code).toBe('TREATMENT_NOT_ACTIVE');
      }
    }

    const active = await testApp
      .http()
      .get(TREATMENTS)
      .query({ animalId: owner.animal.id, status: 'ACTIVE' })
      .set(owner.auth)
      .expect(200);
    expect(active.body.total).toBe(0);

    const got = await testApp
      .http()
      .get(`${TREATMENTS}/${a.body.id}`)
      .set(owner.auth)
      .expect(200);
    expect(got.body).toMatchObject({
      id: a.body.id,
      status: 'COMPLETED',
      protocolSnapshot: a.body.protocolSnapshot,
    });
  });

  it('archived animals cannot be treated (404)', async () => {
    const owner = await createFarmer(testApp);
    await testApp.prisma.animal.update({
      where: { id: owner.animal.id },
      data: { archivedAt: new Date(), archivedReason: 'sotildi' },
    });
    const { version } = await approvedProtocol(testApp);
    await start(
      { animalId: owner.animal.id, protocolVersionId: version.id },
      owner,
    ).expect(404);
    expect(await treatmentCount(testApp, owner.animal.id)).toBe(0);
  });

  it('only FARMER may use treatment routes', async () => {
    const { version } = await approvedProtocol(testApp);
    const before = await treatmentCount(testApp, farmer.animal.id);
    for (const role of [UserRole.VET, UserRole.ADMIN, UserRole.SUPPORT]) {
      const who = await actor(testApp, role);
      await start(
        { animalId: farmer.animal.id, protocolVersionId: version.id },
        who,
      ).expect(403);
      await testApp.http().get(TREATMENTS).set(who.auth).expect(403);
    }
    expect(await treatmentCount(testApp, farmer.animal.id)).toBe(before);
    await testApp.http().get(TREATMENTS).expect(401);
  });

  it.each([
    [{ animalId: 'nope' }],
    [{ protocolVersionId: 42 }],
    [{ items: 'x' }],
    [{ items: [{ medicineId: 'nope' }] }],
    [{ items: [{}] }],
    [{ notes: 'x'.repeat(1001) }],
    [{ farmId: '0b7f1a0e-2a7b-4e0c-8a51-4f7d2f0d9e11' }],
    [{ startedById: '0b7f1a0e-2a7b-4e0c-8a51-4f7d2f0d9e11' }],
  ])('rejects invalid body %o', async (overrides) => {
    await start({
      animalId: farmer.animal.id,
      protocolVersionId: '0b7f1a0e-2a7b-4e0c-8a51-4f7d2f0d9e11',
      ...overrides,
    }).expect(400);
  });
});
